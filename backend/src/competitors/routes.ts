import { Router } from "express";
import { requireAuth, requireRole, requireSelfOrStaff } from "../auth/middleware.js";
import { requestPasswordReset } from "../auth/admin.js";
import { z } from "zod";
import { ApiError, zodToFields } from "../errors.js";
import { checkIn, disqualifyCompetitor, getCompetitor, inspectCompetitor, listCompetitors, recordPasswordResetRequest, reinstateCompetitor, scanProfiles } from "./repo.js";
import { getActiveLaneForCompetitor } from "../lanes/repo.js";
import { listRuns } from "../runs/repo.js";
import { listAppliedPenalties, listCorrections } from "../timing/repo.js";
import { getCompetitorRank, getFrozenStageResult } from "../competition/repo.js";
import { getCompetitionState, isEligibleForStage } from "../competition/state.js";
import { scoreCompetitorStage } from "../competition/scoring.js";
import type { StageRankedResult } from "../competition/types.js";

export const competitorsRouter = Router();

competitorsRouter.get(
  "/competitors/:id",
  requireAuth,
  requireSelfOrStaff,
  async (req, res, next) => {
    try {
      const competitor = await getCompetitor(req.params.id);
      if (!competitor) throw new ApiError(404, "NOT_FOUND", "Competitor not found");

      const lane = await getActiveLaneForCompetitor(competitor.competitorId);
      const competition = await getCompetitionState();
      const [runs, corrections, penalties] = await Promise.all([
        listRuns(competitor.competitorId), listCorrections(competitor.competitorId),
        listAppliedPenalties(competitor.competitorId),
      ]);
      const eligible = isEligibleForStage(competition, competitor.competitorId);
      const eliminated = !eligible && competition.activeStage !== "ROUND_1";
      let resultStage = competition.activeStage;
      let stageResult: StageRankedResult | Omit<StageRankedResult, "rank"> | null;
      let rank: number | null;
      if (eligible) {
        stageResult = scoreCompetitorStage({ competitor, runs, corrections, penalties }, resultStage);
        rank = await getCompetitorRank(competitor.category, competitor.competitorId);
        // Just advanced, no runs yet in the new active stage — show the frozen
        // result from the stage they just completed instead of a blank summary.
        if (!stageResult) {
          const frozen = getFrozenStageResult(competition, competitor.category, competitor.competitorId);
          if (frozen) {
            resultStage = frozen.stage;
            stageResult = frozen.result;
            rank = frozen.rank;
          }
        }
      } else {
        const frozen = getFrozenStageResult(competition, competitor.category, competitor.competitorId);
        resultStage = frozen?.stage ?? competition.activeStage;
        stageResult = frozen?.result ?? null;
        rank = frozen?.rank ?? null;
      }
      const correctionByRun = new Map(corrections.map((item) => [item.runId, item]));

      res.status(200).json({
        competitorId: competitor.competitorId,
        name: competitor.name,
        teamName: competitor.teamName,
        category: competitor.category,
        status: competitor.status,
        checkedInAt: competitor.checkedInAt,
        inspectedAt: competitor.inspectedAt,
        disqualified: competitor.disqualified,
        lane,
        penalties: penalties.map(({ byUser: _byUser, ...penalty }) => penalty),
        runs: runs.map((run) => ({
          runId: run.runId,
          stage: run.stage ?? "ROUND_1",
          laneId: run.laneId,
          startDeviceTs: run.startDeviceTs,
          stopDeviceTs: run.stopDeviceTs,
          elapsedMs: run.elapsedMs,
          splits: run.splits,
          status: run.status ?? "RUNNING",
          minTimeMs: run.minTimeMs,
          maxTimeMs: run.maxTimeMs,
          correction: correctionByRun.has(run.runId)
            ? (() => { const { byUser: _byUser, ...correction } = correctionByRun.get(run.runId)!; return correction; })()
            : null,
          reviewResolution: run.reviewResolution ?? null,
          createdAt: run.createdAt,
        })),
        stageResult: stageResult
          ? (() => { const { competitorId: _id, rank: _rank, tieTimestamp: _tie, ...result } = stageResult as unknown as StageRankedResult; return result; })()
          : null,
        aggregateTimeMs: stageResult?.aggregateTimeMs ?? null,
        penaltyTimeMs: stageResult?.penaltyTimeMs ?? 0,
        finalTimeMs: stageResult?.finalTimeMs ?? null,
        activeStage: competition.activeStage,
        resultStage,
        eliminated,
        rank,
      });
    } catch (err) {
      next(err);
    }
  }
);

