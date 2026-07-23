import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  DescribeUserPoolCommand,
  CreateUserPoolCommand,
  UpdateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
  ListUserPoolClientsCommand,
  CreateUserPoolClientCommand,
  CreateGroupCommand,
  GroupExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  GetFunctionCommand,
  CreateFunctionCommand,
  UpdateFunctionConfigurationCommand,
  AddPermissionCommand,
  ResourceNotFoundException as LambdaResourceNotFoundException,
  ResourceConflictException,
  InvalidParameterValueException,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { buildSingleFileZip } from "./zip.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const RESOURCE_PREFIX = process.env.RESOURCE_PREFIX ?? "robo-compet";
if (!/^[a-z0-9-]{3,40}$/.test(RESOURCE_PREFIX)) throw new Error("RESOURCE_PREFIX must match ^[a-z0-9-]{3,40}$");
const POOL_NAME = process.env.COGNITO_POOL_NAME ?? `${RESOURCE_PREFIX} - Users`;
const CLIENT_NAME = process.env.COGNITO_CLIENT_NAME ?? `${RESOURCE_PREFIX} - Web App`;
const EXISTING_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const EXISTING_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const GROUP_NAMES = ["committee", "admin"] as const;
const TRIGGER_FUNCTION_NAME = `${RESOURCE_PREFIX}-auto-confirm-signup`;
const TRIGGER_ROLE_NAME = `${RESOURCE_PREFIX}-auto-confirm-signup-role`;
const LAMBDA_BASIC_EXECUTION_POLICY_ARN =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

const PRESIGNUP_TRIGGER_SOURCE = `
exports.handler = async (event) => {
  event.response = event.response || {};
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
`.trimStart();

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOrCreateTriggerRole(): Promise<string> {
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: TRIGGER_ROLE_NAME }));
    console.log(`IAM role "${TRIGGER_ROLE_NAME}" already exists — reusing.`);
    return existing.Role!.Arn!;
  } catch (err) {
    if (!(err instanceof NoSuchEntityException)) throw err;
  }

  console.log(`Creating IAM role "${TRIGGER_ROLE_NAME}"...`);
  const created = await iam.send(
    new CreateRoleCommand({
      RoleName: TRIGGER_ROLE_NAME,
      Description:
        "Execution role for the Robo Compet Cognito pre-sign-up trigger (auto-confirms and auto-verifies new competitor sign-ups).",
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    })
  );

  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: TRIGGER_ROLE_NAME,
      PolicyArn: LAMBDA_BASIC_EXECUTION_POLICY_ARN,
    })
  );

  return created.Role!.Arn!;
}

async function findOrCreateTriggerFunction(roleArn: string): Promise<string> {
  try {
    const existing = await lambda.send(
      new GetFunctionCommand({ FunctionName: TRIGGER_FUNCTION_NAME })
    );
    if (existing.Configuration?.Runtime !== "nodejs22.x") {
      await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: TRIGGER_FUNCTION_NAME, Runtime: "nodejs22.x" }));
      await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: TRIGGER_FUNCTION_NAME });
    }
    console.log(`Lambda function "${TRIGGER_FUNCTION_NAME}" already exists — reusing.`);
    return existing.Configuration!.FunctionArn!;
  } catch (err) {
    if (!(err instanceof LambdaResourceNotFoundException)) throw err;
  }

  console.log(`Creating Lambda function "${TRIGGER_FUNCTION_NAME}"...`);
  const zip = await buildSingleFileZip("index.js", PRESIGNUP_TRIGGER_SOURCE);

  // A freshly created IAM role can take several seconds to become assumable
  // by Lambda — retry through that propagation delay instead of failing.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const created = await lambda.send(
        new CreateFunctionCommand({
          FunctionName: TRIGGER_FUNCTION_NAME,
          Runtime: "nodejs22.x",
          Handler: "index.handler",
          Role: roleArn,
          Code: { ZipFile: zip },
          Timeout: 5,
          MemorySize: 128,
          Description:
            "Auto-confirms and auto-verifies new competitor sign-ups for the Robotics Competition registration system (Cognito pre-sign-up trigger).",
        })
      );
      return created.FunctionArn!;
    } catch (err) {
      const roleNotReady =
        err instanceof InvalidParameterValueException &&
        /cannot be assumed/i.test(err.message ?? "");
      if (!roleNotReady || attempt === maxAttempts) throw err;
      console.log(`  role not yet assumable by Lambda, retrying (${attempt}/${maxAttempts})...`);
      await sleep(3000);
    }
  }
  throw new Error("unreachable");
}

async function grantCognitoInvokePermission(poolArn: string): Promise<void> {
  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: TRIGGER_FUNCTION_NAME,
        StatementId: "CognitoInvokePreSignUp",
        Action: "lambda:InvokeFunction",
        Principal: "cognito-idp.amazonaws.com",
        SourceArn: poolArn,
      })
    );
  } catch (err) {
    if (!(err instanceof ResourceConflictException)) throw err;
    console.log("  Lambda invoke permission for Cognito already granted — skipping.");
  }
}

