# Resend migration handoff

Scope: replace Amazon SES with Resend for registration lifecycle email
Sender: `SKRC Robotics Competition <no-reply@thanakorn.site>`
Reply-To and support contact: `thanakorn@thanakorn.site`

## Implementation status — 2026-07-21

- Completed in staging: Resend transport, Secrets Manager retrieval, least-privilege
  IAM, provider-neutral provisioning, configuration/docs, and automated tests.
- Deployed worker: `robo-compet-staging-email-worker`, enabled with the exact staging
  Resend secret and no SES send permission.
- Staging provider smoke: both disposable receipt and approval events were accepted
  on their first attempt and recorded Resend email IDs; the disposable ledger entries
  were removed afterward.
- Outstanding operational evidence: the staging DLQ contains two historical
  retry-exhaustion records from the superseded SES worker. Their failure was SES
  sandbox-recipient authorization, not Resend. Do not delete them without explicit
  approval.
- Deferred by design: deletion of SES identities and SES-specific DNS records still
  requires the cleanup approval described below.

## Outcome

Registration-received and registration-approved messages must be sent through
Resend. Amazon SES must no longer be used by application code, provisioning, IAM,
configuration, dependencies, or operational documentation.

Retain the reliable provider-independent path already in place:

```text
DynamoDB registration stream
  -> email Lambda worker
  -> notification idempotency ledger
  -> Resend API
  -> SQS dead-letter queue on exhausted retries
```

Do not replace or remove the Lambda worker, DynamoDB stream, notification ledger,
event-source mapping, or SQS DLQ. In this task, "remove SES" means removing the SES
transport and SES resources, not removing the notification worker.

## Secret contract

The Resend API key must be stored in AWS Secrets Manager in the workload region
(`ap-southeast-7`). Never put it in Git, `ops/.env`, Lambda environment variables,
test fixtures, command output, or documentation.

Staging secret name:

```text
/robo-compet/staging/resend-api-key
```

Production secret name:

```text
/robo-compet/production/resend-api-key
```

Store the value as JSON:

```json
{"apiKey":"re_REPLACE_WITH_REAL_KEY"}
```

The Lambda environment contains only `RESEND_API_KEY_SECRET_ID`, whose value is the
secret name. The worker retrieves the secret once per cold start and caches the
constructed Resend client. It must fail closed when the secret is missing, malformed,
or blank. Never log the secret or the full Secrets Manager response.

Use a Resend API key with `sending_access`, restricted to the verified
`thanakorn.site` domain. Use a distinct key/secret for staging and production.

## Implementation

### 1. Replace the transport

In `backend/src/notifications/handler.ts`:

- Remove `SESv2Client`, `SendEmailCommand`, and `EMAIL_REGION`.
- Add the Resend SDK and AWS Secrets Manager client.
- Read and cache the Resend key according to the secret contract above.
- Send both the existing HTML and plain-text bodies.
- Set `from` to `SKRC Robotics Competition <no-reply@thanakorn.site>`.
- Set `replyTo` to `thanakorn@thanakorn.site`.
- Explicitly check Resend's returned `error`; do not assume every resolved promise
  represents a successful request.
- Store the returned Resend email ID in the existing `messageId` ledger attribute.
- Preserve `PROCESSING`, `FAILED`, and `ACCEPTED` ledger behavior and error truncation.
- Add a Resend idempotency key no longer than 256 characters. Use the stable format
  `skrc/<notification-type>/<registration-sub>`. The DynamoDB ledger remains the
  durable duplicate guard because Resend retains idempotency keys for only 24 hours.
- Preserve `EMAIL_ENABLED=false` as a hard no-send switch.

Keep `backend/src/notifications/core.ts` and the bilingual templates unless a small
provider-neutral refactor is required. Do not move message content into Resend-hosted
templates in this migration.

### 2. Update notification provisioning

In `ops/src/create-notifications.ts`:

- Remove all SES SDK imports, clients, identity lookup/creation, MAIL-FROM setup, and
  SES status output.
- Remove `EMAIL_REGION`, `EMAIL_DOMAIN`, and `SES_SANDBOX_RECIPIENT` handling.
- Remove every `ses:SendEmail` IAM statement.
- Add `secretsmanager:GetSecretValue` permission restricted to the exact Resend
  secret ARN. Resolve the ARN during provisioning rather than using a broad wildcard.
- Pass `RESEND_API_KEY_SECRET_ID`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `PORTAL_URL`,
  `CONTACT_EMAIL`, and `EMAIL_ENABLED` to the Lambda.
- Default `EMAIL_FROM` to `no-reply@thanakorn.site` and `EMAIL_REPLY_TO` to
  `thanakorn@thanakorn.site`.
- Update descriptions and logs so they describe Resend or provider-neutral email,
  never SES.
- Keep the existing event-source retry settings, batch size, maximum record age,
  bisect behavior, and 14-day DLQ.
- If the secret does not exist, stop with a clear error before mutating the Lambda or
  event-source mapping.

Keep the command name `npm run create-notifications`; it is provider-neutral.

