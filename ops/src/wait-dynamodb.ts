import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB ?? "http://127.0.0.1:18000";
const client = new DynamoDBClient({ endpoint, region: "ap-southeast-7", credentials: { accessKeyId: "local", secretAccessKey: "local" } });

for (let attempt = 1; attempt <= 30; attempt++) {
  try {
    await client.send(new ListTablesCommand({ Limit: 1 }));
    console.log(`DynamoDB Local ready at ${endpoint}`);
    process.exit(0);
  } catch (error) {
    if (attempt === 30) throw new Error(`DynamoDB Local did not become ready at ${endpoint}`, { cause: error });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
