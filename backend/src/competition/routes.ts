import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import {
  advanceCompetitionStage, calculateRankings, calculateStageRankings, concludeCompetition,
  decideMatchAdministratively, getCompetitionState, reopenCompetition, startSuddenDeathRound,
} from "./repo.js";
import { publicizeBrackets } from "./bracket.js";
import { actorOf } from "../auth/types.js";

export const competitionRouter = Router();

competitionRouter.get("/public/scoreboard", async (req, res, next) => {
  try {
    const state = await getCompetitionState();
    const results = state.phase === "CONCLUDED" && state.results ? state.results : await calculateRankings(false);
    const bracketResults = state.phase === "CONCLUDED"
      ? state.stageResults ?? {}
      : { ...(state.stageResults ?? {}), [state.activeStage]: await calculateStageRankings(state.activeStage, true) };
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const selected = category ? results.filter((item) => item.category === category) : results;
    res.status(200).json({
      state: state.phase === "CONCLUDED" ? "FINAL" : "PROVISIONAL",
      activeStage: state.activeStage,
      categories: selected,
      brackets: publicizeBrackets(
        category ? state.brackets?.filter((item) => item.category === category) : state.brackets,
        bracketResults,
      ),
    });
  } catch (error) { next(error); }
});

competitionRouter.get("/admin/competition/state", requireAuth, requireRole("committee"), async (_req, res, next) => {
  try {
    const state = await getCompetitionState();
    // The unsettled Final / third-place matches are what an operator needs to
    // open a Rule 6.6 round against, so they travel with the state rather than
    // making the console reconstruct them from the public scoreboard.
    const matches = (state.brackets ?? []).flatMap((bracket) => {
      const names = new Map(bracket.positions.map((item) => [item.competitorId, item.teamName]));
      return bracket.matches
        .filter((item) => (item.round === "FINAL" || item.round === "THIRD_PLACE") && !item.winnerId)
        .map((item) => ({
          category: bracket.category, matchId: item.matchId, round: item.round,
          teamA: names.get(item.teamAId) ?? item.teamAId,
          teamB: names.get(item.teamBId) ?? item.teamBId,
          startsFirst: names.get(item.startsFirstId) ?? item.startsFirstId,
          suddenDeath: (item.suddenDeath ?? []).map((round) => ({
            round: round.round, startsFirst: names.get(round.startsFirstId) ?? round.startsFirstId,
          })),
          settledAdministratively: Boolean(item.administrativeDecision),
        }));
    });
    res.status(200).json({
      phase: state.phase, activeStage: state.activeStage,
      eligibleCompetitorIds: state.eligibleCompetitorIds ?? [], matches,
    });
  } catch (error) { next(error); }
});

competitionRouter.post("/admin/competition/advance", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!z.object({ confirm: z.literal("ADVANCE") }).safeParse(req.body).success) {
      throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal ADVANCE");
    }
    const state = await advanceCompetitionStage(actorOf(req.user!));
    res.status(200).json({ phase: state.phase, activeStage: state.activeStage, eligibleCompetitorIds: state.eligibleCompetitorIds ?? [] });
  } catch (error) { next(error); }
});

competitionRouter.post("/admin/competition/conclude", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!z.object({ confirm: z.literal("CONCLUDE") }).safeParse(req.body).success) {
      throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal CONCLUDE");
    }
    res.status(200).json(await concludeCompetition(actorOf(req.user!)));
  } catch (error) { next(error); }
});

// Reopening undoes a PUBLISHED official result, so it carries the same
// confirmation guard as advance/conclude and additionally requires a written
// reason — Rule 10.2(2) keeps the superseded ranking in the record, and the
// reason is what makes that record meaningful.
competitionRouter.post("/admin/competition/reopen", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = z.object({
      confirm: z.literal("REOPEN"),
      reason: z.string().trim().min(1).max(400),
    }).safeParse(req.body);
    if (!input.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal REOPEN and reason is required");
    }
    await reopenCompetition(actorOf(req.user!), input.data.reason);
    res.status(200).json({ phase: "OPEN" });
  } catch (error) { next(error); }
});

// Rule 6.6: a tied Final or third-place match cannot resolve on the recorded
// times, so an admin opens an extra head-to-head attempt for both teams. The
// running order is re-randomised server-side each round, per 6.6(2).
competitionRouter.post("/admin/competition/sudden-death", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = z.object({
      confirm: z.literal("SUDDEN_DEATH"),
      category: z.string().trim().min(1),
      matchId: z.string().trim().min(1),
    }).safeParse(req.body);
    if (!input.success) throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal SUDDEN_DEATH with category and matchId");
    res.status(201).json(await startSuddenDeathRound(actorOf(req.user!), input.data.category, input.data.matchId));
  } catch (error) { next(error); }
});

// Rule 6.6(6): the last resort when the match cannot be run at all. Requires a
// written reason because it decides a podium place off the track.
competitionRouter.post("/admin/competition/sudden-death/administrative", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = z.object({
      confirm: z.literal("ADMINISTRATIVE"),
      category: z.string().trim().min(1),
      matchId: z.string().trim().min(1),
      reason: z.string().trim().min(1).max(400),
    }).safeParse(req.body);
    if (!input.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal ADMINISTRATIVE with category, matchId and reason");
    }
    const { category, matchId, reason } = input.data;
    res.status(200).json(await decideMatchAdministratively(actorOf(req.user!), category, matchId, reason));
  } catch (error) { next(error); }
});

competitionRouter.get("/admin/competition/export", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const state = await getCompetitionState();
    if (state.phase !== "CONCLUDED" || !state.results) throw new ApiError(409, "CONFLICT", "Competition has not concluded");
    res.status(200).json({ categories: state.results, brackets: publicizeBrackets(state.brackets, state.stageResults ?? {}) });
  } catch (error) { next(error); }
});
