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
import { inspectionsRouter } from "./inspections/routes.js";
import { hardwareRouter } from "./hardware/routes.js";
import { resolve } from "node:path";
import { emitFieldChanged } from "./lanes/events.js";
import { overlayPage } from "./overlay/page.js";

export function createApp(options: { staticFrontendDir?: string } = {}) {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  /**
   * Any successful write may have moved a lane, so displays are told to
   * refresh. Signalling from here rather than from each repository means a new
   * mutation route cannot forget to do it; the cost of an unnecessary signal is
   * one cheap read on a listener that already exists.
   */
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.on("finish", () => { if (res.statusCode < 400) emitFieldChanged(); });
    }
    next();
  });

  app.get("/health", healthHandler);
  // Overlay for an OBS Browser Source: pushed by SSE, drawn on every frame.
  app.get("/overlay", (_req, res) => {
    res.type("html").send(overlayPage());
  });
  app.get("/auth/me", requireAuth, meHandler);
  app.use(requireCompetitionOpen);
  app.use(hardwareRouter);
  app.use(competitorsRouter);
  app.use(inspectionsRouter);
  app.use(lanesRouter);
  app.use(runsRouter);
  app.use(timingRouter);
  app.use(competitionRouter);

  if (options.staticFrontendDir) {
    const frontendDir = resolve(options.staticFrontendDir);
    app.use(express.static(frontendDir));
    app.get("*", (req, res, next) => {
      if (!req.accepts("html")) { next(); return; }
      res.sendFile(resolve(frontendDir, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
