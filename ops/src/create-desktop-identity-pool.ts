/**
 * Provisions the Cognito identity pool that gives the packaged desktop console
 * short-lived AWS credentials, so the operator laptop never holds a long-lived
 * IAM access key.
 *
 * The pool trusts the existing user pool and grants an authenticated role that
 * can touch only the competition table. Authenticated identities are required —
 * unauthenticated (guest) access stays off, so an unsigned-in machine gets
 * nothing at all.
 *
 * Idempotent: re-running updates the role policy and the pool's provider list
 * in place.
 */
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  IAMClient, CreateRoleCommand, GetRoleCommand, PutRolePolicyCommand, NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  CognitoIdentityClient, CreateIdentityPoolCommand, ListIdentityPoolsCommand,
  SetIdentityPoolRolesCommand, UpdateIdentityPoolCommand,
} from "@aws-sdk/client-cognito-identity";

const region = process.env.AWS_REGION ?? "ap-southeast-7";
const prefix = process.env.RESOURCE_PREFIX ?? "robo-compet";
const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const poolId = process.env.COGNITO_USER_POOL_ID;
const clientId = process.env.COGNITO_CLIENT_ID;
if (!poolId || !clientId) throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required");

const identityPoolName = `${prefix}-desktop`;
const roleName = `${prefix}-desktop-operator-role`;
const providerName = `cognito-idp.${region}.amazonaws.com/${poolId}`;

const iam = new IAMClient({ region });
const identity = new CognitoIdentityClient({ region });
const sts = new STSClient({ region });
const account = (await sts.send(new GetCallerIdentityCommand({}))).Account!;

async function findIdentityPool(): Promise<string | null> {
  let nextToken: string | undefined;
  do {
    const page = await identity.send(new ListIdentityPoolsCommand({ MaxResults: 60, NextToken: nextToken }));
    const found = page.IdentityPools?.find((pool) => pool.IdentityPoolName === identityPoolName);
    if (found?.IdentityPoolId) return found.IdentityPoolId;
    nextToken = page.NextToken;
  } while (nextToken);
  return null;
}

const existing = await findIdentityPool();
const identityPoolId = existing ?? (await identity.send(new CreateIdentityPoolCommand({
  IdentityPoolName: identityPoolName,
  AllowUnauthenticatedIdentities: false,
  CognitoIdentityProviders: [{ ProviderName: providerName, ClientId: clientId, ServerSideTokenCheck: true }],
}))).IdentityPoolId!;

if (existing) {
  await identity.send(new UpdateIdentityPoolCommand({
    IdentityPoolId: identityPoolId,
    IdentityPoolName: identityPoolName,
    AllowUnauthenticatedIdentities: false,
    CognitoIdentityProviders: [{ ProviderName: providerName, ClientId: clientId, ServerSideTokenCheck: true }],
  }));
}

// Only identities authenticated against this identity pool may assume the role,
// and only in the "authenticated" role mapping.
const trustPolicy = {
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { Federated: "cognito-identity.amazonaws.com" },
    Action: "sts:AssumeRoleWithWebIdentity",
    Condition: {
      StringEquals: { "cognito-identity.amazonaws.com:aud": identityPoolId },
      "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" },
    },
  }],
};

async function ensureRole(): Promise<string> {
  try {
    return (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role!.Arn!;
  } catch (error) {
    if (!(error instanceof NoSuchEntityException)) throw error;
    const created = await iam.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
      Description: "Short-lived competition-day desktop console access to the competition table",
    }));
    return created.Role!.Arn!;
  }
}

const roleArn = await ensureRole();
const tableArn = `arn:aws:dynamodb:${region}:${account}:table/${table}`;

await iam.send(new PutRolePolicyCommand({
  RoleName: roleName,
  PolicyName: `${prefix}-desktop-table-access`,
  PolicyDocument: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: [
        "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
        "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem", "dynamodb:TransactGetItems", "dynamodb:TransactWriteItems",
      ],
      // The console never deletes official records (Rule 10.2(2)), so
      // dynamodb:DeleteItem is deliberately absent from this role.
      Resource: [tableArn, `${tableArn}/index/*`],
    }],
  }),
}));

await identity.send(new SetIdentityPoolRolesCommand({
  IdentityPoolId: identityPoolId,
  Roles: { authenticated: roleArn },
}));

console.log(`Identity pool: ${identityPoolId}`);
console.log(`Authenticated role: ${roleArn}`);
console.log("");
console.log("Add this to desktop/competition-day.env on the operator laptop:");
console.log(`COGNITO_IDENTITY_POOL_ID=${identityPoolId}`);
