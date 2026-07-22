import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config.js";
import type { Role } from "./types.js";

export type AuthFailureCategory =
  | "missing_token"
  | "expired_token"
  | "wrong_pool"
  | "wrong_client"
  | "wrong_token_use"
  | "invalid_signature";

/**
 * Converts verifier failures into stable, token-safe operational categories.
 * The original verifier error must never be logged because it can contain
 * untrusted JWT-derived values.
 */
export function classifyJwtVerificationFailure(error: unknown): Exclude<AuthFailureCategory, "missing_token"> {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "JwtExpiredError" || message.includes("expired")) return "expired_token";
  if (message.includes("token use") || message.includes("token_use")) return "wrong_token_use";
  if (message.includes("client id") || message.includes("client_id") || message.includes("audience")) return "wrong_client";
  if (message.includes("issuer") || message.includes("user pool")) return "wrong_pool";
  return "invalid_signature";
}

/**
 * Framework-agnostic Cognito ID-token verification and role derivation.
 * Phase 3's registration-week Lambda imports this same module so both
 * deploy targets share one implementation of the auth rules.
 */

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognitoUserPoolId,
      tokenUse: "id",
      clientId: config.cognitoClientId,
    });
  }
  return verifier;
}

export interface VerifiedClaims {
  sub: string;
  username: string;
  email: string | undefined;
  groups: string[];
  competitorId: string | null;
}

export async function verifyIdToken(token: string): Promise<VerifiedClaims> {
  const payload = await getVerifier().verify(token);
  const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
  const competitorId =
    (payload["custom:competitorId"] as string | undefined) ?? null;
  const username = (payload["cognito:username"] as string | undefined) ?? payload.sub;
  const email = payload["email"] as string | undefined;
  return { sub: payload.sub, username, email, groups, competitorId };
}

export function deriveRole(claims: VerifiedClaims): Role {
  if (claims.groups.includes("admin")) return "admin";
  if (claims.groups.includes("committee")) return "committee";
  return "competitor";
}

export function extractBearerToken(
  authorizationHeader: string | undefined
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
