import { createApp } from "./app.js";
import { config } from "./config.js";
import { sweepTimedOutRuns } from "./runs/repo.js";

const app = createApp();
const RECOVERY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Validate deployment configuration before the process advertises a healthy
// service; getters remain uncached so tests/operators can still update env.
config.lanes;
config.deviceKeys;

app.listen(config.port, () => {
  console.log(`robo-compet backend listening on :${config.port}`);
});

// Accepted START events schedule their own deadline. This slow sweep is only
// recovery for a process restart during a run, reducing idle DynamoDB reads
// from once per second to once per five minutes per configured lane.
sweepTimedOutRuns().catch((error) => console.error("Startup timeout sweep failed:", error));
const sweepInterval = setInterval(() => {
  sweepTimedOutRuns().catch((error) => console.error("Timeout sweep failed:", error));
}, RECOVERY_SWEEP_INTERVAL_MS);
sweepInterval.unref();
