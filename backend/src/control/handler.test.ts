import assert from "node:assert/strict";
import test from "node:test";
import { authorizationHeader, handler, modeSchema, resolveSourceCommitId } from "./handler.js";

const validRequest = {
  mode: "competition",
  expectedCommit: "HEAD",
  expectedJobId: "0000000034",
  confirmation: "DEPLOY_COMPETITION",
};

test("deployment schema accepts Amplify's non-SHA HEAD commitId", () => {
  // Amplify reports commitId "HEAD" for manually started RELEASE jobs, which is
  // what the deploy path itself starts. A 40-hex-SHA rule rejected every
  // request once any mode deployment had run.
  assert.equal(modeSchema.safeParse(validRequest).success, true);
});

test("deployment status resolves manual HEAD to the latest successful source SHA", () => {
  const source = "17a04eb3f110bee01bc967fb1f633af80ea911a8";
  assert.equal(resolveSourceCommitId("HEAD", [
    { commitId: "badbadbadbadbadbadbadbadbadbadbadbadbadb", status: "FAILED" },
    { commitId: source, status: "SUCCEED" },
  ]), source);
});

test("deployment status keeps an active source SHA", () => {
  const source = "17a04eb3f110bee01bc967fb1f633af80ea911a8";
  assert.equal(resolveSourceCommitId(source, []), source);
});

test("deployment schema requires the job-id concurrency token", () => {
  const { expectedJobId, ...withoutJobId } = validRequest;
  void expectedJobId;
  const parsed = modeSchema.safeParse(withoutJobId);
  assert.equal(parsed.success, false);
  if (parsed.success) throw new Error("Expected parse failure");
  assert.deepEqual(parsed.error.issues.map((issue) => issue.path.join(".")), ["expectedJobId"]);
});

test("deployment schema rejects empty concurrency tokens", () => {
  assert.equal(modeSchema.safeParse({ ...validRequest, expectedCommit: "" }).success, false);
  assert.equal(modeSchema.safeParse({ ...validRequest, expectedJobId: "" }).success, false);
});

test("deployment schema still rejects an unknown mode", () => {
  assert.equal(modeSchema.safeParse({ ...validRequest, mode: "archived" }).success, false);
});

test("control handler accepts either API Gateway authorization header casing", () => {
  assert.equal(authorizationHeader({ authorization: "Bearer lower" }), "Bearer lower");
  assert.equal(authorizationHeader({ Authorization: "Bearer upper" }), "Bearer upper");
  assert.equal(authorizationHeader({}), undefined);
});

test("control preflight bypasses authentication", async () => {
  const response = await handler({
    headers: {},
    requestContext: { http: { method: "OPTIONS" } },
  } as never);
  assert.notEqual(typeof response, "string");
  if (typeof response === "string") throw new Error("Expected proxy response");
  assert.equal(response.statusCode, 204);
});
