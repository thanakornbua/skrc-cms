import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const TABLE_NAME = process.env.DYNAMO_TABLE ?? "robo-compet";

const client = new DynamoDBClient({ region: REGION });

async function describeTable() {
  try {
    return (await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }))).Table;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null;
    throw err;
  }
}

async function ensureStreamAndTtl(): Promise<void> {
  const table = await describeTable();
  if (!table?.StreamSpecification?.StreamEnabled || table.StreamSpecification.StreamViewType !== "NEW_AND_OLD_IMAGES") {
    console.log(`Enabling NEW_AND_OLD_IMAGES stream on "${TABLE_NAME}"...`);
    await client.send(new UpdateTableCommand({
      TableName: TABLE_NAME,
      StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
    }));
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: TABLE_NAME });
  }

  const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName: TABLE_NAME }));
  if (ttl.TimeToLiveDescription?.TimeToLiveStatus === "DISABLED") {
    console.log(`Enabling TTL attribute "expiresAt" on "${TABLE_NAME}"...`);
    await client.send(new UpdateTimeToLiveCommand({
      TableName: TABLE_NAME,
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    }));
  }
}

async function main() {
  if (await describeTable()) {
    console.log(`Table "${TABLE_NAME}" already exists in ${REGION} — checking stream and TTL.`);
    await ensureStreamAndTtl();
    return;
  }

  console.log(`Creating table "${TABLE_NAME}" in ${REGION}...`);

  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
    })
  );

  console.log("Waiting for table to become ACTIVE...");
  await waitUntilTableExists(
    { client, maxWaitTime: 120 },
    { TableName: TABLE_NAME }
  );

  await ensureStreamAndTtl();
  console.log(`Table "${TABLE_NAME}" is ACTIVE with GSI1, stream, and TTL.`);
}

main().catch((err) => {
  console.error("create-table failed:", err);
  process.exit(1);
});
