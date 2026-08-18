import { startObsBridge } from "./obs-bridge-runner.js";

/**
 * Feeds the OBS overlay from the competition API.
 *
 * Writes three plain-text files that OBS text sources read with "Read from
 * file". Files rather than obs-websocket because there is no password to
 * manage, nothing to reconnect, and OBS and this bridge can start or restart in
 * any order without either noticing — the failure mode on competition day is a
 * stale number rather than a blank scene.
 *
 * On competition day the bridge runs inside the packaged Windows application
 * instead (`desktop/src/main.ts`), pointed at its own loopback API. This CLI is
 * for rehearsal from a developer machine, or for driving OBS from a second
 * laptop against the operator's.
 *
 *   OBS_API_URL   base URL of the competition API (default: local laptop API)
 *   OBS_OUT_DIR   directory the three .txt files live in (default: ./obs)
 *   OBS_POLL_MS   how often lane state is fetched (default: 1000)
 *   OBS_TICK_MS   how often the clock is redrawn between polls (default: 100)
 */
const bridge = await startObsBridge({
  apiUrl: process.env.OBS_API_URL ?? "http://127.0.0.1:7070",
  outDir: process.env.OBS_OUT_DIR ?? "obs",
  pollMs: Number(process.env.OBS_POLL_MS ?? 1000),
  tickMs: Number(process.env.OBS_TICK_MS ?? 100),
});

// Nothing above holds the event loop open on its own (the timers are unref'd
// for the desktop host), so keep the CLI alive until it is interrupted.
process.stdin.resume();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { bridge.stop(); process.exit(0); });
}
