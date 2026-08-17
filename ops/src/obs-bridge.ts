import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  clockSkewMs, overlayText, type OverlayText, type PublicLanesSnapshot,
} from "./obs-bridge-core.js";

/**
 * Feeds the OBS overlay from the competition API.
 *
 * Writes three plain-text files that OBS text sources read with "Read from
 * file". Files rather than obs-websocket because there is no password to
 * manage, nothing to reconnect, and OBS and this bridge can start or restart in
 * any order without either noticing — the failure mode on competition day is a
 * stale number rather than a blank scene.
 *
 *   OBS_API_URL   base URL of the competition API (default: local laptop API)
 *   OBS_OUT_DIR   directory the three .txt files live in (default: ./obs)
 *   OBS_POLL_MS   how often lane state is fetched (default: 1000)
 *   OBS_TICK_MS   how often the clock is redrawn between polls (default: 100)
 */
const api = process.env.OBS_API_URL ?? "http://127.0.0.1:3000";
const outDir = process.env.OBS_OUT_DIR ?? "obs";
const pollMs = Number(process.env.OBS_POLL_MS ?? 1000);
const tickMs = Number(process.env.OBS_TICK_MS ?? 100);

let snapshot: PublicLanesSnapshot | null = null;
let skewMs = 0;
let lastWritten: Partial<OverlayText> = {};
let offlineSince: number | null = null;

await mkdir(outDir, { recursive: true });

/**
 * Written via a temporary file and a rename so OBS never reads a half-written
 * line — rename is atomic within a directory, a plain overwrite is not.
 */
async function writeSource(name: string, value: string): Promise<void> {
  if (lastWritten[name as keyof OverlayText] === value) return;
  const target = join(outDir, `${name}.txt`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, target);
  lastWritten[name as keyof OverlayText] = value;
}

async function poll(): Promise<void> {
  try {
    const response = await fetch(`${api}/public/lanes`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const received = Date.now();
    snapshot = await response.json() as PublicLanesSnapshot;
    skewMs = clockSkewMs(snapshot, received);
    if (offlineSince !== null) {
      console.log(`API reachable again after ${((received - offlineSince) / 1000).toFixed(1)}s`);
      offlineSince = null;
    }
  } catch (error) {
    // A dropped poll is survivable: the clock keeps counting from the last
    // known start, which is what a viewer expects to see. Only a start or stop
    // that happened during the outage is missed, and the next poll corrects it.
    if (offlineSince === null) {
      offlineSince = Date.now();
      console.error("Lane poll failed; holding last known state —", error instanceof Error ? error.message : error);
    }
  }
}

async function tick(): Promise<void> {
  const text = overlayText(snapshot, Date.now(), skewMs);
  for (const [name, value] of Object.entries(text)) await writeSource(name, value);
}

console.log(`OBS bridge: ${api}/public/lanes → ${outDir}/{SKRC_StageName,SKRC_TeamName,SKRC_ElapsedTime}.txt`);
await poll();
await tick();
setInterval(() => { void poll(); }, pollMs);
setInterval(() => { void tick(); }, tickMs);
