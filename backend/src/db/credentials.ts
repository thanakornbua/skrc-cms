import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { config } from "../config.js";

/**
 * Competition-day credentials for the packaged desktop console.
 *
 * In Lambda the execution role supplies credentials and none of this runs. On
 * the operator laptop there is no execution role, and the alternative — a
 * long-lived IAM access key sitting in a file beside the EXE — is exactly what
 * we do not want on a machine that travels to a venue. Instead the operator's
 * own Cognito sign-in is exchanged for short-lived, role-scoped credentials.
 *
 * The token is captured from ordinary authenticated API traffic (see
 * captureOperatorCredentials), so nothing extra has to be transferred: the
 * bearer token the console already sends IS the identity-pool login.
 */

let operatorIdToken: string | null = null;
let provider: AwsCredentialIdentityProvider | null = null;
let providerToken: string | null = null;

/** True when this process should mint credentials from an operator sign-in. */
export function usesOperatorCredentials(): boolean {
  return Boolean(config.cognitoIdentityPoolId);
}

/**
 * Records the verified ID token of a staff operator. Called on each
 * authenticated request, so a refreshed token replaces an expiring one without
 * the operator noticing.
 */
export function setOperatorIdToken(idToken: string): void {
  if (idToken === operatorIdToken) return;
  operatorIdToken = idToken;
  // Force a rebuild so the next AWS call exchanges the new token rather than
  // holding a provider closed over the old one.
  provider = null;
}

export function hasOperatorCredentials(): boolean {
  return operatorIdToken !== null;
}

/**
 * Credential provider handed to the DynamoDB client. It is called per request
 * (and cached by the SDK until expiry), so it must fail loudly rather than
 * silently falling back to some other credential source.
 */
export const operatorCredentials: AwsCredentialIdentityProvider = async (awsIdentityProperties) => {
  if (!operatorIdToken) {
    throw new Error(
      "No operator is signed in yet, so AWS credentials cannot be issued. Sign in to the console first."
    );
  }
  if (!provider || providerToken !== operatorIdToken) {
    const loginProvider = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`;
    provider = fromCognitoIdentityPool({
      identityPoolId: config.cognitoIdentityPoolId!,
      clientConfig: { region: config.awsRegion },
      logins: { [loginProvider]: operatorIdToken },
    });
    providerToken = operatorIdToken;
  }
  return provider(awsIdentityProperties);
};