### 3. Dependencies and configuration

- Add `resend` and `@aws-sdk/client-secrets-manager` to the appropriate packages.
- Remove `@aws-sdk/client-sesv2` from both `backend` and `ops` when no imports remain.
- Regenerate package lockfiles with npm; do not hand-edit lockfiles.
- Update `ops/.env.example` and `docs/spec/ENV.md`:
  - remove `EMAIL_REGION`;
  - remove `EMAIL_DOMAIN`;
  - remove `SES_SANDBOX_RECIPIENT`;
  - add `RESEND_API_KEY_SECRET_ID` with a placeholder secret name;
  - change the default sender to `no-reply@thanakorn.site`.
- Update `ops/RUNBOOK.md` to document Resend domain verification, Secrets Manager,
  verification, monitoring, and rollback.
- Search the repository for `SES`, `ses:`, `client-ses`, `EMAIL_REGION`,
  `EMAIL_DOMAIN`, and `SES_SANDBOX_RECIPIENT`; no active application or operations
  reference may remain. Historical decision records may be updated with an explicit
  superseded note rather than silently rewritten.

### 4. Tests

Keep the existing event classification and content tests. Add provider-boundary tests
using dependency injection or a small transport module; tests must never call Resend.

Cover at least:

1. A successful Resend response marks the ledger `ACCEPTED` and stores its email ID.
2. A returned Resend `error` marks the ledger `FAILED` and throws for Lambda retry.
3. A thrown network/API error marks the ledger `FAILED` and throws.
4. An already accepted notification does not call Resend again.
5. The request has the exact From and Reply-To values and contains both HTML and text.
6. Registration-received and registration-approved use distinct, stable idempotency
   keys.
7. A missing, invalid, or blank Secrets Manager value fails without sending.
8. `EMAIL_ENABLED=false` performs no claim and no send.

Run backend notification tests, TypeScript builds for `backend` and `ops`, and the
existing relevant repository tests.

## Deployment sequence

1. In Resend, verify `thanakorn.site` using its supplied SPF and DKIM records. Do not
   replace unrelated MX, forwarding, or inbound-mail DNS records.
2. Create the restricted Resend sending key and store it in the staging secret.
3. Deploy the refactored worker with `EMAIL_ENABLED=false`.
4. Inspect the Lambda configuration, exact-secret IAM permission, event-source mapping,
   and DLQ.
5. Set `EMAIL_ENABLED=true` and enable the mapping.
6. Register one disposable competitor and approve it.
7. Confirm both messages arrive and verify From, Reply-To, Thai/English rendering,
   portal links, SPF, DKIM, ledger `ACCEPTED` state, Resend email IDs, and an empty DLQ.
8. Repeat the duplicate-approval check and confirm attempts remain one.
9. Deploy production only after the staging lifecycle test passes.

If validation fails, disable the event-source mapping first to stop new attempts,
diagnose the ledger/DLQ, and redeploy. Do not temporarily restore SES unless explicitly
authorized.

## Delivery-status follow-up

After the send-path cutover is stable, add a signed Resend webhook endpoint for:

- `email.delivered`
- `email.bounced`
- `email.complained`
- `email.failed`
- `email.suppressed`

Verify signatures against the untouched raw request body. Deduplicate at-least-once
webhook delivery using `svix-id`, and use event timestamps because delivery order is
not guaranteed. Store final delivery status against the notification ledger and make
permanent failures/complaints visible to operators. Store the webhook signing secret
in Secrets Manager under a separate secret name.

This webhook is strongly recommended but must not block the initial SES-to-Resend
transport cutover unless the supervising agent expands the task scope.

## SES cleanup gate

Only after the complete staging lifecycle succeeds through Resend:

- remove SES IAM permissions from the Lambda role;
- confirm SES packages and configuration have been removed;
- delete the unused SES identities for `suankularb.space` and
  `notify.suankularb.space`;
- remove only DNS records proven to belong to those SES identities and their custom
  MAIL-FROM configuration;
- preserve apex MX, forwarding, SPF, DMARC, and all unrelated mail records;
- leave an audit note that the SES production-access request is obsolete.

Cloud resource and DNS deletion is destructive. Terra must inventory exact resource
IDs and record values, present them to the supervising agent, and obtain explicit
approval immediately before deletion. Code/IAM removal is part of the implementation
and does not require a separate cleanup phase.

## Acceptance criteria

- Both registration lifecycle emails are accepted by Resend from
  `no-reply@thanakorn.site`.
- Reply-To is `thanakorn@thanakorn.site`.
- The Resend API key exists only in Secrets Manager and does not appear in Lambda
  environment output, files, Git history, tests, or logs.
- Retry, durable idempotency, TTL, and DLQ behavior remain intact.
- Backend and ops builds/tests pass.
- Repository search finds no active SES code, dependency, IAM permission, or runtime
  configuration.
- Staging lifecycle smoke passes with two accepted messages, no duplicate sends, and
  an empty DLQ.
- The worktree contains no unrelated changes and commits contain no AI contributor or
  co-author attribution.
