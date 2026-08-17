import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { endAttemptAtMaxTime,
  applyPenalty, correctRun, createPenaltyRule, listCategoryTimings,
  listPenaltyRules, putCategoryTiming, resolveUnderReview, revokePenalty,
  updatePenaltyRule, voidRun,
} from "./repo.js";
import { assignLane, armLane } from "../lanes/repo.js";
import { competitorIdParam } from "../competitorId.js";
import { actorOf } from "../auth/types.js";

export const timingRouter = Router();

// Every `:id` on this router is a competitor number; accept scanned/typed
// variants like `c-14` and resolve them to the canonical `C-0014`.
timingRouter.param("id", competitorIdParam);
const timingSchema = z.object({
  category: z.string().trim().min(1),
  minTimeMs: z.number().int().positive(),
  stageMaxTimeMs: z.object({
    ROUND_1: z.number().int().positive(),
    BEST_OF_4: z.number().int().positive(),
    BEST_OF_2: z.number().int().positive(),
    THE_BEST: z.number().int().positive(),
  }),
}).superRefine((data, context) => {
  for (const stage of ["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"] as const) if (data.minTimeMs >= data.stageMaxTimeMs[stage]) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `minTimeMs must be less than ${stage} maximum`, path: ["minTimeMs"] });
  }
});
const ruleSchema = z.object({ label: z.string().trim().min(1), penaltyMs: z.number().int().positive(), kind: z.literal("INTERVENTION").optional() });
const ruleUpdateSchema = ruleSchema.extend({ active: z.boolean() });
const applySchema = z.object({ ruleId: z.string().trim().min(1), runId: z.string().trim().min(1).optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(1) });
const resolveSchema = reasonSchema.extend({ decision: z.enum(["consume", "void"]) });
const correctionSchema = reasonSchema.extend({ elapsedMs: z.number().int().positive() });
const endRunSchema = z.object({
  // NO_SHOW and GRACE_EXPIRED can apply when no run was ever started; the rest
  // end an in-flight one. The handler resolves which case applies.
  resolution: z.enum(["STALLED", "FORFEIT", "GRACE_EXPIRED", "NO_SHOW", "OFFICIAL_STOP", "RESTART_LIMIT"]),
  reason: z.string().trim().min(1).max(400),
});

const redoSchema = reasonSchema.extend({ laneId: z.string().trim().min(1) });

function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid request", zodToFields(result.error));
  return result.data;
}

timingRouter.get("/admin/config/categories", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try { res.status(200).json({ categories: await listCategoryTimings() }); } catch (error) { next(error); }
});
timingRouter.put("/admin/config/categories", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(timingSchema, req.body);
    res.status(200).json(await putCategoryTiming(input.category, input.minTimeMs, input.stageMaxTimeMs, actorOf(req.user!)));
  } catch (error) { next(error); }
});
timingRouter.get("/admin/config/penalties", requireAuth, requireRole("committee"), async (_req, res, next) => {
  try { res.status(200).json({ rules: await listPenaltyRules() }); } catch (error) { next(error); }
});
timingRouter.post("/admin/config/penalties", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(ruleSchema, req.body);
    res.status(201).json(await createPenaltyRule(input.label, input.penaltyMs, actorOf(req.user!), input.kind));
  } catch (error) { next(error); }
});
timingRouter.put("/admin/config/penalties/:ruleId", requireAuth, requireRole("admin"), async (req, res, next) => {
  try { res.status(200).json(await updatePenaltyRule(req.params.ruleId, parsed(ruleUpdateSchema, req.body), actorOf(req.user!))); }
  catch (error) { next(error); }
});
// runId is required in practice to charge Rule 7.3's per-attempt intervention
// count, but stays optional here so any other, non-run-scoped penalty still works.
timingRouter.post("/committee/competitors/:id/penalties", requireAuth, requireRole("committee"), async (req, res, next) => {
  try {
    const input = parsed(applySchema, req.body);
    const applied = await applyPenalty(req.params.id, input.ruleId, actorOf(req.user!), input.runId);
    // A third intervention creates no penalty record — it ends the run
    // (Rule 7.3(3)) — so it answers 200 with the outcome rather than 201.
    res.status(applied.outcome === "APPLIED" ? 201 : 200).json(applied);
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/penalties/:penaltySk/revoke", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(reasonSchema, req.body);
    res.status(200).json(await revokePenalty(req.params.id, req.params.penaltySk, input.reason, actorOf(req.user!)));
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/runs/:runId/resolve", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(resolveSchema, req.body);
    await resolveUnderReview(req.params.id, req.params.runId, input.decision, input.reason, actorOf(req.user!));
    res.status(200).json({ status: input.decision === "consume" ? "INVALID" : "VOID" });
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/runs/:runId/correct", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(correctionSchema, req.body);
    res.status(201).json(await correctRun(req.params.id, req.params.runId, input.elapsedMs, input.reason, actorOf(req.user!)));
  } catch (error) { next(error); }
});
// Revoke: administratively void an already-finished run (Rule 5.5 gives this
// authority to "เจ้าหน้าที่" generally, not only ผู้ดูแลระบบ/admin — committee may
// call it too; admin passes every committee check). Voiding does not consume an
// attempt, so this also frees the competitor for a redo, but granting that redo
// (an actual new attempt on a lane) stays admin-only below. Idempotent: voiding
// an already-void run is a no-op success, so committee can flag it and admin can
// still call redo without a race.
timingRouter.post("/admin/competitors/:id/runs/:runId/void", requireAuth, requireRole("committee"), async (req, res, next) => {
  try {
    const input = parsed(reasonSchema, req.body);
    await voidRun(req.params.id, req.params.runId, input.reason, actorOf(req.user!));
    res.status(200).json({ status: "VOID" });
  } catch (error) { next(error); }
});
// End at max time: the run happened (or should have) and ends without a STOP —
// a stall, a forfeit, an official stopping it, an expired grace period, or a
// team that never presented. The attempt is CONSUMED at the stage maximum,
// which is what separates this from /void; using void for these would refund
// the attempt and reward the situation. Committee-level per Rule 8.1(1) — this
// is ordinary run officiating, not an admin-reserved correction.
timingRouter.post("/committee/competitors/:id/end-run", requireAuth, requireRole("committee"), async (req, res, next) => {
  try {
    const input = parsed(endRunSchema, req.body);
    const result = await endAttemptAtMaxTime(req.params.id, input.resolution, input.reason, actorOf(req.user!));
    res.status(201).json(result);
  } catch (error) { next(error); }
});
// Redo: void the run (a no-op if committee already voided it) and immediately
// re-arm the competitor on the given lane in one action — deliberately
// admin-only, since only an admin may actually grant the team a fresh attempt.
timingRouter.post("/admin/competitors/:id/runs/:runId/redo", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(redoSchema, req.body);
    await voidRun(req.params.id, req.params.runId, input.reason, actorOf(req.user!));
    await assignLane(input.laneId, req.params.id);
    const lane = await armLane(input.laneId, actorOf(req.user!));
    res.status(200).json(lane);
  } catch (error) { next(error); }
});
