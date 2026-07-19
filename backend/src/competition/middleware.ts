import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { getCompetitionState } from "./repo.js";

export async function requireCompetitionOpen(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path === "/admin/competition/reopen") {
    next(); return;
  }
  try {
    const state = await getCompetitionState();
    if (state.phase === "CONCLUDED") next(new ApiError(409, "COMPETITION_CONCLUDED", "Competition is concluded"));
    else next();
  } catch (error) { next(error); }
}
