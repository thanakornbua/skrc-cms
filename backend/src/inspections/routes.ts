import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { listWeightInspections, recordWeightInspection } from "./repo.js";
import { competitorIdParam } from "../competitorId.js";
import { actorOf } from "../auth/types.js";

export const inspectionsRouter = Router();

// Every `:id` on this router is a competitor number; accept scanned/typed
// variants like `c-14` and resolve them to the canonical `C-0014`.
inspectionsRouter.param("id", competitorIdParam);

const inspectionSchema = z.object({
  inspectionId: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  stage: z.enum(["CHECK_IN", "PRE_COMPETITION", "ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"]),
  weightGrams: z.number().positive().max(100_000),
  // The weight verdict and the overall verdict are derived server-side from
  // this measurement (Rule 3.2), so neither is accepted from the client.
  dimensionResult: z.enum(["PASS", "FAIL"]),
  voltageResult: z.enum(["PASS", "FAIL"]),
  notes: z.string().trim().max(500).optional(),
});

inspectionsRouter.get(
  "/committee/competitors/:id/weight-inspections",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      res.status(200).json({ inspections: await listWeightInspections(req.params.id) });
    } catch (error) { next(error); }
  }
);

inspectionsRouter.post(
  "/committee/competitors/:id/weight-inspections",
  requireAuth,
  requireRole("committee"),
  async (req, res, next) => {
    try {
      const parsed = inspectionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid weight inspection", zodToFields(parsed.error));
      }
      const result = await recordWeightInspection(req.params.id, parsed.data, actorOf(req.user!));
      res.status(200).json(result);
    } catch (error) { next(error); }
  }
);

