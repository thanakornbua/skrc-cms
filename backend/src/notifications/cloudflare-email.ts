import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { EmailContent, NotificationEvent } from "./core.js";
import { providerIdempotencyKey } from "./core.js";

export interface EmailSender {
  send(event: NotificationEvent, content: EmailContent): Promise<string>;
}

export interface CloudflareEmailConfig {
  secretId: string;
  accountId: string;
  from: string;
  replyTo: string;
}

type SecretReader = { send: (command: GetSecretValueCommand) => Promise<{ SecretString?: string }> };
type FetchLike = typeof fetch;

interface CloudflareSendResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: { message_id?: string; delivered: string[]; permanent_bounces: string[]; queued: string[] };
}

export function parseCloudflareApiToken(secretString: string | undefined): string {
  if (!secretString) throw new Error("Cloudflare email API token secret is empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new Error("Cloudflare email API token secret must be JSON with an apiToken property");
  }
  // Accept `apiToken` (canonical) or `apiKey` (the prior Resend-era secret
  // convention some secrets were created with) so a key-name mismatch can't
  // silently break the production email path.
  const apiToken = typeof parsed === "object" && parsed !== null
    ? (parsed as { apiToken?: unknown; apiKey?: unknown }).apiToken ?? (parsed as { apiKey?: unknown }).apiKey
    : undefined;
  if (typeof apiToken !== "string" || !apiToken.trim()) throw new Error("Cloudflare email API token secret must contain a non-empty apiToken (or apiKey)");
  return apiToken;
}

/** Retrieves credentials once per Lambda execution environment without logging them. */
export function createCloudflareEmailSender(
  config: CloudflareEmailConfig,
  secrets: SecretReader = new SecretsManagerClient({}),
  fetchImpl: FetchLike = fetch,
): EmailSender {
  let tokenPromise: Promise<string> | undefined;
  const token = (): Promise<string> => {
    tokenPromise ??= secrets.send(new GetSecretValueCommand({ SecretId: config.secretId }))
      .then((response) => parseCloudflareApiToken(response.SecretString));
    return tokenPromise;
  };

  return {
    async send(event, content): Promise<string> {
      const apiToken = await token();
      const idempotencyKey = providerIdempotencyKey(event);
      const res = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            to: [event.contactEmail],
            from: { address: config.from, name: "SKRC Robotics Competition" },
            reply_to: config.replyTo,
            subject: content.subject,
            text: content.text,
            html: content.html,
          }),
        },
      );
      const body = await res.json() as CloudflareSendResponse;
      if (!res.ok || !body.success) {
        const message = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
        throw new Error(`Cloudflare email send failed: ${message}`);
      }
      // Prefer Cloudflare's real message id for ledger traceability; fall back
      // to the stable idempotency key if the response ever omits it.
      return body.result?.message_id ?? idempotencyKey;
    },
  };
}
