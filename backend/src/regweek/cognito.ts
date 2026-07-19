import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "../config.js";

const cognito = new CognitoIdentityProviderClient({ region: config.awsRegion });

export async function stampCompetitorId(
  sub: string,
  competitorId: string
): Promise<void> {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: config.cognitoUserPoolId,
      Username: sub,
      UserAttributes: [{ Name: "custom:competitorId", Value: competitorId }],
    })
  );
}
