import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { armLane, assignLane, listLanes, resetLane } from "./repo.js";

export const lanesRouter = Router();

const assignSchema = z.object({
  competitorId: z.string().trim().min(1),
});

lanesRouter.get(
  "/admin/lanes",
  requireAuth,
  requireRole("committee"),
  async (_req, res, next) => {
    try {
      const lanes = await listLanes();
      res.status(200).json({
        lanes: lanes.map((l) => ({
          laneId: l.laneId,
          state: l.state,
          competitorId: l.competitorId,
          deviceId: l.deviceId,
          armedBy: l.armedBy,
          runStartedAt: l.runStartedAt,
          updatedAt: l.updatedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

lanesRouter.post(
  "/admin/lanes/:laneId/assign",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "competitorId is required",
          zodToFields(parsed.error)
        );
      }
      const lane = await assignLane(req.params.laneId, parsed.data.competitorId);
      res.status(200).json({
        laneId: lane.laneId,
        state: lane.state,
        competitorId: lane.competitorId,
      });
    } catch (err) {
      next(err);
    }
  }
);

lanesRouter.post(
  "/admin/lanes/:laneId/arm",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      const lane = await armLane(req.params.laneId, req.user!.username);
      res.status(200).json({
        laneId: lane.laneId,
        state: lane.state,
        armedBy: lane.armedBy,
      });
    } catch (err) {
      next(err);
    }
  }
);

lanesRouter.post(
  "/admin/lanes/:laneId/reset",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const lane = await resetLane(req.params.laneId);
      res.status(200).json({ laneId: lane.laneId, state: lane.state });
    } catch (err) {
      next(err);
    }
  }
);
