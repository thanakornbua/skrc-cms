import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import {
  applyPenalty, correctRun, createPenaltyRule, listCategoryTimings,
  listPenaltyRules, putCategoryTiming, resolveUnderReview, revokePenalty,
  updatePenaltyRule,
} from "./repo.js";

export const timingRouter = Router();
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
const ruleSchema = z.object({ label: z.string().trim().min(1), penaltyMs: z.number().int().positive() });
const ruleUpdateSchema = ruleSchema.extend({ active: z.boolean() });
const applySchema = z.object({ ruleId: z.string().trim().min(1) });
const reasonSchema = z.object({ reason: z.string().trim().min(1) });
const resolveSchema = reasonSchema.extend({ decision: z.enum(["consume", "void"]) });
const correctionSchema = reasonSchema.extend({ elapsedMs: z.number().int().positive() });

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
    res.status(200).json(await putCategoryTiming(input.category, input.minTimeMs, input.stageMaxTimeMs, req.user!.username));
  } catch (error) { next(error); }
});
timingRouter.get("/admin/config/penalties", requireAuth, requireRole("committee"), async (_req, res, next) => {
  try { res.status(200).json({ rules: await listPenaltyRules() }); } catch (error) { next(error); }
});
timingRouter.post("/admin/config/penalties", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(ruleSchema, req.body);
    res.status(201).json(await createPenaltyRule(input.label, input.penaltyMs, req.user!.username));
  } catch (error) { next(error); }
});
timingRouter.put("/admin/config/penalties/:ruleId", requireAuth, requireRole("admin"), async (req, res, next) => {
  try { res.status(200).json(await updatePenaltyRule(req.params.ruleId, parsed(ruleUpdateSchema, req.body), req.user!.username)); }
  catch (error) { next(error); }
});
timingRouter.post("/committee/competitors/:id/penalties", requireAuth, requireRole("committee"), async (req, res, next) => {
  try {
    const input = parsed(applySchema, req.body);
    res.status(201).json(await applyPenalty(req.params.id, input.ruleId, req.user!.username));
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/penalties/:penaltySk/revoke", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(reasonSchema, req.body);
    res.status(200).json(await revokePenalty(req.params.id, req.params.penaltySk, input.reason, req.user!.username));
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/runs/:runId/resolve", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(resolveSchema, req.body);
    await resolveUnderReview(req.params.id, req.params.runId, input.decision, input.reason, req.user!.username);
    res.status(200).json({ status: input.decision === "consume" ? "INVALID" : "VOID" });
  } catch (error) { next(error); }
});
timingRouter.post("/admin/competitors/:id/runs/:runId/correct", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const input = parsed(correctionSchema, req.body);
    res.status(201).json(await correctRun(req.params.id, req.params.runId, input.elapsedMs, input.reason, req.user!.username));
  } catch (error) { next(error); }
});
