import assert from "node:assert/strict";
import test from "node:test";
import type { CustomEmailSenderTriggerEvent } from "aws-lambda";
import { createAuthEmailHandler, type AuthEmailDeps } from "./handler.js";

function baseEvent(overrides: Partial<CustomEmailSenderTriggerEvent> = {}): CustomEmailSenderTriggerEvent {
  return {
    version: "1",
    region: "ap-southeast-7",
    userPoolId: "pool-1",
    triggerSource: "CustomEmailSender_ForgotPassword",
    callerContext: { awsSdkVersion: "3", clientId: "client-1" },
    request: {
      type: "customEmailSenderRequestSubmit",
      code: "ZW5jcnlwdGVk",
      userAttributes: { email: "leader@example.com" },
    },
    ...overrides,
  } as CustomEmailSenderTriggerEvent;
}

function deps(fetchImpl: typeof fetch, over: Partial<AuthEmailDeps> = {}): AuthEmailDeps {
  return {
    decrypt: async () => "483920",
    accountId: "acct-1",
    from: "no-reply@skrc.suankularb.space",
    replyTo: "skrc@skrc.suankularb.space",
    portalUrl: "https://competitive.skrc.suankularb.space/portal",
    contactAddress: "skrc@skrc.suankularb.space",
    token: async () => "cf_test",
    fetchImpl,
    ...over,
  };
}

function ok(): Response {
  return new Response(JSON.stringify({ success: true, result: { message_id: "<m@skrc>" } }), { status: 200 });
}

test("decrypts the code and sends the styled reset email via Cloudflare", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const handler = createAuthEmailHandler(deps((async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return ok();
  }) as typeof fetch));

  await handler(baseEvent());

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.cloudflare.com/client/v4/accounts/acct-1/email/sending/send");
  const body = JSON.parse(requests[0].init.body as string);
  assert.deepEqual(body.to, ["leader@example.com"]);
  assert.equal(body.from.address, "no-reply@skrc.suankularb.space");
  assert.ok(body.html.includes("483920"), "decrypted code rendered into the email");
  assert.ok(body.text.includes("483920"));
});

test("also handles resend-code as a password-recovery source", async () => {
  let sent = 0;
  const handler = createAuthEmailHandler(deps((async () => { sent++; return ok(); }) as typeof fetch));
  await handler(baseEvent({ triggerSource: "CustomEmailSender_ResendCode" }));
  assert.equal(sent, 1);
});

test("rejects an unsupported trigger source instead of silently dropping it", async () => {
  let sent = 0;
  const handler = createAuthEmailHandler(deps((async () => { sent++; return ok(); }) as typeof fetch));
  await assert.rejects(
    () => handler(baseEvent({ triggerSource: "CustomEmailSender_SignUp" })),
    /Unsupported CustomEmailSender trigger source/,
  );
  assert.equal(sent, 0);
});

test("surfaces a Cloudflare error as a thrown send failure", async () => {
  const handler = createAuthEmailHandler(deps((async () =>
    new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "Sender domain not verified" }] }), { status: 400 })
  ) as typeof fetch));
  await assert.rejects(() => handler(baseEvent()), /Cloudflare email send failed: Sender domain not verified/);
});
