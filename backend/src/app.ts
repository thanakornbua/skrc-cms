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
import { fieldStyle, isOverlayField, OVERLAY_FIELDS } from "./overlay/fields.js";
import { overlayFieldPage } from "./overlay/field-page.js";

export function createApp(options: { staticFrontendDir?: string } = {}) {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  /**
   * The public display feed is readable from anywhere.
   *
   * CORS_ORIGIN exists to keep the authenticated console's API to one known
   * origin, and that is right for every route that reads a competitor or writes
   * a run. It is wrong for /public: an overlay is a page OBS loads from disk, a
   * scoreboard on a second machine, a graphics tool nobody has told us about —
   * all of them legitimately not this origin, and none of them able to reach
   * anything that is not already unauthenticated and free of internal IDs
   * (Rule 10.1(3)).
   */
  app.use("/public", cors({ origin: "*", methods: ["GET"] }));
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
  /**
   * One field per Browser Source, so the scene owns the layout rather than
   * inheriting mine. Same feed and the same display rules as the combined page.
   */
  app.get("/overlay/:field", (req, res) => {
    const field = req.params.field;
    if (!isOverlayField(field)) {
      res.status(404).type("text/plain")
        .send(`Unknown overlay field "${field}". Available: ${OVERLAY_FIELDS.join(", ")}`);
      return;
    }
    res.type("html").send(overlayFieldPage(field, fieldStyle(req.query as Record<string, unknown>)));
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
