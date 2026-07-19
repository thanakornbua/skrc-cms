import { fileURLToPath } from "node:url";
import path from "node:path";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  PutRolePolicyCommand,
  NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  GetFunctionCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  AddPermissionCommand,
  ResourceNotFoundException as LambdaResourceNotFoundException,
  ResourceConflictException,
  waitUntilFunctionUpdatedV2,
  waitUntilFunctionActiveV2,
} from "@aws-sdk/client-lambda";
import {
  ApiGatewayV2Client,
  CreateApiCommand,
  UpdateApiCommand,
  GetApisCommand,
} from "@aws-sdk/client-apigatewayv2";
import { bundleLambdaFromDist } from "./bundle-lambda.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const TABLE_NAME = process.env.DYNAMO_TABLE ?? "robo-compet";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

const FUNCTION_NAME = "robo-compet-regweek-api";
const ROLE_NAME = "robo-compet-regweek-lambda-role";
const LAMBDA_BASIC_EXECUTION_POLICY_ARN =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HANDLER_DIST_PATH = path.resolve(
  __dirname,
  "../../backend/dist/regweek/handler.js"
);

const sts = new STSClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const apigw = new ApiGatewayV2Client({ region: REGION });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccountId(): Promise<string> {
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  return identity.Account!;
}

async function findOrCreateRegweekRole(accountId: string): Promise<string> {
  let roleArn: string;
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
    console.log(`IAM role "${ROLE_NAME}" already exists — reusing.`);
    roleArn = existing.Role!.Arn!;
  } catch (err) {
    if (!(err instanceof NoSuchEntityException)) throw err;

    console.log(`Creating IAM role "${ROLE_NAME}"...`);
    const created = await iam.send(
      new CreateRoleCommand({
        RoleName: ROLE_NAME,
        Description:
          "Execution role for the Robo Compet registration-week Lambda (DynamoDB and Cognito attribute stamp).",
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
    roleArn = created.Role!.Arn!;

    await iam.send(
      new AttachRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyArn: LAMBDA_BASIC_EXECUTION_POLICY_ARN,
      })
    );
  }

  // Re-applied every run (cheap, idempotent) so table/pool renames are
  // picked up without a separate migration step.
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: ROLE_NAME,
      PolicyName: "robo-compet-regweek-inline",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DynamoDBAccess",
            Effect: "Allow",
            Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan"],
            Resource: [
              `arn:aws:dynamodb:${REGION}:${accountId}:table/${TABLE_NAME}`,
              `arn:aws:dynamodb:${REGION}:${accountId}:table/${TABLE_NAME}/index/*`,
            ],
          },
          {
            Sid: "CognitoAdminAttributeStamp",
            Effect: "Allow",
            Action: ["cognito-idp:AdminUpdateUserAttributes"],
            Resource: `arn:aws:cognito-idp:${REGION}:${accountId}:userpool/${USER_POOL_ID}`,
          },
        ],
      }),
    })
  );

  return roleArn;
}

async function findOrCreateFunction(roleArn: string): Promise<string> {
  const zip = await bundleLambdaFromDist(HANDLER_DIST_PATH);
  const environment = {
    Variables: {
      DYNAMO_TABLE: TABLE_NAME,
      COGNITO_USER_POOL_ID: USER_POOL_ID!,
      COGNITO_CLIENT_ID: CLIENT_ID!,
      CORS_ORIGIN,
    },
  };

  let exists = true;
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
  } catch (err) {
    if (!(err instanceof LambdaResourceNotFoundException)) throw err;
    exists = false;
  }

  if (!exists) {
    console.log(`Creating Lambda function "${FUNCTION_NAME}"...`);
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const created = await lambda.send(
          new CreateFunctionCommand({
            FunctionName: FUNCTION_NAME,
            Runtime: "nodejs20.x",
            Handler: "index.handler",
            Role: roleArn,
            Code: { ZipFile: zip },
            Timeout: 15,
            MemorySize: 256,
            Environment: environment,
            Description:
              "Registration-week API for free registration and committee approval.",
          })
        );
        await waitUntilFunctionActiveV2(
          { client: lambda, maxWaitTime: 120 },
          { FunctionName: FUNCTION_NAME }
        );
        return created.FunctionArn!;
      } catch (err) {
        const roleNotReady =
          err instanceof Error && /cannot be assumed/i.test(err.message ?? "");
        if (!roleNotReady || attempt === maxAttempts) throw err;
        console.log(`  role not yet assumable by Lambda, retrying (${attempt}/${maxAttempts})...`);
        await sleep(3000);
      }
    }
    throw new Error("unreachable");
  }

  console.log(`Lambda function "${FUNCTION_NAME}" already exists — updating code and config.`);
  await lambda.send(
    new UpdateFunctionCodeCommand({ FunctionName: FUNCTION_NAME, ZipFile: zip })
  );
  await waitUntilFunctionUpdatedV2(
    { client: lambda, maxWaitTime: 120 },
    { FunctionName: FUNCTION_NAME }
  );
  const updated = await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: FUNCTION_NAME,
      Role: roleArn,
      Timeout: 15,
      MemorySize: 256,
      Environment: environment,
    })
  );
  await waitUntilFunctionUpdatedV2(
    { client: lambda, maxWaitTime: 120 },
    { FunctionName: FUNCTION_NAME }
  );
  return updated.FunctionArn!;
}

