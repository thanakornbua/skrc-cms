import type { Request, Response } from "express";

export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: "ok", version: `robo-compet-backend@${process.env.APP_VERSION ?? "1.0.0"}` });
}
