import assert from "node:assert/strict";
import test from "node:test";
import { classifyJwtVerificationFailure, extractBearerToken } from "./verifyToken.js";

test("extractBearerToken accepts lowercase and uppercase bearer header values", () => {
  assert.equal(extractBearerToken("Bearer first-token"), "first-token");
  assert.equal(extractBearerToken("Bearer SECOND-token"), "SECOND-token");
});

test("extractBearerToken rejects missing and malformed credentials", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("Basic credential"), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken("bearer token"), null);
});

test("JWT verifier failures are classified without retaining token content", () => {
  const expired = new Error("JWT expired"); expired.name = "JwtExpiredError";
  assert.equal(classifyJwtVerificationFailure(expired), "expired_token");
  assert.equal(classifyJwtVerificationFailure(new Error("token_use claim mismatch")), "wrong_token_use");
  assert.equal(classifyJwtVerificationFailure(new Error("client_id claim mismatch")), "wrong_client");
  assert.equal(classifyJwtVerificationFailure(new Error("issuer mismatch")), "wrong_pool");
  assert.equal(classifyJwtVerificationFailure(new Error("signature verification failed")), "invalid_signature");
});
