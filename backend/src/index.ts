import { createApp } from "./app.js";
import { config } from "./config.js";
import { sweepTimedOutRuns } from "./runs/repo.js";

const app = createApp();
// Accepted STARTs have precise in-process timers. A short recovery interval
// closes runs promptly if the process restarted and those timers were lost.
const RECOVERY_SWEEP_INTERVAL_MS = 1000;

// Validate deployment configuration before the process advertises a healthy
// service; getters remain uncached so tests/operators can still update env.
config.lanes;
config.deviceKeys;

app.listen(config.port, () => {
  console.log(`robo-compet backend listening on :${config.port}`);
});

// Accepted START events schedule their own deadline; this interval is restart
// recovery for timers that existed only in the previous process.
sweepTimedOutRuns().catch((error) => console.error("Startup timeout sweep failed:", error));
const sweepInterval = setInterval(() => {
  sweepTimedOutRuns().catch((error) => console.error("Timeout sweep failed:", error));
}, RECOVERY_SWEEP_INTERVAL_MS);
sweepInterval.unref();
