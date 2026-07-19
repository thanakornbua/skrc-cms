import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { deriveRole, extractBearerToken, verifyIdToken } from "./verifyToken.js";
import type { Role } from "./types.js";

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing bearer token"));
    return;
  }

  try {
    const claims = await verifyIdToken(token);
    req.user = {
      sub: claims.sub,
      username: claims.username,
      role: deriveRole(claims),
      competitorId: claims.competitorId,
    };
    next();
  } catch {
    next(new ApiError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }
}

/** Admin passes every committee check — admin is a superset everywhere. */
export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, "UNAUTHORIZED", "Missing auth"));
      return;
    }
    if (req.user.role === "admin" || req.user.role === role) {
      next();
      return;
    }
    next(new ApiError(403, "FORBIDDEN", `Requires ${role} role`));
  };
}

/** Competitor may only access resources matching their token's competitorId. */
export function requireCompetitorSelf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing auth"));
    return;
  }
  if (req.user.role !== "competitor" || req.user.competitorId !== req.params.id) {
    next(new ApiError(403, "FORBIDDEN", "Cannot access another competitor's data"));
    return;
  }
  next();
}

/** Staff (committee/admin) always pass; a competitor may only access their own record. */
export function requireSelfOrStaff(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing auth"));
    return;
  }
  if (req.user.role === "admin" || req.user.role === "committee") {
    next();
    return;
  }
  if (req.user.role === "competitor" && req.user.competitorId === req.params.id) {
    next();
    return;
  }
  next(new ApiError(403, "FORBIDDEN", "Cannot access another competitor's data"));
}

/** Device auth for ESP32 gate events (Phase 7) — no Cognito token involved. */
export function requireDeviceKey(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const key = req.headers["x-device-key"];
  const deviceId = (req.body as { deviceId?: string } | undefined)?.deviceId;
  if (typeof key !== "string" || !deviceId) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing device key or deviceId"));
    return;
  }
  if (config.deviceKeys[deviceId] !== key) {
    next(new ApiError(401, "UNAUTHORIZED", "Invalid device key"));
    return;
  }
  next();
}
