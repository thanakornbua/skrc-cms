import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { requireAuth } from "./auth/middleware.js";
import { healthHandler } from "./routes/health.js";
import { meHandler } from "./routes/me.js";
import { competitorsRouter } from "./competitors/routes.js";
import { lanesRouter } from "./lanes/routes.js";
import { runsRouter } from "./runs/routes.js";
import { timingRouter } from "./timing/routes.js";
import { competitionRouter } from "./competition/routes.js";
import { requireCompetitionOpen } from "./competition/middleware.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get("/health", healthHandler);
  app.get("/auth/me", requireAuth, meHandler);
  app.use(requireCompetitionOpen);
  app.use(competitorsRouter);
  app.use(lanesRouter);
  app.use(runsRouter);
  app.use(timingRouter);
  app.use(competitionRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
