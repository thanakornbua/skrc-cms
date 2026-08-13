import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";

// Competition-day connectivity can be a hotel/venue hotspot rather than a wired
// line. The SDK default (3 attempts, standard mode) is too thin for that; more
// attempts plus adaptive backoff absorb multi-second blips without surfacing
// them to the operator as a failed check-in/lane/penalty action.
const rawClient = new DynamoDBClient({ region: config.awsRegion, maxAttempts: 8, retryMode: "adaptive" });

export const ddbDoc = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = config.dynamoTable;
