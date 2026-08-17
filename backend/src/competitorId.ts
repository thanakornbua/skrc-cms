import { z } from "zod";
import type { NextFunction, Request, Response } from "express";

/**
 * Competitor numbers are minted as `C-0042` (see the counter in
 * regweek/repo.ts) and every DynamoDB key is built from that exact string, so
 * `c-0014`, `C-14` and a stray-whitespace variant would all silently miss the
 * key. Normalise once, here, rather than in each of the routes that take a
 * competitor number as a path parameter.
 */

const CANONICAL = /^C-\d{4,}$/;

/** Canonical `C-0042`, or null when there is nothing usable in the input. */
export function normaliseCompetitorId(raw: string): string | null {
  const digits = raw.trim().replace(/^[cC]\s*-\s*/, "");
  if (!/^\d+$/.test(digits)) return null;
  return `C-${digits.padStart(4, "0")}`;
}

/** Body/attribute schema for a competitor number. Accepts the loose forms an
 *  operator can type and stores only the canonical one. */
export const competitorIdSchema = z.string()
  .transform((value) => normaliseCompetitorId(value))
  .refine((value): value is string => value !== null && CANONICAL.test(value), {
    message: "Invalid competitor ID",
  });

/** Same, but for optional fields where an empty string means "not linked". */
export const optionalCompetitorIdSchema = z.union([
  z.literal(""),
  competitorIdSchema,
]).optional().default("");

/**
 * `router.param("id", …)` handler: rewrites the competitor number in the path
 * to its canonical form before any handler runs, so a scanned `c-14` resolves
 * the same key as `C-0014`. Every `:id` in this API is a competitor number —
 * lanes, penalty rules and runs use their own distinctly named parameters — so
 * this is safe to install on any router.
 *
 * An unparseable value is passed through untouched rather than rejected, so the
 * route's own lookup still produces its normal 404 rather than a shape error.
 */
export function competitorIdParam(req: Request, _res: Response, next: NextFunction, value: string): void {
  const normalised = normaliseCompetitorId(value);
  if (normalised) req.params.id = normalised;
  next();
}
