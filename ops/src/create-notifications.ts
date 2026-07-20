import { fileURLToPath } from "node:url";
import path from "node:path";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  IAMClient, GetRoleCommand, CreateRoleCommand, AttachRolePolicyCommand,
  PutRolePolicyCommand, NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  LambdaClient, GetFunctionCommand, CreateFunctionCommand, UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand, CreateEventSourceMappingCommand,
  UpdateEventSourceMappingCommand, ListEventSourceMappingsCommand,
  ResourceNotFoundException as LambdaResourceNotFoundException,
  waitUntilFunctionActiveV2, waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import {
  SQSClient, GetQueueUrlCommand, CreateQueueCommand, GetQueueAttributesCommand,
  QueueDoesNotExist,
} from "@aws-sdk/client-sqs";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { bundleLambdaFromDist } from "./bundle-lambda.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const TABLE_NAME = process.env.DYNAMO_TABLE ?? "robo-compet";
const RESOURCE_PREFIX = process.env.RESOURCE_PREFIX ?? "robo-compet";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "no-reply@thanakorn.site";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "thanakorn@thanakorn.site";
const RESEND_API_KEY_SECRET_ID = process.env.RESEND_API_KEY_SECRET_ID;
const PORTAL_URL = process.env.PORTAL_URL ?? "https://competitive.skrc.suankularb.space/portal";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "thanakorn@thanakorn.site";
const EMAIL_ENABLED = process.env.EMAIL_ENABLED ?? "false";
if (!/^[a-z0-9-]{3,40}$/.test(RESOURCE_PREFIX)) throw new Error("Invalid RESOURCE_PREFIX");
if (!/^https:\/\//.test(PORTAL_URL)) throw new Error("PORTAL_URL must use HTTPS");
if (![EMAIL_FROM, EMAIL_REPLY_TO, CONTACT_EMAIL].every((value) => /^\S+@\S+\.\S+$/.test(value))) throw new Error("Invalid email configuration");
if (!RESEND_API_KEY_SECRET_ID) throw new Error("RESEND_API_KEY_SECRET_ID is required");
const resendApiKeySecretId = RESEND_API_KEY_SECRET_ID;

const FUNCTION_NAME = `${RESOURCE_PREFIX}-email-worker`;
const ROLE_NAME = `${RESOURCE_PREFIX}-email-worker-role`;
const DLQ_NAME = `${RESOURCE_PREFIX}-email-dlq`;
const BASIC_POLICY = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_DIST_PATH = path.resolve(__dirname, "../../backend/dist/notifications/handler.js");

const dynamo = new DynamoDBClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const sqs = new SQSClient({ region: REGION });
const secrets = new SecretsManagerClient({ region: REGION });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireResendSecret(): Promise<string> {
  const secret = await secrets.send(new DescribeSecretCommand({ SecretId: resendApiKeySecretId }));
  if (!secret.ARN) throw new Error(`Resend secret ${resendApiKeySecretId} did not return an ARN`);
  return secret.ARN;
}

async function ensureDlq(): Promise<{ url: string; arn: string }> {
  let url: string;
  try {
    url = (await sqs.send(new GetQueueUrlCommand({ QueueName: DLQ_NAME }))).QueueUrl!;
  } catch (err) {
    if (!(err instanceof QueueDoesNotExist)) throw err;
    url = (await sqs.send(new CreateQueueCommand({
      QueueName: DLQ_NAME,
      Attributes: { MessageRetentionPeriod: String(14 * 24 * 60 * 60) },
      tags: { Project: "robo-compet", Environment: RESOURCE_PREFIX.endsWith("-staging") ? "staging" : "production" },
    }))).QueueUrl!;
  }
  const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }));
  return { url, arn: attrs.Attributes!.QueueArn! };
}

