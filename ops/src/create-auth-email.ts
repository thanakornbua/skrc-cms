import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CognitoIdentityProviderClient, DescribeUserPoolCommand, ListUserPoolsCommand,
  UpdateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  IAMClient, GetRoleCommand, CreateRoleCommand, AttachRolePolicyCommand,
  PutRolePolicyCommand, NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  KMSClient, CreateKeyCommand, CreateAliasCommand, DescribeKeyCommand,
  PutKeyPolicyCommand, NotFoundException as KmsNotFoundException,
} from "@aws-sdk/client-kms";
import {
  LambdaClient, GetFunctionCommand, CreateFunctionCommand, UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand, AddPermissionCommand,
  ResourceNotFoundException as LambdaResourceNotFoundException, ResourceConflictException,
  waitUntilFunctionActiveV2, waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { bundleLambdaFromDist } from "./bundle-lambda.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const RESOURCE_PREFIX = process.env.RESOURCE_PREFIX ?? "robo-compet";
if (!/^[a-z0-9-]{3,40}$/.test(RESOURCE_PREFIX)) throw new Error("Invalid RESOURCE_PREFIX");
const POOL_NAME = process.env.COGNITO_POOL_NAME ?? `${RESOURCE_PREFIX} - Users`;
const EXISTING_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "no-reply@skrc.suankularb.space";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "skrc@skrc.suankularb.space";
const PORTAL_URL = process.env.PORTAL_URL ?? "https://competitive.skrc.suankularb.space/portal";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "skrc@skrc.suankularb.space";
const CLOUDFLARE_EMAIL_TOKEN_SECRET_ID = process.env.CLOUDFLARE_EMAIL_TOKEN_SECRET_ID;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^https:\/\//.test(PORTAL_URL)) throw new Error("PORTAL_URL must use HTTPS");
if (![EMAIL_FROM, EMAIL_REPLY_TO, CONTACT_EMAIL].every((v) => /^\S+@\S+\.\S+$/.test(v))) throw new Error("Invalid email configuration");
if (!CLOUDFLARE_EMAIL_TOKEN_SECRET_ID) throw new Error("CLOUDFLARE_EMAIL_TOKEN_SECRET_ID is required");
if (!CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
const cloudflareSecretId = CLOUDFLARE_EMAIL_TOKEN_SECRET_ID;
const cloudflareAccountId = CLOUDFLARE_ACCOUNT_ID;

const FUNCTION_NAME = `${RESOURCE_PREFIX}-custom-email-sender`;
const ROLE_NAME = `${RESOURCE_PREFIX}-custom-email-sender-role`;
const KEY_ALIAS = `alias/${RESOURCE_PREFIX}-custom-email-sender`;
const BASIC_POLICY = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_DIST_PATH = path.resolve(__dirname, "../../backend/dist/auth-email/handler.js");

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const kms = new KMSClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const secrets = new SecretsManagerClient({ region: REGION });
const sts = new STSClient({ region: REGION });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePool(): Promise<{ id: string; arn: string }> {
  if (EXISTING_POOL_ID) {
    const described = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: EXISTING_POOL_ID }));
    return { id: EXISTING_POOL_ID, arn: described.UserPool!.Arn! };
  }
  const list = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const found = list.UserPools?.find((p) => p.Name === POOL_NAME);
  if (!found?.Id) throw new Error(`User pool "${POOL_NAME}" not found — run create-auth first or set COGNITO_USER_POOL_ID`);
  const described = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: found.Id }));
  return { id: found.Id, arn: described.UserPool!.Arn! };
}

/** Symmetric KMS key Cognito uses to encrypt the one-time code before handing it
 *  to the CustomEmailSender Lambda; the Lambda decrypts it with kms:Decrypt. */
