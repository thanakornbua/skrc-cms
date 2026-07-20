import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Resend } from "resend";
import type { EmailContent, NotificationEvent } from "./core.js";
import { providerIdempotencyKey } from "./core.js";

export interface EmailSender {
  send(event: NotificationEvent, content: EmailContent): Promise<string>;
}

export interface ResendConfig {
  secretId: string;
  from: string;
  replyTo: string;
}

type ResendClient = Pick<Resend, "emails">;
type SecretReader = { send: (command: GetSecretValueCommand) => Promise<{ SecretString?: string }> };

export function parseResendApiKey(secretString: string | undefined): string {
  if (!secretString) throw new Error("Resend API key secret is empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new Error("Resend API key secret must be JSON with an apiKey property");
  }
  const apiKey = typeof parsed === "object" && parsed !== null ? (parsed as { apiKey?: unknown }).apiKey : undefined;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Resend API key secret must contain a non-empty apiKey");
  return apiKey;
}

/** Retrieves credentials once per Lambda execution environment without logging them. */
export function createResendSender(
  config: ResendConfig,
  secrets: SecretReader = new SecretsManagerClient({}),
  createClient: (apiKey: string) => ResendClient = (apiKey) => new Resend(apiKey),
): EmailSender {
  let clientPromise: Promise<ResendClient> | undefined;
  const client = (): Promise<ResendClient> => {
    clientPromise ??= secrets.send(new GetSecretValueCommand({ SecretId: config.secretId }))
      .then((response) => createClient(parseResendApiKey(response.SecretString)));
    return clientPromise;
  };

  return {
    async send(event, content): Promise<string> {
      const result = await (await client()).emails.send({
        from: config.from,
        to: [event.contactEmail],
        replyTo: config.replyTo,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }, { idempotencyKey: providerIdempotencyKey(event) });
      if (result.error) throw new Error(`Resend send failed: ${result.error.message}`);
      if (!result.data?.id) throw new Error("Resend send returned no email ID");
      return result.data.id;
    },
  };
}
