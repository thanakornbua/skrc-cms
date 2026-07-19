import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const TABLE_NAME = process.env.DYNAMO_TABLE ?? "robo-compet";

const client = new DynamoDBClient({ region: REGION });

async function tableExists(): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false;
    throw err;
  }
}

async function main() {
  if (await tableExists()) {
    console.log(
      `Table "${TABLE_NAME}" already exists in ${REGION} — nothing to do.`
    );
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
    })
  );

  console.log("Waiting for table to become ACTIVE...");
  await waitUntilTableExists(
    { client, maxWaitTime: 120 },
    { TableName: TABLE_NAME }
  );

  console.log(`Table "${TABLE_NAME}" is ACTIVE with GSI1.`);
}

main().catch((err) => {
  console.error("create-table failed:", err);
  process.exit(1);
});
