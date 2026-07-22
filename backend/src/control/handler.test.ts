import assert from "node:assert/strict";
import test from "node:test";
import { authorizationHeader, handler } from "./handler.js";

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
