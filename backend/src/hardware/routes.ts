import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireDeviceKey, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { getDeviceLaneState, listHardwareStatus, recordDeviceHeartbeat } from "./repo.js";

export const hardwareRouter = Router();

const deviceIdentity = z.object({
  deviceId: z.string().trim().min(1).max(96),
  laneId: z.string().trim().min(1).max(32),
});

hardwareRouter.post("/device/lane-state", (req, _res, next) => {
  const parsed = deviceIdentity.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, "VALIDATION_ERROR", "Invalid device identity", zodToFields(parsed.error)));
  req.body = parsed.data;
  next();
}, requireDeviceKey, async (req, res, next) => {
  try {
    res.status(200).json({ state: await getDeviceLaneState(req.body.deviceId, req.body.laneId) });
  } catch (error) { next(error); }
});

const heartbeatSchema = deviceIdentity.extend({
  serialPort: z.string().trim().min(1).max(256),
  bridgeSession: z.string().trim().min(8).max(160),
  state: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]),
  detail: z.string().trim().max(500).nullable().optional(),
});

hardwareRouter.post("/device/heartbeat", (req, _res, next) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, "VALIDATION_ERROR", "Invalid device heartbeat", zodToFields(parsed.error)));
  req.body = parsed.data;
  next();
}, requireDeviceKey, async (req, res, next) => {
  try {
    await recordDeviceHeartbeat({ ...req.body, detail: req.body.detail ?? null, lastSeenAt: new Date().toISOString() });
    res.status(202).json({ accepted: true });
  } catch (error) { next(error); }
});

hardwareRouter.get("/admin/hardware", requireAuth, requireRole("committee"), async (_req, res, next) => {
  try { res.status(200).json({ devices: await listHardwareStatus() }); }
  catch (error) { next(error); }
});

