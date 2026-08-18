import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  clockSkewMs, overlayText, type OverlayText, type PublicLanesSnapshot,
} from "./obs-bridge-core.js";

/**
 * The polling and file-writing half of the OBS overlay bridge.
 *
 * Kept apart from the CLI in `obs-bridge.ts` so the same loop can run inside
 * the packaged Windows desktop application, where there is no shell to start a
 * second process and no `ops/` checkout to run it from. The desktop app starts
 * this alongside the competition API; the CLI stays for rehearsal against a
 * remote API from a developer machine.
 */
export interface ObsBridgeOptions {
  /** Base URL of the competition API. */
  apiUrl: string;
  /** Directory the three `.txt` files live in. Created if missing. */
  outDir: string;
  /** How often lane state is fetched. */
  pollMs?: number;
  /** How often the clock is redrawn between polls. */
  tickMs?: number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface ObsBridge {
  /** Where OBS should point its three "Read from file" text sources. */
  outDir: string;
  stop(): void;
}

/**
 * Starts the bridge and resolves once the first files are on disk, so a caller
 * can tell the operator the sources are ready to pick in OBS.
 */
export async function startObsBridge(options: ObsBridgeOptions): Promise<ObsBridge> {
  const { apiUrl, outDir } = options;
  const pollMs = options.pollMs ?? 1000;
  const tickMs = options.tickMs ?? 100;
  const log = options.log ?? ((message: string) => console.log(message));
  const logError = options.logError ?? ((message: string) => console.error(message));

  let snapshot: PublicLanesSnapshot | null = null;
  let skewMs = 0;
  let offlineSince: number | null = null;
  const lastWritten: Partial<OverlayText> = {};

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
      const response = await fetch(`${apiUrl}/public/lanes`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const received = Date.now();
      snapshot = await response.json() as PublicLanesSnapshot;
      skewMs = clockSkewMs(snapshot, received);
      if (offlineSince !== null) {
        log(`API reachable again after ${((received - offlineSince) / 1000).toFixed(1)}s`);
        offlineSince = null;
      }
    } catch (error) {
      // A dropped poll is survivable: the clock keeps counting from the last
      // known start, which is what a viewer expects to see. Only a start or stop
      // that happened during the outage is missed, and the next poll corrects it.
      if (offlineSince === null) {
        offlineSince = Date.now();
        logError(`Lane poll failed; holding last known state — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function tick(): Promise<void> {
    const text = overlayText(snapshot, Date.now(), skewMs);
    for (const [name, value] of Object.entries(text)) await writeSource(name, value);
  }

  log(`OBS bridge: ${apiUrl}/public/lanes → ${outDir}/{SKRC_StageName,SKRC_TeamName,SKRC_ElapsedTime}.txt`);
  await poll();
  await tick();
  const pollTimer = setInterval(() => { void poll(); }, pollMs);
  const tickTimer = setInterval(() => { void tick(); }, tickMs);
  // The desktop app owns process lifetime; these must never be what keeps the
  // event loop (or a quit) waiting.
  pollTimer.unref?.(); tickTimer.unref?.();

  return {
    outDir,
    stop(): void { clearInterval(pollTimer); clearInterval(tickTimer); },
  };
}
