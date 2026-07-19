import type { Request, Response } from "express";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: "ok", version: `robo-compet-backend@${version}` });
}
