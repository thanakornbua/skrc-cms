import assert from "node:assert/strict";
import test from "node:test";
import { interventionsAgainstRun } from "./repo.js";
import type { AppliedPenalty } from "./types.js";

/**
 * Rule 7.3 counts unauthorized interventions per attempt: the first two cost
 * five seconds each, the third ends the run. What the count must not do is
 * restart because a different intervention rule was cited, or keep counting a
 * revoked occurrence.
 */
function applied(over: Partial<AppliedPenalty>): AppliedPenalty {
  return {
    SK: `PENALTY#${over.at ?? "1"}`, ruleId: "rule-1", label: "Unauthorized intervention",
    penaltyMs: 5000, byUser: "committee", at: "2026-01-01T00:00:00.000Z",
    stage: "THE_BEST", kind: "INTERVENTION", runId: "run-1", ...over,
  };
}

test("interventions are counted per attempt across every intervention rule", () => {
  const history = [applied({ ruleId: "rule-1" }), applied({ ruleId: "rule-2", at: "2" })];
  assert.equal(interventionsAgainstRun(history, "run-1", "rule-2"), 2);
});

test("a revoked intervention no longer counts toward the limit", () => {
  const history = [
    applied({}),
    applied({ at: "2", revocation: { reason: "wrong team", byUser: "admin", at: "2026-01-01T00:01:00.000Z" } }),
  ];
  assert.equal(interventionsAgainstRun(history, "run-1", "rule-1"), 1);
});

test("interventions charged to another attempt do not carry over", () => {
  const history = [applied({ runId: "run-0" }), applied({ runId: "run-1", at: "2" })];
  assert.equal(interventionsAgainstRun(history, "run-1", "rule-1"), 1);
});

test("a non-intervention penalty on the same attempt is not counted", () => {
  const history = [applied({ kind: undefined, ruleId: "late-start", label: "Late start" })];
  assert.equal(interventionsAgainstRun(history, "run-1", "rule-1"), 0);
});

test("rows written before kind was snapshotted still count under the rule they cited", () => {
  const history = [applied({ kind: undefined }), applied({ kind: undefined, at: "2" })];
  assert.equal(interventionsAgainstRun(history, "run-1", "rule-1"), 2);
});
