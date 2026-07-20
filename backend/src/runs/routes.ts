import { Router } from "express";
import { z } from "zod";
import { requireDeviceKey } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { processGateEvent } from "./repo.js";

export const runsRouter = Router();
const schema = z.object({
  eventId: z.string().trim().min(1), deviceId: z.string().trim().min(1),
  laneId: z.string().trim().min(1), gateId: z.string().trim().min(1),
  type: z.enum(["START", "CHECKPOINT", "STOP"]),
  deviceTs: z.number().int().nonnegative(),
});

runsRouter.post("/gate-events", (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    next(new ApiError(400, "VALIDATION_ERROR", "Invalid gate event", zodToFields(parsed.error)));
    return;
  }
  // Authenticate only after structural validation. Malformed JSON bodies are
  // contract-level 400s; only well-formed events can be device-auth failures.
  req.body = parsed.data;
  next();
}, requireDeviceKey, async (req, res, next) => {
  try {
    res.status(200).json(await processGateEvent(req.body));
  } catch (error) { next(error); }
});
