import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { operatorCredentials, usesOperatorCredentials } from "./credentials.js";

// Competition-day connectivity can be a hotel/venue hotspot rather than a wired
// line. The SDK default (3 attempts, standard mode) is too thin for that; more
// attempts plus adaptive backoff absorb multi-second blips without surfacing
// them to the operator as a failed check-in/lane/penalty action.
const rawClient = new DynamoDBClient({
  region: config.awsRegion,
  maxAttempts: 8,
  retryMode: "adaptive",
  // In Lambda this stays undefined and the execution role applies. On the
  // desktop console it resolves the signed-in operator's short-lived
  // identity-pool credentials instead of a long-lived key on disk.
  ...(usesOperatorCredentials() ? { credentials: operatorCredentials } : {}),
});

export const ddbDoc = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = config.dynamoTable;
