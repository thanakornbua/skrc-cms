import assert from "node:assert/strict";
import test from "node:test";
import { authorizationHeader } from "./handler.js";

test("control handler accepts either API Gateway authorization header casing", () => {
  assert.equal(authorizationHeader({ authorization: "Bearer lower" }), "Bearer lower");
  assert.equal(authorizationHeader({ Authorization: "Bearer upper" }), "Bearer upper");
  assert.equal(authorizationHeader({}), undefined);
});
