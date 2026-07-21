# Cloudflare Email Sending migration handoff

Scope: replace Resend with Cloudflare Email Sending for registration lifecycle email
Sender: `SKRC Robotics Competition <no-reply@skrc.suankularb.space>`
Reply-To and support contact: `skrc@skrc.suankularb.space`

## Implementation status — 2026-07-21

- Completed in code: `backend/src/notifications/cloudflare-email.ts` (REST-API
  transport replacing `resend.ts`), `handler.ts` wired to the new sender and env
  vars, `cloudflare-email.test.ts` (mirrors the old `resend.test.ts` coverage:
  token parsing, request payload/idempotency shape, error propagation),
  `ops/src/create-notifications.ts` updated to provision the Cloudflare secret's
  IAM grant instead of Resend's, `resend` dependency removed from
  `backend/package.json`, docs (`docs/spec/ENV.md`, `ops/RUNBOOK.md`,
  `ops/PRODUCTION_RELEASE.md`, `docs/spec/DECISIONS.md` D13) updated.
- Backend build (`npm run build`) and `npm run test:notifications` pass (8/8).
- Outstanding — requires Cloudflare/AWS account access, not done by this change:
  onboarding `skrc.suankularb.space` onto Cloudflare Email Sending, creating the
  scoped API token, creating the Secrets Manager secrets (staging + production),
  and the staging/production lifecycle smoke tests described below.
- Deferred by design: revoking the Resend API key and deleting the
  `/robo-compet/{staging,production}/resend-api-key` secrets, per the cleanup
  gate below — do this only after Cloudflare lifecycle evidence exists.

## Outcome

Registration-received and registration-approved messages must be sent through
Cloudflare Email Sending. Resend must no longer be used by application code,
provisioning, IAM, configuration, dependencies, or operational documentation
(already done in this change — see status above).

Retain the reliable provider-independent path already in place:

```text
DynamoDB registration stream
  -> email Lambda worker
  -> notification idempotency ledger
  -> Cloudflare Email Sending REST API
  -> SQS dead-letter queue on exhausted retries
```

Do not replace or remove the Lambda worker, DynamoDB stream, notification ledger,
event-source mapping, or SQS DLQ. "Remove Resend" means removing the Resend
transport and Resend-specific resources, not removing the notification worker.

## Why the REST API, not a Cloudflare Worker

The backend is a DynamoDB-Stream-triggered AWS Lambda, not a Cloudflare Worker —
it gets no benefit from the `send_email` Workers binding (no API-key-free
auth, since it isn't running on Cloudflare's platform). Introducing a Worker as
an email-sending proxy would add a second deployable service (wrangler config,
its own deploy pipeline, a Worker-side auth scheme) purely to re-wrap a REST
call the Lambda can make directly. Calling
`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send`
straight from `cloudflare-email.ts` keeps the same single-service architecture
that the SES→Resend migration already established as sound.

## Secret contract

The Cloudflare API token must be stored in AWS Secrets Manager in the workload
region (`ap-southeast-7`). Never put it in Git, `ops/.env`, Lambda environment
variables, test fixtures, command output, or documentation.

Staging secret name:

```text
/robo-compet/staging/cloudflare-email-token
```

Production secret name:

```text
/robo-compet/production/cloudflare-email-token
```

Store the value as JSON:

```json
{"apiToken":"REPLACE_WITH_REAL_TOKEN"}
```

The Lambda environment contains `CLOUDFLARE_EMAIL_TOKEN_SECRET_ID` (the secret
name) and `CLOUDFLARE_ACCOUNT_ID` (not secret — the Cloudflare account ID).
The worker retrieves the secret once per cold start and caches the parsed
token. It fails closed when the secret is missing, malformed, or blank. Never
log the secret or the full Secrets Manager response.

Scope the Cloudflare API token to Email Sending only, restricted to the
onboarded `skrc.suankularb.space` domain. Use a distinct token for staging and
production if staging sends from a separate onboarded domain/subdomain;
otherwise a single token scoped to the account is acceptable for both, gated
by the separate secrets above.

## Operator setup steps (not code — requires Cloudflare/AWS console or CLI access)

1. Confirm `suankularb.space` (or at least the records for
   `skrc.suankularb.space`) is Cloudflare-DNS-authoritative — already implied
   by the existing `competitive.skrc.suankularb.space` and `api.suankularb.space`
   CNAME usage in `ops/PRODUCTION_RELEASE.md`.
2. Onboard the domain: `npx wrangler email sending enable skrc.suankularb.space`
   (or Dashboard → Compute & AI → Email Service → Email Sending → Onboard
   Domain). This auto-adds SPF and DKIM records; do not replace unrelated MX,
   forwarding, or inbound-mail records. Verify with
   `npx wrangler email sending dns get skrc.suankularb.space`.
3. Create a Cloudflare API token scoped to Email Sending (Dashboard → My
   Profile → API Tokens, or via the Cloudflare API), restricted to the account
   that owns `skrc.suankularb.space`.
4. Store the token as JSON at the staging and production secret names above.
5. Optionally add a DMARC TXT record if one doesn't already exist for the
   domain (recommended, not required, by Cloudflare's deliverability guidance).

## Deployment sequence

1. Complete the operator setup steps above for staging.
2. Deploy the updated worker (`npm run create-notifications`) with
   `EMAIL_ENABLED=false`.
3. Inspect the Lambda configuration, exact-secret IAM permission, event-source
   mapping, and DLQ.
4. Set `EMAIL_ENABLED=true` and enable the mapping.
5. Register one disposable competitor and approve it.
6. Confirm both messages arrive and verify From, Reply-To, Thai/English
   rendering, portal links, SPF, DKIM, ledger `ACCEPTED` state, and an empty
   DLQ. Cross-check delivery status via the Cloudflare Email Service
   analytics tab or the GraphQL `emailSendingAdaptive` dataset.
7. Repeat the duplicate-approval check and confirm attempts remain one.
8. Repeat steps 1-7 for production before relying on it for real registrations.

If validation fails, disable the event-source mapping first to stop new
attempts, diagnose the ledger/DLQ, and redeploy. Do not temporarily re-enable
Resend unless explicitly authorized.

## Resend cleanup gate

Only after the complete staging (and, before go-live, production) lifecycle
succeeds through Cloudflare:

- revoke the Resend API key in the Resend dashboard;
- delete `/robo-compet/staging/resend-api-key` and
  `/robo-compet/production/resend-api-key` from Secrets Manager;
- confirm no `resend` package or Resend-specific code/config remains
  (already done in this change);
- leave an audit note that the Resend account/domain verification is obsolete;
  do not touch unrelated DNS records for `thanakorn.site` without a separate
  explicit decision, since that domain may still be in use for other purposes.

Secret deletion and API key revocation are effectively irreversible. Confirm
the new provider has real production evidence before doing either.

## Acceptance criteria

- Both registration lifecycle emails are accepted by Cloudflare Email Sending
  from `no-reply@skrc.suankularb.space`.
- Reply-To is `skrc@skrc.suankularb.space`.
- The Cloudflare API token exists only in Secrets Manager and does not appear
  in Lambda environment output, files, Git history, tests, or logs.
- Retry, durable idempotency, TTL, and DLQ behavior remain intact.
- Backend and ops builds/tests pass.
- Repository search finds no active Resend code, dependency, IAM permission,
  or runtime configuration.
- Staging lifecycle smoke passes with two accepted messages, no duplicate
  sends, and an empty DLQ, before repeating in production.
