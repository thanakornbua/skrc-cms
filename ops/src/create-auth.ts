import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  DescribeUserPoolCommand,
  CreateUserPoolCommand,
  UpdateUserPoolCommand,
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
  AddPermissionCommand,
  ResourceNotFoundException as LambdaResourceNotFoundException,
  ResourceConflictException,
  InvalidParameterValueException,
} from "@aws-sdk/client-lambda";
import { buildSingleFileZip } from "./zip.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const POOL_NAME = "Robo Compet - Users";
const CLIENT_NAME = "Robo Compet - Web App";
const GROUP_NAMES = ["committee", "admin"] as const;
const TRIGGER_FUNCTION_NAME = "robo-compet-auto-confirm-signup";
const TRIGGER_ROLE_NAME = "robo-compet-auto-confirm-signup-role";
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
          Runtime: "nodejs20.x",
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
          MinimumLength: 8,
          RequireUppercase: false,
          RequireLowercase: false,
          RequireNumbers: false,
          RequireSymbols: false,
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
      Policies: pool.Policies,
      AutoVerifiedAttributes: pool.AutoVerifiedAttributes,
      AccountRecoverySetting: pool.AccountRecoverySetting,
      LambdaConfig: { ...pool.LambdaConfig, PreSignUp: functionArn },
    })
  );
}

async function findOrCreateAppClient(poolId: string): Promise<string> {
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
