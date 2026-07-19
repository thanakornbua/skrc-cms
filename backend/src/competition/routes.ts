import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { calculateRankings, concludeCompetition, getCompetitionState, reopenCompetition } from "./repo.js";

export const competitionRouter = Router();

competitionRouter.get("/public/scoreboard", async (req, res, next) => {
  try {
    const state = await getCompetitionState();
    const results = state.phase === "CONCLUDED" && state.results ? state.results : await calculateRankings(false);
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const selected = category ? results.filter((item) => item.category === category) : results;
    res.status(200).json({ state: state.phase === "CONCLUDED" ? "FINAL" : "PROVISIONAL", categories: selected });
  } catch (error) { next(error); }
});

competitionRouter.post("/admin/competition/conclude", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!z.object({ confirm: z.literal("CONCLUDE") }).safeParse(req.body).success) {
      throw new ApiError(400, "VALIDATION_ERROR", "confirm must equal CONCLUDE");
    }
    res.status(200).json(await concludeCompetition(req.user!.username));
  } catch (error) { next(error); }
});

competitionRouter.post("/admin/competition/reopen", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try { await reopenCompetition(); res.status(200).json({ phase: "OPEN" }); } catch (error) { next(error); }
});

competitionRouter.get("/admin/competition/export", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const state = await getCompetitionState();
    if (state.phase !== "CONCLUDED" || !state.results) throw new ApiError(409, "CONFLICT", "Competition has not concluded");
    res.status(200).json({ categories: state.results });
  } catch (error) { next(error); }
});