competitorsRouter.get(
  "/admin/competitors",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      const { category, status, q } = req.query;
      const search = typeof q === "string" ? q.trim() : "";
      const items = await listCompetitors({
        category: typeof category === "string" ? category : undefined,
        status: typeof status === "string" ? status : undefined,
        q: search,
      });

      res.status(200).json({
        items: items.map((c) => ({
          competitorId: c.competitorId,
          name: c.name,
          teamName: c.teamName,
          category: c.category,
          status: c.status,
          disqualified: { bool: c.disqualified.bool },
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

competitorsRouter.post(
  "/admin/competitors/:id/check-in",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const result = await checkIn(req.params.id, req.user!.username);
      res.status(200).json({
        status: result.status,
        checkedInAt: result.checkedInAt,
        ...(result.alreadyCheckedIn ? { notice: "already checked in" } : {}),
      });
    } catch (err) {
      next(err);
    }
  }
);

const COMPETITOR_CSV_COLUMNS = [
  "competitorId", "status", "teamName", "category", "school", "certificateLanguage",
  "advisorNameThai", "advisorNameEnglish", "advisorEmail", "advisorPhone", "contactEmail", "contactPhone",
  "student1NameThai", "student1NameEnglish", "student2NameThai", "student2NameEnglish",
  "student3NameThai", "student3NameEnglish", "pdpaConsent", "cognitoSub",
  "checkedInAt", "checkedInBy", "inspectedAt", "disqualified", "createdAt",
];
const REGISTRATION_CSV_COLUMNS = [
  "PK", "status", "teamName", "category", "school", "certificateLanguage",
  "advisorNameThai", "advisorNameEnglish", "advisorEmail", "advisorPhone", "contactEmail", "contactPhone",
  "student1NameThai", "student1NameEnglish", "student2NameThai", "student2NameEnglish",
  "student3NameThai", "student3NameEnglish", "pdpaConsent", "rejection", "approval", "createdAt",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

competitorsRouter.get("/export.csv", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const entity = req.query.entity;
    if (entity !== "registrations" && entity !== "competitors") {
      throw new ApiError(400, "VALIDATION_ERROR", "entity must be registrations or competitors");
    }
    const columns = entity === "registrations" ? REGISTRATION_CSV_COLUMNS : COMPETITOR_CSV_COLUMNS;
    const items = await scanProfiles(entity === "registrations" ? "REGISTRATION" : "COMPETITOR");
    const rows = [columns.join(","), ...items.map((item) => columns.map((column) => csvCell(item[column])).join(","))];
    res.status(200)
      .type("text/csv")
      .attachment(`${entity}.csv`)
      .send(`${rows.join("\r\n")}\r\n`);
  } catch (error) { next(error); }
});

competitorsRouter.post(
  "/admin/competitors/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const competitor = await getCompetitor(req.params.id);
      if (!competitor) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
      if (!competitor.cognitoSub) {
        throw new ApiError(409, "PORTAL_ACCOUNT_UNLINKED", "This competitor has no linked portal account");
      }

      await requestPasswordReset(competitor.cognitoSub);
      const requestedAt = new Date().toISOString();
      await recordPasswordResetRequest(competitor.competitorId, req.user!.username, requestedAt);
      res.status(202).json({ status: "RESET_CODE_SENT", requestedAt });
    } catch (error) {
      next(error);
    }
  }
);

const reasonSchema = z.object({ reason: z.string().trim().min(1) });

competitorsRouter.post("/committee/competitors/:id/disqualify", requireAuth, requireRole("committee"), async (req, res, next) => {
  try {
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_ERROR", "reason is required", zodToFields(parsed.error));
    const { bool, reason, at } = await disqualifyCompetitor(req.params.id, parsed.data.reason, req.user!.username);
    res.status(200).json({ disqualified: { bool, reason, at } });
  } catch (error) { next(error); }
});

competitorsRouter.post("/admin/competitors/:id/reinstate", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_ERROR", "reason is required", zodToFields(parsed.error));
    await reinstateCompetitor(req.params.id, parsed.data.reason, req.user!.username);
    res.status(200).json({ disqualified: { bool: false } });
  } catch (error) { next(error); }
});

competitorsRouter.post(
  "/committee/competitors/:id/inspect",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      const result = await inspectCompetitor(req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
