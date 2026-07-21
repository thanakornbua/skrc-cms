import assert from "node:assert/strict";
import test from "node:test";
import { createCloudflareEmailSender, parseCloudflareApiToken } from "./cloudflare-email.js";
import type { NotificationEvent } from "./core.js";

const event: NotificationEvent = {
  type: "REGISTRATION_RECEIVED", eventId: "event-1", sub: "sub-123",
  contactEmail: "leader@example.com", teamName: "Robots", category: "Open",
  createdAt: "2026-07-21T00:00:00.000Z", deleteBy: "2027-01-21T00:00:00.000Z",
};
const content = { subject: "Subject", text: "Text", html: "<p>HTML</p>" };

test("requires a JSON secret with a non-empty API token", () => {
  assert.equal(parseCloudflareApiToken('{"apiToken":"cf_test"}'), "cf_test");
  // Accepts the Resend-era `apiKey` convention as a fallback.
  assert.equal(parseCloudflareApiToken('{"apiKey":"cf_test"}'), "cf_test");
  assert.throws(() => parseCloudflareApiToken(undefined), /empty/);
  assert.throws(() => parseCloudflareApiToken("cf_test"), /must be JSON/);
  assert.throws(() => parseCloudflareApiToken("{}"), /non-empty/);
});

test("sends with sender, reply-to, and a stable idempotency-derived id", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const sender = createCloudflareEmailSender(
    { secretId: "test", accountId: "acct-1", from: "no-reply@skrc.suankularb.space", replyTo: "skrc@skrc.suankularb.space" },
    { send: async () => ({ SecretString: '{"apiToken":"cf_test"}' }) },
    (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({
        success: true, errors: [], messages: [],
        result: { delivered: ["leader@example.com"], permanent_bounces: [], queued: [] },
      }), { status: 200 });
    }) as typeof fetch,
  );
  const messageId = await sender.send(event, content);
  assert.equal(messageId, "skrc/registration_received/sub-123");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.cloudflare.com/client/v4/accounts/acct-1/email/sending/send");
  assert.equal((requests[0].init.headers as Record<string, string>).authorization, "Bearer cf_test");
  assert.deepEqual(JSON.parse(requests[0].init.body as string), {
    to: ["leader@example.com"],
    from: { address: "no-reply@skrc.suankularb.space", name: "SKRC Robotics Competition" },
    reply_to: "skrc@skrc.suankularb.space",
    subject: "Subject", text: "Text", html: "<p>HTML</p>",
  });
});

test("treats a Cloudflare returned error as a failed send", async () => {
  const sender = createCloudflareEmailSender(
    { secretId: "test", accountId: "acct-1", from: "no-reply@skrc.suankularb.space", replyTo: "skrc@skrc.suankularb.space" },
    { send: async () => ({ SecretString: '{"apiToken":"cf_test"}' }) },
    (async () => new Response(JSON.stringify({
      success: false, errors: [{ code: 1000, message: "Sender domain not verified" }],
    }), { status: 400 })) as typeof fetch,
  );
  await assert.rejects(() => sender.send(event, content), /Cloudflare email send failed: Sender domain not verified/);
});
