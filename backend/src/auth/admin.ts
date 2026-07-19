import {
  AdminResetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InvalidParameterException,
  LimitExceededException,
  TooManyRequestsException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

const cognito = new CognitoIdentityProviderClient({ region: config.awsRegion });

/**
 * Starts Cognito's normal password-recovery flow. Cognito delivers the code;
 * staff never create, receive, or store a competitor password.
 */
export async function requestPasswordReset(cognitoSub: string): Promise<void> {
  try {
    await cognito.send(
      new AdminResetUserPasswordCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: cognitoSub,
      })
    );
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      throw new ApiError(404, "AUTH_USER_NOT_FOUND", "The competitor's portal account no longer exists");
    }
    if (error instanceof InvalidParameterException) {
      throw new ApiError(
        409,
        "RESET_DELIVERY_UNAVAILABLE",
        "Cognito cannot deliver a reset code. Verify the competitor's email in Cognito first."
      );
    }
    if (error instanceof LimitExceededException || error instanceof TooManyRequestsException) {
      throw new ApiError(429, "RESET_RATE_LIMITED", "Too many reset attempts. Please wait and try again.");
    }
    throw error;
  }
}
