/**
 * Pure display logic for the OBS overlay: given a `/public/lanes` snapshot and
 * a moment in time, decide what belongs in each of the three text sources.
 *
 * Kept separate from the I/O loop so the interesting decisions — which lane is
 * on screen, what shows between runs, how clock skew is handled — are testable
 * without a network, a filesystem, or OBS.
 */

export type LaneState = "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";

export interface LaneResult {
  teamName: string | null;
  elapsedMs: number;
  status: "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW";
  finishedAt: string;
  /** The attempt this result was, of the stage's three. */
  attempt?: number | null;
  attemptsTotal?: number | null;
  /** The team's best time in this stage, including this result. */
  bestMs?: number | null;
}

export interface PublicLane {
  laneId: string;
  state: LaneState;
  teamName: string | null;
  runStartedAt: string | null;
  /** The attempt about to run, or running, of the stage's three. */
  attempt?: number | null;
  attemptsTotal?: number | null;
  /** The team's best time so far in this stage, if it has one. */
  bestMs?: number | null;
  /** The result this lane just produced, if any. */
  lastResult?: LaneResult | null;
}

export interface PublicLanesSnapshot {
  activeStage: string;
  stageLabel: string;
  /** Server clock at the moment the snapshot was produced. */
  serverTime: string;
  lanes: PublicLane[];
}

export interface OverlayText {
  SKRC_StageName: string;
  SKRC_TeamName: string;
  SKRC_ElapsedTime: string;
  /** "Attempt 2 of 3", or empty when no team is on screen. */
  SKRC_Attempt: string;
  /** The team's best time this stage, or empty when it has none yet. */
  SKRC_BestTime: string;
}

/**
 * Difference between this machine's clock and the API's, in milliseconds.
 *
 * On competition day the API runs on this same laptop and this is ~0, but
 * during rehearsal against EC2 the two can differ by seconds — enough to start
 * the on-screen clock at a visibly wrong value, or even a negative one.
 * Measured once per poll and applied to every tick in between.
 */
export function clockSkewMs(snapshot: PublicLanesSnapshot, receivedAtMs: number): number {
  const serverMs = Date.parse(snapshot.serverTime);
  return Number.isFinite(serverMs) ? receivedAtMs - serverMs : 0;
}

/**
 * The lane the audience should be watching: the one actually running, else the
 * one armed and about to, else the one a team has been assigned to. With a
 * single lane configured this is simply "the lane", but the ordering keeps the
 * overlay sensible if more are added later.
 */
export function focusLane(lanes: PublicLane[]): PublicLane | null {
  const byPriority: LaneState[] = ["RUNNING", "ARMED", "ASSIGNED"];
  for (const state of byPriority) {
    const found = lanes.find((lane) => lane.state === state);
    if (found) return found;
  }
  return null;
}

/** `mm:ss.mmm` — reads cleanly at a glance on a stream and sorts visually. */
export function formatElapsed(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = Math.floor(clamped % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/**
 * "Attempt 2 of 3". Empty when the engine did not supply a count — an older
 * API, or a lane with no team — so the source clears rather than reading
 * "Attempt null of 3" on a broadcast.
 */
export function attemptText(attempt?: number | null, total?: number | null): string {
  if (typeof attempt !== "number" || typeof total !== "number") return "";
  return `Attempt ${attempt} of ${total}`;
}

/**
 * How long a finishing time stays on screen after the lane has gone idle.
 *
 * The lane clears the moment a run stops, so without this the number the
 * audience just watched being set would disappear in the same frame. Five
 * seconds is long enough to read a time aloud and short enough that the next
 * team arming replaces it — which it does, since a live lane always wins.
 */
export const RESULT_HOLD_MS = 5000;

/**
 * What the three sources should read right now.
 *
 * A running lane shows a live clock counted from `runStartedAt`. An armed lane
 * shows its team at 0.000, so the audience sees who is about to go. A lane that
 * just finished holds its result for RESULT_HOLD_MS. Only then does the field
 * clear back to the stage name; a stale team and time are never left up.
 */
export function overlayText(
  snapshot: PublicLanesSnapshot | null,
  nowMs: number,
  skewMs = 0,
): OverlayText {
  if (!snapshot) {
    return { SKRC_StageName: "", SKRC_TeamName: "", SKRC_ElapsedTime: "", SKRC_Attempt: "", SKRC_BestTime: "" };
  }
  const lane = focusLane(snapshot.lanes);
  const blank = {
    SKRC_StageName: snapshot.stageLabel, SKRC_TeamName: "", SKRC_ElapsedTime: "",
    SKRC_Attempt: "", SKRC_BestTime: "",
  };
  if (!lane || !lane.teamName) {
    const held = heldResult(snapshot, nowMs, skewMs);
    if (held?.teamName) {
      return {
        SKRC_StageName: snapshot.stageLabel,
        SKRC_TeamName: held.teamName,
        SKRC_ElapsedTime: formatElapsed(held.elapsedMs),
        SKRC_Attempt: attemptText(held.attempt, held.attemptsTotal),
        SKRC_BestTime: held.bestMs === null || held.bestMs === undefined ? "" : formatElapsed(held.bestMs),
      };
    }
    return blank;
  }

  if (lane.state === "RUNNING" && lane.runStartedAt) {
    const startedMs = Date.parse(lane.runStartedAt);
    if (!Number.isFinite(startedMs)) return blank;
    return {
      SKRC_StageName: snapshot.stageLabel,
      SKRC_TeamName: lane.teamName,
      SKRC_ElapsedTime: formatElapsed(nowMs - skewMs - startedMs),
      SKRC_Attempt: attemptText(lane.attempt, lane.attemptsTotal),
      SKRC_BestTime: lane.bestMs === null || lane.bestMs === undefined ? "" : formatElapsed(lane.bestMs),
    };
  }

  if (lane.state === "ARMED") {
    return {
      SKRC_StageName: snapshot.stageLabel,
      SKRC_TeamName: lane.teamName,
      SKRC_ElapsedTime: formatElapsed(0),
      SKRC_Attempt: attemptText(lane.attempt, lane.attemptsTotal),
      SKRC_BestTime: lane.bestMs === null || lane.bestMs === undefined ? "" : formatElapsed(lane.bestMs),
    };
  }

  return blank;
}

/**
 * The most recent result still inside its hold window, if any.
 *
 * Checked only when no lane is live: an armed or running lane is what the
 * audience is watching now, and it takes the screen from a finished one.
 */
export function heldResult(
  snapshot: PublicLanesSnapshot,
  nowMs: number,
  skewMs = 0,
): LaneResult | null {
  let newest: LaneResult | null = null;
  for (const lane of snapshot.lanes) {
    const result = lane.lastResult;
    if (!result) continue;
    const finishedMs = Date.parse(result.finishedAt);
    if (!Number.isFinite(finishedMs)) continue;
    if (nowMs - skewMs - finishedMs > RESULT_HOLD_MS) continue;
    if (!newest || finishedMs > Date.parse(newest.finishedAt)) newest = result;
  }
  return newest;
}
