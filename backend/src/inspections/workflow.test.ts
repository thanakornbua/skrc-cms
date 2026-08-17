import assert from "node:assert/strict";
import test from "node:test";
import { overallInspectionResult, weightResultFor, advancesToInspected, requiresPassedCheckIn } from "./workflow.js";

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


test("Rule 3.2: the measured weight decides the weight verdict, not the inspector", () => {
  assert.equal(weightResultFor(2500), "PASS");
  assert.equal(weightResultFor(4000), "PASS", "exactly at the limit passes");
  assert.equal(weightResultFor(4001), "FAIL");
  assert.equal(weightResultFor(4500), "FAIL");
});

test("an over-weight robot cannot be recorded as an overall pass", () => {
  // The defect this pins: the verdict used to be a standalone button, so an
  // inspector could type 4500 g and still press PASS.
  assert.equal(overallInspectionResult({
    weightResult: weightResultFor(4500), dimensionResult: "PASS", voltageResult: "PASS",
  }), "FAIL");
});

test("every check must pass for the inspection to pass", () => {
  assert.equal(overallInspectionResult({ weightResult: "PASS", dimensionResult: "PASS", voltageResult: "PASS" }), "PASS");
  assert.equal(overallInspectionResult({ weightResult: "PASS", dimensionResult: "FAIL", voltageResult: "PASS" }), "FAIL");
  assert.equal(overallInspectionResult({ weightResult: "PASS", dimensionResult: "PASS", voltageResult: "FAIL" }), "FAIL");
});
