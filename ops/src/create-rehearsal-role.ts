import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { CreateRoleCommand, GetRoleCommand, IAMClient, NoSuchEntityException, PutRolePolicyCommand } from "@aws-sdk/client-iam";

const region = process.env.AWS_REGION ?? "ap-southeast-7";
const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const userPoolId = process.env.COGNITO_USER_POOL_ID;
if (!userPoolId) throw new Error("COGNITO_USER_POOL_ID is required");
const roleName = process.env.REHEARSAL_ROLE_NAME ?? "robo-compet-rehearsal-operator";
const sts = new STSClient({ region });
const iam = new IAMClient({ region });
const accountId = (await sts.send(new GetCallerIdentityCommand({}))).Account!;
const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;

try {
  await iam.send(new GetRoleCommand({ RoleName: roleName }));
} catch (error) {
  if (!(error instanceof NoSuchEntityException)) throw error;
  await iam.send(new CreateRoleCommand({
    RoleName: roleName,
    Description: "Least-privilege operator for the Robo Compet production rehearsal",
    MaxSessionDuration: 3600,
    AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: `arn:aws:iam::${accountId}:root` }, Action: "sts:AssumeRole", Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } }] }),
  }));
}

await iam.send(new PutRolePolicyCommand({
  RoleName: roleName,
  PolicyName: "robo-compet-rehearsal",
  PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [
    { Effect: "Allow", Action: ["dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:CreateBackup", "dynamodb:DescribeBackup", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"], Resource: [`arn:aws:dynamodb:${region}:${accountId}:table/${table}`, `arn:aws:dynamodb:${region}:${accountId}:table/${table}/index/*`, `arn:aws:dynamodb:${region}:${accountId}:table/${table}/backup/*`] },
    { Effect: "Allow", Action: ["cognito-idp:DescribeUserPool", "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminCreateUser", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminConfirmSignUp", "cognito-idp:AdminSetUserPassword", "cognito-idp:AdminAddUserToGroup", "cognito-idp:UpdateUserPool"], Resource: `arn:aws:cognito-idp:${region}:${accountId}:userpool/${userPoolId}` },
    { Effect: "Allow", Action: ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:ListEventSourceMappings", "sqs:GetQueueAttributes", "logs:DescribeLogGroups", "logs:FilterLogEvents"], Resource: "*" },
    { Effect: "Allow", Action: ["amplify:GetApp", "amplify:GetBranch", "amplify:GetJob", "amplify:ListJobs", "amplify:UpdateApp", "amplify:StartJob"], Resource: `arn:aws:amplify:ap-southeast-1:${accountId}:apps/*` },
  ] }),
}));

console.log(JSON.stringify({ roleName, roleArn, maxSessionSeconds: 3600 }, null, 2));
