import { EventEmitter } from "node:events";

/**
 * In-process notification that something on the field changed.
 *
 * The overlay used to learn about an arming by polling, so a team's name
 * appeared up to a poll interval after the operator armed the lane — visible
 * hesitation on a broadcast, right at the moment the audience is looking. Any
 * write that could move a lane emits here instead, and displays are pushed.
 *
 * Deliberately not a durable queue or a cross-process bus: on competition day
 * the API, the overlay bridge and the serial reader are one process on one
 * laptop. Consumers keep a slow poll as their safety net, so a missed emit
 * costs latency, never correctness.
 */
const emitter = new EventEmitter();
// One listener per open SSE connection, plus the local bridge. The default of
// 10 would warn on a scene with a handful of browser sources open.
emitter.setMaxListeners(100);

export function emitFieldChanged(): void {
  emitter.emit("changed");
}

/** Subscribes, and returns the unsubscribe — callers must call it on close. */
export function onFieldChanged(listener: () => void): () => void {
  emitter.on("changed", listener);
  return () => { emitter.off("changed", listener); };
}