const HTTP_API_NAME = "robo-compet-regweek-http-api";

/**
 * Lambda Function URLs are not available in every region (notably not in
 * ap-southeast-7 as of this build) — an API Gateway HTTP API is the
 * equivalent free-tier, no-domain-needed HTTPS front door and works
 * everywhere. CreateApi's `Target` shortcut auto-creates the Lambda proxy
 * integration and a $default auto-deployed stage, but — confirmed by
 * testing, contrary to some docs — it does NOT grant API Gateway
 * permission to invoke the function; that has to be added explicitly via
 * Lambda's resource policy (see grantApiGatewayInvokePermission below).
 */
async function findOrCreateHttpApi(
  functionArn: string
): Promise<{ apiId: string; apiEndpoint: string }> {
  const corsConfiguration = {
    AllowOrigins: [CORS_ORIGIN],
    AllowMethods: ["GET", "POST"],
    AllowHeaders: ["authorization", "content-type"],
    MaxAge: 300,
  };

  const existingApis = await apigw.send(new GetApisCommand({}));
  const existing = existingApis.Items?.find((api) => api.Name === HTTP_API_NAME);

  if (existing?.ApiId) {
    console.log(`HTTP API "${HTTP_API_NAME}" already exists — updating CORS config.`);
    await apigw.send(
      new UpdateApiCommand({ ApiId: existing.ApiId, CorsConfiguration: corsConfiguration })
    );
    return { apiId: existing.ApiId, apiEndpoint: existing.ApiEndpoint! };
  }

  console.log(`Creating HTTP API "${HTTP_API_NAME}"...`);
  const created = await apigw.send(
    new CreateApiCommand({
      Name: HTTP_API_NAME,
      ProtocolType: "HTTP",
      Target: functionArn,
      CorsConfiguration: corsConfiguration,
    })
  );
  return { apiId: created.ApiId!, apiEndpoint: created.ApiEndpoint! };
}

async function grantApiGatewayInvokePermission(
  accountId: string,
  apiId: string
): Promise<void> {
  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: FUNCTION_NAME,
        StatementId: "ApiGatewayInvoke",
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: `arn:aws:execute-api:${REGION}:${accountId}:${apiId}/*/*`,
      })
    );
  } catch (err) {
    if (!(err instanceof ResourceConflictException)) throw err;
    console.log("  API Gateway invoke permission already granted — skipping.");
  }
}

async function main(): Promise<void> {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error(
      "COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID env vars are required (run ops/create-auth.ts first)"
    );
  }

  const accountId = await getAccountId();
  const roleArn = await findOrCreateRegweekRole(accountId);
  const functionArn = await findOrCreateFunction(roleArn);
  const { apiId, apiEndpoint } = await findOrCreateHttpApi(functionArn);
  await grantApiGatewayInvokePermission(accountId, apiId);

  console.log("\nDone. Set these in ENV.md-derived .env files:");
  console.log(`  VITE_REGWEEK_API_URL=${apiEndpoint}`);
}

main().catch((err) => {
  console.error("create-regweek failed:", err);
  process.exit(1);
});
