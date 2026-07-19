import { ApiError } from "../errors.js";
import {
  deriveRole,
  extractBearerToken,
  verifyIdToken,
  type VerifiedClaims,
} from "../auth/verifyToken.js";
import type { Role } from "../auth/types.js";

export interface RegweekUser {
  sub: string;
  username: string;
  email: string | undefined;
  role: Role;
  competitorId: string | null;
}

export async function authenticate(
  authorizationHeader: string | undefined
): Promise<RegweekUser> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token");

  let claims: VerifiedClaims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
  }

  return {
    sub: claims.sub,
    username: claims.username,
    email: claims.email,
    role: deriveRole(claims),
    competitorId: claims.competitorId,
  };
}

/** Admin passes every committee check — admin is a superset everywhere. */
export function requireRole(user: RegweekUser, role: Role): void {
  if (user.role === "admin" || user.role === role) return;
  throw new ApiError(403, "FORBIDDEN", `Requires ${role} role`);
}

/**
 * D16: staff cannot compete. Unlike requireRole, admin does NOT pass this
 * check — registration routes are for competitors exclusively.
 */
export function requireCompetitorOnly(user: RegweekUser): void {
  if (user.role === "competitor") return;
  throw new ApiError(403, "FORBIDDEN", "Staff accounts cannot register for the competition");
}

/** D18: admin only — committee does NOT pass (CSV export contains PII). */
export function requireAdminOnly(user: RegweekUser): void {
  if (user.role === "admin") return;
  throw new ApiError(403, "FORBIDDEN", "Requires admin role");
}