async function ensureKmsKey(accountId: string): Promise<string> {
  const keyPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "EnableAccountAdmin",
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${accountId}:root` },
        Action: "kms:*",
        Resource: "*",
      },
      {
        Sid: "AllowCognitoCustomEmailSender",
        Effect: "Allow",
        Principal: { Service: "cognito-idp.amazonaws.com" },
        Action: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:CreateGrant", "kms:DescribeKey"],
        Resource: "*",
      },
    ],
  });

  try {
    const existing = await kms.send(new DescribeKeyCommand({ KeyId: KEY_ALIAS }));
    const keyArn = existing.KeyMetadata!.Arn!;
    // Re-assert the policy so a repeat run heals any drift.
    await kms.send(new PutKeyPolicyCommand({ KeyId: keyArn, PolicyName: "default", Policy: keyPolicy }));
    console.log(`KMS key ${KEY_ALIAS} already exists — reusing.`);
    return keyArn;
  } catch (err) {
    if (!(err instanceof KmsNotFoundException)) throw err;
  }

  console.log(`Creating KMS key ${KEY_ALIAS}...`);
  const created = await kms.send(new CreateKeyCommand({
    Description: "Encrypts Cognito one-time codes for the Robo Compet CustomEmailSender Lambda",
    KeyUsage: "ENCRYPT_DECRYPT",
    KeySpec: "SYMMETRIC_DEFAULT",
    Policy: keyPolicy,
    Tags: [{ TagKey: "Project", TagValue: "robo-compet" }],
  }));
  const keyArn = created.KeyMetadata!.Arn!;
  await kms.send(new CreateAliasCommand({ AliasName: KEY_ALIAS, TargetKeyId: keyArn }));
  return keyArn;
}

async function ensureRole(cloudflareSecretArn: string, keyArn: string): Promise<string> {
  let roleArn: string;
  try {
    roleArn = (await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }))).Role!.Arn!;
  } catch (err) {
    if (!(err instanceof NoSuchEntityException)) throw err;
    roleArn = (await iam.send(new CreateRoleCommand({
      RoleName: ROLE_NAME,
      Description: "Robo Compet Cognito CustomEmailSender (sends password-reset codes via Cloudflare)",
      AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{
        Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole",
      }] }),
      Tags: [{ Key: "Project", Value: "robo-compet" }],
    }))).Role!.Arn!;
    await iam.send(new AttachRolePolicyCommand({ RoleName: ROLE_NAME, PolicyArn: BASIC_POLICY }));
  }
  await iam.send(new PutRolePolicyCommand({
    RoleName: ROLE_NAME,
    PolicyName: `${RESOURCE_PREFIX}-custom-email-sender-inline`,
    PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [
      { Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: cloudflareSecretArn },
      { Effect: "Allow", Action: "kms:Decrypt", Resource: keyArn },
    ] }),
  }));
  return roleArn;
}

async function ensureFunction(roleArn: string, keyArn: string): Promise<string> {
  const zip = await bundleLambdaFromDist(HANDLER_DIST_PATH);
  const environment = { Variables: {
    CLOUDFLARE_EMAIL_TOKEN_SECRET_ID: cloudflareSecretId, CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
    CUSTOM_EMAIL_KMS_KEY_ARN: keyArn, EMAIL_FROM, EMAIL_REPLY_TO, PORTAL_URL, CONTACT_EMAIL,
  } };
  try {
    const existing = await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: FUNCTION_NAME, ZipFile: zip }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FUNCTION_NAME });
    await lambda.send(new UpdateFunctionConfigurationCommand({
      FunctionName: FUNCTION_NAME, Runtime: "nodejs22.x", Role: roleArn, Timeout: 15, MemorySize: 256, Environment: environment,
    }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FUNCTION_NAME });
    return existing.Configuration!.FunctionArn!;
  } catch (err) {
    if (!(err instanceof LambdaResourceNotFoundException)) throw err;
  }
  let created;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      created = await lambda.send(new CreateFunctionCommand({
        FunctionName: FUNCTION_NAME, Runtime: "nodejs22.x", Handler: "index.handler", Role: roleArn,
        Code: { ZipFile: zip }, Timeout: 15, MemorySize: 256, Environment: environment,
        Description: "Sends Cognito password-reset codes as branded HTML through Cloudflare Email Sending",
        Tags: { Project: "robo-compet", Environment: RESOURCE_PREFIX.endsWith("-staging") ? "staging" : "production" },
      }));
      break;
    } catch (err) {
      const roleNotReady = err instanceof Error && /cannot be assumed/i.test(err.message);
      if (!roleNotReady || attempt === 6) throw err;
      console.log(`CustomEmailSender role not yet assumable; retrying (${attempt}/6)...`);
      await sleep(3000);
    }
  }
  if (!created) throw new Error("CustomEmailSender function creation did not return a function");
  await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FUNCTION_NAME });
  return created.FunctionArn!;
}

async function grantCognitoInvoke(functionArn: string, poolArn: string): Promise<void> {
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: functionArn,
      StatementId: "CognitoInvokeCustomEmailSender",
      Action: "lambda:InvokeFunction",
      Principal: "cognito-idp.amazonaws.com",
      SourceArn: poolArn,
    }));
  } catch (err) {
    if (!(err instanceof ResourceConflictException)) throw err;
    console.log("Cognito invoke permission already granted — skipping.");
  }
}

/** Enabling CustomEmailSender routes ALL Cognito emails through the Lambda.
 *  Re-describe first so we preserve existing config (notably the PreSignUp
 *  trigger from create-auth) rather than letting UpdateUserPool reset it. */
async function wireCustomEmailSender(poolId: string, functionArn: string, keyArn: string): Promise<void> {
  const described = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
  const pool = described.UserPool!;
  await cognito.send(new UpdateUserPoolCommand({
    UserPoolId: poolId,
    Policies: pool.Policies,
    AutoVerifiedAttributes: pool.AutoVerifiedAttributes,
    AccountRecoverySetting: pool.AccountRecoverySetting,
    // Keep the pool's feature tier (Essentials flags common/breached passwords);
    // omitting it on UpdateUserPool can silently revert the tier.
    UserPoolTier: pool.UserPoolTier,
    AdminCreateUserConfig: pool.AdminCreateUserConfig,
    EmailConfiguration: pool.EmailConfiguration,
    VerificationMessageTemplate: pool.VerificationMessageTemplate,
    UserAttributeUpdateSettings: pool.UserAttributeUpdateSettings,
    LambdaConfig: {
      ...pool.LambdaConfig,
      KMSKeyID: keyArn,
      CustomEmailSender: { LambdaVersion: "V1_0", LambdaArn: functionArn },
    },
  }));
}

async function main(): Promise<void> {
  const accountId = (await sts.send(new GetCallerIdentityCommand({}))).Account!;
  const { id: poolId, arn: poolArn } = await resolvePool();
  const cloudflareSecret = await secrets.send(new DescribeSecretCommand({ SecretId: cloudflareSecretId }));
  if (!cloudflareSecret.ARN) throw new Error(`Cloudflare email token secret ${cloudflareSecretId} has no ARN`);

  const keyArn = await ensureKmsKey(accountId);
  const roleArn = await ensureRole(cloudflareSecret.ARN, keyArn);
  const functionArn = await ensureFunction(roleArn, keyArn);
  await grantCognitoInvoke(functionArn, poolArn);
  await wireCustomEmailSender(poolId, functionArn, keyArn);

  console.log("CustomEmailSender wired. Cognito password-reset codes now send via Cloudflare.");
  console.log(`  Lambda: ${functionArn}`);
  console.log(`  KMS key: ${keyArn}`);
}

main().catch((err) => { console.error("create-auth-email failed:", err); process.exit(1); });
