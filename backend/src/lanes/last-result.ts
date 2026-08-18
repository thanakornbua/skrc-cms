/**
 * The result a lane just produced, kept for the display to hold on screen.
 *
 * When a run stops, the lane returns to IDLE and the competitor is cleared —
 * correct for the table, wrong for a broadcast, where the finishing time
 * vanishing the instant it is set is the one number the audience came for. The
 * outcome is remembered here so a display can hold it for a few seconds before
 * returning to the idle state.
 *
 * In memory on purpose. This is presentation, not record: the official time is
 * the run row (Rule 6.1(1)), and losing this on a restart costs a few seconds
 * of overlay, nothing more. Only the latest result per lane is kept.
 */
export type LaneResultStatus = "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW";

export interface LaneResult {
  competitorId: string;
  elapsedMs: number;
  status: LaneResultStatus;
  /** When the result was recorded, so a display knows how long to hold it. */
  finishedAt: string;
}

const byLane = new Map<string, LaneResult>();

export function recordLaneResult(laneId: string, result: Omit<LaneResult, "finishedAt">): void {
  byLane.set(laneId, { ...result, finishedAt: new Date().toISOString() });
}

export function getLaneResult(laneId: string): LaneResult | null {
  return byLane.get(laneId) ?? null;
}

/** Test seam: the map outlives a single test file otherwise. */
export function clearLaneResults(): void {
  byLane.clear();
}
