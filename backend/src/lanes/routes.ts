import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { armLane, assignLane, listLanes, resetLane } from "./repo.js";
import { getCompetitor } from "../competitors/repo.js";
import { getCompetitionState } from "../competition/state.js";
import { STAGE_LABELS } from "../competition/types.js";
import { competitorIdSchema } from "../competitorId.js";
import { actorOf } from "../auth/types.js";

export const lanesRouter = Router();

const assignSchema = z.object({
  competitorId: competitorIdSchema,
});

/**
 * Lane state for a public display — the broadcast overlay and anything else
 * that shows what is happening on the field right now.
 *
 * Rule 10.1(2) allows team names and match status on a public screen; 10.1(3)
 * forbids the internal competitor number, so this deliberately resolves the ID
 * to a team name and never returns the ID itself. That is the whole reason it
 * exists separately from `/admin/lanes` rather than being that route unguarded.
 *
 * `serverTime` is included so a display can correct for clock skew between the
 * machine drawing the clock and the machine that stamped `runStartedAt`. Any
 * elapsed time derived from those two is a broadcast approximation; the
 * official time is the run record, taken from device timestamps (Rule 6.1(1)).
 */
lanesRouter.get("/public/lanes", async (_req, res, next) => {
  try {
    const [lanes, competition] = await Promise.all([listLanes(), getCompetitionState()]);
    const named = await Promise.all(lanes.map(async (lane) => ({
      laneId: lane.laneId,
      state: lane.state,
      teamName: lane.competitorId ? (await getCompetitor(lane.competitorId))?.teamName ?? null : null,
      runStartedAt: lane.runStartedAt,
    })));
    res.status(200).json({
      activeStage: competition.activeStage,
      stageLabel: STAGE_LABELS[competition.activeStage],
      serverTime: new Date().toISOString(),
      lanes: named,
    });
  } catch (err) {
    next(err);
  }
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
  requireRole("admin"),
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
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const lane = await armLane(req.params.laneId, actorOf(req.user!));
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
