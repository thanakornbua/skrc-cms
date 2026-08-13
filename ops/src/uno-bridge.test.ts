import assert from "node:assert/strict";
import test from "node:test";
import { eventTypeForLane, parseUnoLine } from "./uno-bridge-core.js";

test("parses timestamped and legacy UNO lines", () => {
  assert.deepEqual(parseUnoLine("TRIGGER 1234", 99), { command: "TRIGGER", deviceTs: 1234 });
  assert.deepEqual(parseUnoLine("CLEAR", 99), { command: "CLEAR", deviceTs: 99 });
  assert.equal(parseUnoLine("Gate Timer Ready", 99), null);
});

test("maps the current lane state to a single-sensor edge", () => {
  assert.equal(eventTypeForLane("ARMED"), "START");
  assert.equal(eventTypeForLane("RUNNING"), "STOP");
  assert.equal(eventTypeForLane("IDLE"), null);
  assert.equal(eventTypeForLane("ASSIGNED"), null);
});
