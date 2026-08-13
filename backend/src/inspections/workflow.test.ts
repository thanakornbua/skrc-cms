import assert from "node:assert/strict";
import test from "node:test";
import { advancesToInspected, requiresPassedCheckIn } from "./workflow.js";

test("only pre-competition inspection requires a passed check-in measurement", () => {
  assert.equal(requiresPassedCheckIn("CHECK_IN"), false);
  assert.equal(requiresPassedCheckIn("PRE_COMPETITION"), true);
});

test("only a passing second measurement advances a checked-in competitor", () => {
  assert.equal(advancesToInspected("CHECKED_IN", "PRE_COMPETITION", "PASS", true), true);
  assert.equal(advancesToInspected("CHECKED_IN", "PRE_COMPETITION", "FAIL", true), false);
  assert.equal(advancesToInspected("CHECKED_IN", "PRE_COMPETITION", "PASS", false), false);
  assert.equal(advancesToInspected("CHECKED_IN", "CHECK_IN", "PASS", true), false);
  assert.equal(advancesToInspected("INSPECTED", "PRE_COMPETITION", "PASS", true), false);
});

