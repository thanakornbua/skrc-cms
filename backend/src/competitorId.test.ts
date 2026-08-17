import assert from "node:assert/strict";
import test from "node:test";
import { competitorIdSchema, normaliseCompetitorId, optionalCompetitorIdSchema } from "./competitorId.js";

test("canonical ids pass through unchanged", () => {
  assert.equal(normaliseCompetitorId("C-0014"), "C-0014");
});

test("operator and scanner variants resolve to the same key", () => {
  // The printed badge carries the full `C-0014`, an operator types digits only,
  // and neither may miss the DynamoDB key the other one hits.
  for (const raw of ["C-0014", "c-0014", " C-0014 ", "0014", "14", "c- 14"]) {
    assert.equal(normaliseCompetitorId(raw), "C-0014", `failed for ${JSON.stringify(raw)}`);
  }
});

test("ids beyond four digits keep their width", () => {
  assert.equal(normaliseCompetitorId("C-10432"), "C-10432");
});

test("unusable input is rejected rather than guessed at", () => {
  for (const raw of ["", "   ", "C-", "hello-world", "C-14A"]) {
    assert.equal(normaliseCompetitorId(raw), null, `failed for ${JSON.stringify(raw)}`);
  }
});

test("schema normalises valid input and rejects junk", () => {
  assert.equal(competitorIdSchema.parse("c-14"), "C-0014");
  assert.throws(() => competitorIdSchema.parse("hello-world"));
  // Regression guard: this value is written to Cognito custom:competitorId and
  // is what the self-access checks compare against, so a bare number that once
  // passed validation must not be accepted as-is.
  assert.equal(competitorIdSchema.parse("14"), "C-0014");
});

test("optional schema keeps empty meaning not-linked", () => {
  assert.equal(optionalCompetitorIdSchema.parse(""), "");
  assert.equal(optionalCompetitorIdSchema.parse(undefined), "");
  assert.equal(optionalCompetitorIdSchema.parse("C-7"), "C-0007");
});
