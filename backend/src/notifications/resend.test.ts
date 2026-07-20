import assert from "node:assert/strict";
import test from "node:test";
import type { Resend } from "resend";
import { createResendSender, parseResendApiKey } from "./resend.js";
import type { NotificationEvent } from "./core.js";

const event: NotificationEvent = {
  type: "REGISTRATION_RECEIVED", eventId: "event-1", sub: "sub-123",
  contactEmail: "leader@example.com", teamName: "Robots", category: "Open",
  createdAt: "2026-07-21T00:00:00.000Z", deleteBy: "2027-01-21T00:00:00.000Z",
};
const content = { subject: "Subject", text: "Text", html: "<p>HTML</p>" };

test("requires a JSON secret with a non-empty API key", () => {
  assert.equal(parseResendApiKey('{"apiKey":"re_test"}'), "re_test");
  assert.throws(() => parseResendApiKey(undefined), /empty/);
  assert.throws(() => parseResendApiKey("re_test"), /must be JSON/);
  assert.throws(() => parseResendApiKey("{}"), /non-empty/);
});

test("sends both formats with sender, reply-to, and stable idempotency key", async () => {
  const requests: Array<{ payload: Record<string, unknown>; options: { idempotencyKey: string } }> = [];
  const sender = createResendSender(
    { secretId: "test", from: "SKRC <no-reply@thanakorn.site>", replyTo: "thanakorn@thanakorn.site" },
    { send: async () => ({ SecretString: '{"apiKey":"re_test"}' }) },
    () => ({ emails: { send: async (payload: Record<string, unknown>, options: { idempotencyKey: string }) => {
      requests.push({ payload, options });
      return { data: { id: "email-123" }, error: null };
    } } } as unknown as Pick<Resend, "emails">),
  );
  assert.equal(await sender.send(event, content), "email-123");
  assert.deepEqual(requests, [{
    payload: {
      from: "SKRC <no-reply@thanakorn.site>", to: ["leader@example.com"],
      replyTo: "thanakorn@thanakorn.site", subject: "Subject", text: "Text", html: "<p>HTML</p>",
    },
    options: { idempotencyKey: "skrc/registration_received/sub-123" },
  }]);
});

test("treats a Resend returned error as a failed send", async () => {
  const sender = createResendSender(
    { secretId: "test", from: "SKRC <no-reply@thanakorn.site>", replyTo: "thanakorn@thanakorn.site" },
    { send: async () => ({ SecretString: '{"apiKey":"re_test"}' }) },
    () => ({ emails: { send: async () => ({ data: null, error: { message: "domain not verified" } }) } } as unknown as Pick<Resend, "emails">),
  );
  await assert.rejects(() => sender.send(event, content), /Resend send failed: domain not verified/);
});
