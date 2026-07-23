import { buildClient, CommitmentPolicy, KmsKeyringNode } from "@aws-crypto/client-node";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { CustomEmailSenderTriggerEvent } from "aws-lambda";
import { parseCloudflareApiToken } from "../notifications/cloudflare-email.js";
import type { EmailContent } from "../notifications/core.js";
import { buildResetEmail } from "./reset-email.js";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "no-reply@skrc.suankularb.space";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "skrc@skrc.suankularb.space";
const PORTAL_URL = process.env.PORTAL_URL ?? "https://competitive.skrc.suankularb.space/portal";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "skrc@skrc.suankularb.space";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_EMAIL_TOKEN_SECRET_ID = process.env.CLOUDFLARE_EMAIL_TOKEN_SECRET_ID;
const KMS_KEY_ARN = process.env.CUSTOM_EMAIL_KMS_KEY_ARN;

type FetchLike = typeof fetch;
type SecretReader = { send: (command: GetSecretValueCommand) => Promise<{ SecretString?: string }> };

/** Decrypts the KMS-encrypted one-time code Cognito passes to a CustomEmailSender trigger. */
export type CodeDecryptor = (encryptedCode: string) => Promise<string>;

export interface AuthEmailDeps {
  decrypt: CodeDecryptor;
  accountId: string;
  from: string;
  replyTo: string;
  portalUrl: string;
  contactAddress: string;
  token: () => Promise<string>;
  fetchImpl?: FetchLike;
}

interface CloudflareSendResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: { message_id?: string };
}

/** Only the password-recovery flows deliver a code a competitor types back into
 *  the portal. Sign-up is auto-confirmed, so no other source is expected — but
 *  once CustomEmailSender is enabled, every Cognito email routes here, so an
 *  unhandled source must fail loudly rather than silently drop the email. */
const CODE_TRIGGER_SOURCES = new Set([
  "CustomEmailSender_ForgotPassword",
  "CustomEmailSender_ResendCode",
]);

async function sendViaCloudflare(
  deps: AuthEmailDeps,
  to: string,
  content: EmailContent,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiToken = await deps.token();
  const res = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${deps.accountId}/email/sending/send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        to: [to],
        from: { address: deps.from, name: "SKRC Robotics Competition" },
        reply_to: deps.replyTo,
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
}

export function createAuthEmailHandler(deps: AuthEmailDeps) {
  return async function handler(event: CustomEmailSenderTriggerEvent): Promise<CustomEmailSenderTriggerEvent> {
    if (!CODE_TRIGGER_SOURCES.has(event.triggerSource)) {
      throw new Error(`Unsupported CustomEmailSender trigger source: ${event.triggerSource}`);
    }
    // triggerSource is narrowed above, but the SDK types keep userAttributes as a
    // union across all sources — read email through a plain string map.
    const to = (event.request.userAttributes as Record<string, string>).email;
    if (!to) throw new Error("CustomEmailSender event has no email attribute to deliver to");
    if (!event.request.code) throw new Error("CustomEmailSender event has no code to deliver");

    const code = await deps.decrypt(event.request.code);
    const content = buildResetEmail(code, {
      portalUrl: deps.portalUrl,
      contactAddress: deps.contactAddress,
    });
    await sendViaCloudflare(deps, to, content);
    return event;
  };
}

/** Builds the real KMS-backed decryptor. The AWS Encryption SDK client and the
 *  keyring are created once per execution environment and reused across invokes. */
export function createKmsDecryptor(keyArn: string): CodeDecryptor {
  const { decrypt } = buildClient(CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT);
  const keyring = new KmsKeyringNode({ keyIds: [keyArn] });
  return async (encryptedCode: string): Promise<string> => {
    const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, "base64"));
    return plaintext.toString("utf-8");
  };
}

function createTokenReader(secretId: string, secrets: SecretReader): () => Promise<string> {
  let tokenPromise: Promise<string> | undefined;
  return () => {
    tokenPromise ??= secrets.send(new GetSecretValueCommand({ SecretId: secretId }))
      .then((response) => parseCloudflareApiToken(response.SecretString));
    return tokenPromise;
  };
}

function buildDefaultHandler() {
  if (!CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  if (!CLOUDFLARE_EMAIL_TOKEN_SECRET_ID) throw new Error("CLOUDFLARE_EMAIL_TOKEN_SECRET_ID is required");
  if (!KMS_KEY_ARN) throw new Error("CUSTOM_EMAIL_KMS_KEY_ARN is required");
  const secrets = new SecretsManagerClient({});
  return createAuthEmailHandler({
    decrypt: createKmsDecryptor(KMS_KEY_ARN),
    accountId: CLOUDFLARE_ACCOUNT_ID,
    from: EMAIL_FROM,
    replyTo: EMAIL_REPLY_TO,
    portalUrl: PORTAL_URL,
    contactAddress: CONTACT_EMAIL,
    token: createTokenReader(CLOUDFLARE_EMAIL_TOKEN_SECRET_ID, secrets),
  });
}

// Instantiated lazily so unit tests can import the factory without real env/config.
let defaultHandler: ReturnType<typeof createAuthEmailHandler> | undefined;
export async function handler(event: CustomEmailSenderTriggerEvent): Promise<CustomEmailSenderTriggerEvent> {
  defaultHandler ??= buildDefaultHandler();
  return defaultHandler(event);
}
