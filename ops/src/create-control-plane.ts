import { fileURLToPath } from "node:url";
import path from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, CreateRoleCommand, GetRoleCommand, PutRolePolicyCommand, NoSuchEntityException } from "@aws-sdk/client-iam";
import { LambdaClient, AddPermissionCommand, CreateFunctionCommand, GetFunctionCommand, ResourceConflictException, ResourceNotFoundException, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, waitUntilFunctionActiveV2, waitUntilFunctionUpdatedV2 } from "@aws-sdk/client-lambda";
import { ApiGatewayV2Client, CreateApiCommand, CreateRouteCommand, GetApisCommand, GetRoutesCommand, UpdateApiCommand } from "@aws-sdk/client-apigatewayv2";
import { bundleLambdaFromDist } from "./bundle-lambda.js";

const region = process.env.AWS_REGION ?? "ap-southeast-7";
const prefix = process.env.RESOURCE_PREFIX ?? "robo-compet";
const poolId = process.env.COGNITO_USER_POOL_ID;
const clientId = process.env.COGNITO_CLIENT_ID;
const amplifyAppId = process.env.AMPLIFY_APP_ID;
const amplifyBranch = process.env.AMPLIFY_BRANCH ?? "main";
const amplifyRegion = process.env.AMPLIFY_REGION ?? "ap-southeast-1";
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
if (!poolId || !clientId || !amplifyAppId) throw new Error("COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, and AMPLIFY_APP_ID are required");

const functionName = `${prefix}-control-plane`;
const roleName = `${prefix}-control-plane-role`;
const apiName = `${prefix}-control-http-api`;
const here = path.dirname(fileURLToPath(import.meta.url));
const handlerPath = path.resolve(here, "../../backend/dist/control/handler.js");
const iam = new IAMClient({ region }); const lambda = new LambdaClient({ region }); const api = new ApiGatewayV2Client({ region }); const sts = new STSClient({ region });
const account = (await sts.send(new GetCallerIdentityCommand({}))).Account!;

async function role(): Promise<string> {
  try { return (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role!.Arn!; }
  catch (error) {
    if (!(error instanceof NoSuchEntityException)) throw error;
    return (await iam.send(new CreateRoleCommand({ RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }) }))).Role!.Arn!;
  }
}
async function functionArn(roleArn: string): Promise<string> {
  const zip = await bundleLambdaFromDist(handlerPath);
  const environment = { Variables: { COGNITO_USER_POOL_ID: poolId!, COGNITO_CLIENT_ID: clientId!, AMPLIFY_APP_ID: amplifyAppId!, AMPLIFY_BRANCH: amplifyBranch, AMPLIFY_REGION: amplifyRegion } };
  try {
    const existing = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: zip }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
    await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: functionName, Runtime: "nodejs22.x", Role: roleArn, Timeout: 20, MemorySize: 256, Environment: environment }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
    return existing.Configuration!.FunctionArn!;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const created = await lambda.send(new CreateFunctionCommand({ FunctionName: functionName, Runtime: "nodejs22.x", Handler: "index.handler", Role: roleArn, Code: { ZipFile: zip }, Timeout: 20, MemorySize: 256, Environment: environment }));
      await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
      return created.FunctionArn!;
    } catch (error) {
      if (!(error instanceof Error) || !/cannot be assumed/i.test(error.message) || attempt === 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error("unreachable");
}
async function httpApi(target: string): Promise<{ id: string; endpoint: string }> {
  const cors = { AllowOrigins: [corsOrigin], AllowMethods: ["GET", "POST"], AllowHeaders: ["authorization", "content-type"], MaxAge: 300 };
  const existing = (await api.send(new GetApisCommand({}))).Items?.find((item) => item.Name === apiName);
  const apiId = existing?.ApiId;
  const endpoint = existing?.ApiEndpoint;
  if (apiId && endpoint) await api.send(new UpdateApiCommand({ ApiId: apiId, CorsConfiguration: cors }));
  const created = apiId ? undefined : await api.send(new CreateApiCommand({ Name: apiName, ProtocolType: "HTTP", Target: target, CorsConfiguration: cors }));
  const resolvedApiId = apiId ?? created!.ApiId!;
  const routes = (await api.send(new GetRoutesCommand({ ApiId: resolvedApiId }))).Items ?? [];
  // A quick-created HTTP API has a $default Lambda route, which otherwise
  // captures OPTIONS and turns a browser preflight into the Lambda's 401.
  // The explicit higher-priority route lets API Gateway answer CORS preflight.
  if (!routes.some((route) => route.RouteKey === "OPTIONS /{proxy+}")) {
    const defaultTarget = routes.find((route) => route.RouteKey === "$default")?.Target;
    if (!defaultTarget) throw new Error("Control HTTP API is missing its $default integration");
    await api.send(new CreateRouteCommand({ ApiId: resolvedApiId, RouteKey: "OPTIONS /{proxy+}", AuthorizationType: "NONE", Target: defaultTarget }));
  }
  return { id: resolvedApiId, endpoint: endpoint ?? created!.ApiEndpoint! };
}
const roleArn = await role();
const amplifyAppArn = `arn:aws:amplify:${amplifyRegion}:${account}:apps/${amplifyAppId}`;
await iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: `${prefix}-control-plane`, PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [
  // GetApp targets the parent app ARN; branch and job actions target children.
  { Effect: "Allow", Action: ["amplify:GetApp"], Resource: amplifyAppArn },
  { Effect: "Allow", Action: ["amplify:GetBranch", "amplify:GetJob", "amplify:UpdateBranch", "amplify:StartJob"], Resource: `${amplifyAppArn}/*` },
  { Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource: "arn:aws:logs:*:*:*" },
] }) }));
const arn = await functionArn(roleArn); const createdApi = await httpApi(arn);
try { await lambda.send(new AddPermissionCommand({ FunctionName: functionName, StatementId: "ApiGatewayInvoke", Action: "lambda:InvokeFunction", Principal: "apigateway.amazonaws.com", SourceArn: `arn:aws:execute-api:${region}:${account}:${createdApi.id}/*/*` })); }
catch (error) { if (!(error instanceof ResourceConflictException)) throw error; }
console.log(JSON.stringify({ functionName, apiEndpoint: createdApi.endpoint, amplifyAppId, amplifyBranch }, null, 2));
