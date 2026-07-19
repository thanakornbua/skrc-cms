import type { Request, Response } from "express";

export function meHandler(req: Request, res: Response): void {
  const user = req.user!;
  res.status(200).json({
    sub: user.sub,
    role: user.role,
    competitorId: user.competitorId,
  });
}
