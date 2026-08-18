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
import { onFieldChanged } from "./events.js";

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
async function publicLanesSnapshot() {
  const [lanes, competition] = await Promise.all([listLanes(), getCompetitionState()]);
  const named = await Promise.all(lanes.map(async (lane) => ({
    laneId: lane.laneId,
    state: lane.state,
    teamName: lane.competitorId ? (await getCompetitor(lane.competitorId))?.teamName ?? null : null,
    runStartedAt: lane.runStartedAt,
  })));
  return {
    activeStage: competition.activeStage,
    stageLabel: STAGE_LABELS[competition.activeStage],
    serverTime: new Date().toISOString(),
    lanes: named,
  };
}

lanesRouter.get("/public/lanes", async (_req, res, next) => {
  try {
    res.status(200).json(await publicLanesSnapshot());
  } catch (err) {
    next(err);
  }
});

/**
 * The same snapshot, pushed. A display opening this gets the current state at
 * once and every later change as it happens, so a team name reaches the screen
 * in the same moment the operator arms the lane rather than at the next poll.
 *
 * A slow refresh still runs underneath: it costs one read every few seconds and
 * covers anything that changed without emitting — a write from another process
 * during rehearsal, or a missed event. Errors are sent as an `error` event
 * rather than closing the stream, since the usual cause is a table read that
 * fails before an operator has signed in and will start working on its own.
 */
lanesRouter.get("/public/lanes/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  let closed = false;
  let sending = false;
  let pending = false;

  const send = async (): Promise<void> => {
    if (closed) return;
    // Coalesce: several writes landing together should produce one snapshot,
    // and a slow read must not queue up a burst behind it.
    if (sending) { pending = true; return; }
    sending = true;
    try {
      const snapshot = await publicLanesSnapshot();
      if (!closed) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!closed) res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      sending = false;
      if (pending && !closed) { pending = false; void send(); }
    }
  };

  await send();
  const unsubscribe = onFieldChanged(() => { void send(); });
  const safetyRefresh = setInterval(() => { void send(); }, 5000);
  // Proxies and idle timeouts drop a stream that says nothing; a comment line
  // is not an event and costs nothing on the display side.
  const keepAlive = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 15000);

  req.on("close", () => {
    closed = true;
    unsubscribe();
    clearInterval(safetyRefresh);
    clearInterval(keepAlive);
  });
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