async function findOrCreateUserPool(): Promise<{ id: string; arn: string }> {
  if (EXISTING_POOL_ID) {
    const described = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: EXISTING_POOL_ID }));
    console.log(`User pool id "${EXISTING_POOL_ID}" configured — reusing "${described.UserPool?.Name}".`);
    return { id: EXISTING_POOL_ID, arn: described.UserPool!.Arn! };
  }
  const list = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const existing = list.UserPools?.find((p) => p.Name === POOL_NAME);

  if (existing?.Id) {
    console.log(`User pool "${POOL_NAME}" already exists — reusing.`);
    const described = await cognito.send(
      new DescribeUserPoolCommand({ UserPoolId: existing.Id })
    );
    return { id: existing.Id, arn: described.UserPool!.Arn! };
  }

  console.log(`Creating user pool "${POOL_NAME}" (Lite tier)...`);
  const created = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: POOL_NAME,
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 7,
        },
      },
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
      },
      Schema: [
        {
          Name: "competitorId",
          AttributeDataType: "String",
          Mutable: true,
          Required: false,
          DeveloperOnlyAttribute: false,
        },
      ],
    })
  );

  return { id: created.UserPool!.Id!, arn: created.UserPool!.Arn! };
}

async function wirePreSignUpTrigger(poolId: string, functionArn: string): Promise<void> {
  // UpdateUserPool replaces top-level config, not just the fields you pass —
  // re-send the pool's current Policies/AutoVerifiedAttributes/AccountRecoverySetting
  // alongside LambdaConfig so a repeat run doesn't silently reset them to defaults.
  const described = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
  const pool = described.UserPool!;

  await cognito.send(
    new UpdateUserPoolCommand({
      UserPoolId: poolId,
      // Existing passwords continue to work; this policy applies when users
      // create or change passwords.
      Policies: {
        ...pool.Policies,
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 7,
        },
      },
      AutoVerifiedAttributes: pool.AutoVerifiedAttributes,
      AccountRecoverySetting: pool.AccountRecoverySetting,
      // Preserve the pool's feature tier (e.g. Essentials, which flags common /
      // breached passwords) — omitting it on UpdateUserPool can revert the tier.
      UserPoolTier: pool.UserPoolTier,
      LambdaConfig: { ...pool.LambdaConfig, PreSignUp: functionArn },
    })
  );
  await cognito.send(new SetUserPoolMfaConfigCommand({
    UserPoolId: poolId,
    MfaConfiguration: "OPTIONAL",
    SoftwareTokenMfaConfiguration: { Enabled: true },
  }));
}

async function findOrCreateAppClient(poolId: string): Promise<string> {
  if (EXISTING_CLIENT_ID) {
    const list = await cognito.send(new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }));
    if (!list.UserPoolClients?.some((client) => client.ClientId === EXISTING_CLIENT_ID)) {
      throw new Error(`COGNITO_CLIENT_ID ${EXISTING_CLIENT_ID} does not belong to user pool ${poolId}`);
    }
    console.log(`App client id "${EXISTING_CLIENT_ID}" configured — reusing.`);
    return EXISTING_CLIENT_ID;
  }
  const list = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 })
  );
  const existing = list.UserPoolClients?.find((c) => c.ClientName === CLIENT_NAME);
  if (existing?.ClientId) {
    console.log(`App client "${CLIENT_NAME}" already exists — reusing.`);
    return existing.ClientId;
  }

  console.log(`Creating app client "${CLIENT_NAME}"...`);
  const created = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: poolId,
      ClientName: CLIENT_NAME,
      GenerateSecret: false,
      ExplicitAuthFlows: [
        "ALLOW_USER_PASSWORD_AUTH",
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
      ],
    })
  );
  return created.UserPoolClient!.ClientId!;
}

async function findOrCreateGroups(poolId: string): Promise<void> {
  for (const groupName of GROUP_NAMES) {
    try {
      await cognito.send(new CreateGroupCommand({ UserPoolId: poolId, GroupName: groupName }));
      console.log(`  created group "${groupName}".`);
    } catch (err) {
      if (err instanceof GroupExistsException) {
        console.log(`  group "${groupName}" already exists — skipping.`);
        continue;
      }
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const roleArn = await findOrCreateTriggerRole();
  const functionArn = await findOrCreateTriggerFunction(roleArn);
  const { id: poolId, arn: poolArn } = await findOrCreateUserPool();

  await grantCognitoInvokePermission(poolArn);
  await wirePreSignUpTrigger(poolId, functionArn);
  await findOrCreateGroups(poolId);
  const clientId = await findOrCreateAppClient(poolId);

  console.log("\nDone. Set these in ENV.md-derived .env files:");
  console.log(`  COGNITO_USER_POOL_ID=${poolId}`);
  console.log(`  COGNITO_CLIENT_ID=${clientId}`);
}

main().catch((err) => {
  console.error("create-auth failed:", err);
  process.exit(1);
});