async function ensureRole(tableArn: string, dlqArn: string, resendSecretArn: string): Promise<string> {
  let roleArn: string;
  try {
    roleArn = (await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }))).Role!.Arn!;
  } catch (err) {
    if (!(err instanceof NoSuchEntityException)) throw err;
    roleArn = (await iam.send(new CreateRoleCommand({
      RoleName: ROLE_NAME,
      Description: "Robo Compet transactional email stream worker",
      AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{
        Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole",
      }] }),
      Tags: [{ Key: "Project", Value: "robo-compet" }],
    }))).Role!.Arn!;
    await iam.send(new AttachRolePolicyCommand({ RoleName: ROLE_NAME, PolicyArn: BASIC_POLICY }));
  }
  await iam.send(new PutRolePolicyCommand({
    RoleName: ROLE_NAME,
    PolicyName: `${RESOURCE_PREFIX}-email-worker-inline`,
    PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [
      { Effect: "Allow", Action: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"], Resource: `${tableArn}/stream/*` },
      { Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], Resource: tableArn },
      { Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: resendSecretArn },
      { Effect: "Allow", Action: "sqs:SendMessage", Resource: dlqArn },
    ] }),
  }));
  return roleArn;
}

async function ensureFunction(roleArn: string): Promise<string> {
  const zip = await bundleLambdaFromDist(HANDLER_DIST_PATH);
  const environment = { Variables: {
    DYNAMO_TABLE: TABLE_NAME, RESEND_API_KEY_SECRET_ID: resendApiKeySecretId, EMAIL_FROM, EMAIL_REPLY_TO, PORTAL_URL, CONTACT_EMAIL, EMAIL_ENABLED,
  } };
  try {
    const existing = await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: FUNCTION_NAME, ZipFile: zip }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FUNCTION_NAME });
    await lambda.send(new UpdateFunctionConfigurationCommand({
      FunctionName: FUNCTION_NAME, Role: roleArn, Timeout: 30, MemorySize: 256, Environment: environment,
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
        FunctionName: FUNCTION_NAME, Runtime: "nodejs20.x", Handler: "index.handler", Role: roleArn,
        Code: { ZipFile: zip }, Timeout: 30, MemorySize: 256, Environment: environment,
        Description: "Sends idempotent registration and approval notifications through Resend",
        Tags: { Project: "robo-compet", Environment: RESOURCE_PREFIX.endsWith("-staging") ? "staging" : "production" },
      }));
      break;
    } catch (err) {
      const roleNotReady = err instanceof Error && /cannot be assumed/i.test(err.message);
      if (!roleNotReady || attempt === 6) throw err;
      console.log(`Email worker role not yet assumable; retrying (${attempt}/6)...`);
      await sleep(3000);
    }
  }
  if (!created) throw new Error("Email worker creation did not return a function");
  await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FUNCTION_NAME });
  return created.FunctionArn!;
}

async function ensureEventSource(functionArn: string, streamArn: string, dlqArn: string): Promise<void> {
  const mappings = await lambda.send(new ListEventSourceMappingsCommand({ FunctionName: functionArn }));
  const existing = mappings.EventSourceMappings?.find((item) => item.EventSourceArn === streamArn);
  const config = {
    FunctionName: functionArn, BatchSize: 1, BisectBatchOnFunctionError: true,
    MaximumRetryAttempts: 5, MaximumRecordAgeInSeconds: 21600,
    DestinationConfig: { OnFailure: { Destination: dlqArn } },
    Enabled: EMAIL_ENABLED === "true",
  };
  if (existing?.UUID) {
    await lambda.send(new UpdateEventSourceMappingCommand({ UUID: existing.UUID, ...config }));
  } else {
    await lambda.send(new CreateEventSourceMappingCommand({
      ...config, EventSourceArn: streamArn, StartingPosition: "LATEST",
    }));
  }
}

async function main(): Promise<void> {
  const table = (await dynamo.send(new DescribeTableCommand({ TableName: TABLE_NAME }))).Table;
  if (!table?.TableArn || !table.LatestStreamArn) throw new Error(`Table ${TABLE_NAME} must have a stream; run create-table first`);
  const resendSecretArn = await requireResendSecret();
  const dlq = await ensureDlq();
  const roleArn = await ensureRole(table.TableArn, dlq.arn, resendSecretArn);
  const functionArn = await ensureFunction(roleArn);
  await ensureEventSource(functionArn, table.LatestStreamArn, dlq.arn);
  console.log(`Email worker ready: ${functionArn}`);
  console.log(`Email enabled: ${EMAIL_ENABLED}`);
  console.log(`DLQ: ${dlq.url}`);
}

main().catch((err) => { console.error("create-notifications failed:", err); process.exit(1); });
