import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config.js";
import type { Role } from "./types.js";

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
