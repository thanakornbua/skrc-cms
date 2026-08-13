import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, zodToFields } from "../errors.js";
import { listWeightInspections, recordWeightInspection } from "./repo.js";

export const inspectionsRouter = Router();

const inspectionSchema = z.object({
  inspectionId: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  stage: z.enum(["CHECK_IN", "PRE_COMPETITION"]),
  weightGrams: z.number().positive().max(100_000),
  result: z.enum(["PASS", "FAIL"]),
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
      const result = await recordWeightInspection(req.params.id, parsed.data, req.user!.username);
      res.status(200).json(result);
    } catch (error) { next(error); }
  }
);

