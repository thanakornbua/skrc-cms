# Competition operations

## Domains

- Frontend: `https://competitive.skrc.suankularb.space`
- API: `https://api.suankularb.space`
- Point the API record at the EC2 Elastic IP before starting Caddy. Set
  `CORS_ORIGIN=https://competitive.skrc.suankularb.space`. For an isolated rehearsal,
  set `API_DOMAIN=staging-api.suankularb.space` instead of editing the Caddyfile.
- Start production TLS with `docker compose --profile tls up -d`; Caddy obtains and
  renews the certificate for `api.suankularb.space` automatically.

## Staff bootstrap

`roster.csv` contains temporary credentials and must remain outside version control.
From `ops/`, run `npm run bootstrap-staff -- ../roster.csv`. The importer validates
all rows before any Cognito write and accepts the supplied `comittee` spelling as
`committee`. Correct every reported password error, bootstrap once, then securely
delete the local CSV after staff have changed their temporary passwords.
Use `npm run bootstrap-staff -- ../roster.csv --validate-only` for a no-AWS preflight.

## Transactional registration email

Onboard `skrc.suankularb.space` onto Cloudflare Email Sending (Dashboard → Email
Service → Email Sending → Onboard Domain, or `npx wrangler email sending enable
skrc.suankularb.space`) — this auto-adds the SPF and DKIM records; do not replace
unrelated MX, forwarding, or inbound-mail records. Create a Cloudflare API token
scoped to Email Sending only, store it as JSON (`{"apiToken":"..."}`) in AWS
Secrets Manager, set `CLOUDFLARE_EMAIL_TOKEN_SECRET_ID` to its exact name and
`CLOUDFLARE_ACCOUNT_ID` to the Cloudflare account ID, then set
`EMAIL_ENABLED=true` only after DNS has propagated. Run `npm run create-table` to
ensure the DynamoDB stream and notification TTL, then `npm run create-notifications`
to deploy the retrying worker and 14-day DLQ. The no-reply messages direct
recipients to `CONTACT_EMAIL`; inspect the ledger and DLQ before assuming every
notification was accepted by Cloudflare.

## EC2 API permissions

The EC2 instance role must allow `cognito-idp:AdminResetUserPassword` on the
competition Cognito user pool. This permission is used only by the admin-only
password-assistance endpoint; competitors complete the reset themselves using
the code Cognito sends to their verified email. Keep the existing least-privilege
DynamoDB permissions for the competition table so the API can record the reset
request audit item.

## T−8 days: registration opens

1. Run `npm run create-table`, `npm run create-auth`, and `npm run create-regweek`.
2. Validate and bootstrap the staff roster, then remove the local credential file.
3. Deploy the frontend with `VITE_EVENT_MODE=registration` and the Lambda/Cognito values.
4. Verify registration, approval, rejection, password reset, and CSV export with disposable data.
5. Do not provision EC2 yet; registration week is serverless.

## Competition-day morning

1. Launch the EC2 host with its least-privilege instance role and Elastic IP.
2. Point `api.suankularb.space` at the host and start `docker compose --profile tls up -d`.
3. Deploy the frontend with `VITE_EVENT_MODE=competition` and verify `/health` and CORS.
4. Configure every category limit, penalty rule, lane/device mapping, and device key.
5. Flash either `esp32dev_http` or `esp32dev_serial`; for serial, follow
   [SERIAL_BRIDGE.md](./SERIAL_BRIDGE.md). Never flash both variants to one board.
6. Complete [rehearsal.md](./rehearsal.md) before admitting real competitors.

Use the guarded mode switch only after the target branch's deployed job is the exact
expected commit. It updates branch-level build variables and starts a new Amplify job:

```bash
npm run switch-amplify-mode -- --app-id <app-id> --branch <branch> --mode competition --expected-commit <full-sha> --confirm DEPLOY-COMPETITION
```

Concluded mode additionally requires `--results-committed`; the frontend build itself
refuses concluded mode when `public/results.json` is absent. The admin UI links to the
Amplify branch when `VITE_AMPLIFY_CONSOLE_URL` is configured, but credentials and the
deployment action remain server-side/operator-controlled.

## During competition

Before the event, complete the browser-to-device rehearsal in [DRY_RUN.md](./DRY_RUN.md).

1. Admin saves the minimum safeguard plus separate maximum time and maximum tries for
   Round 1, Best of 4, Best of 2, and The Best for every active category.
2. Admin creates the allowed time-penalty rules.
3. Committee/admin uses signed-in competitor, lane, inspection, and timing pages.
4. Resolve every under-minimum run before giving that team another attempt.
5. Conclude only after checking unresolved runs, manual corrections, penalties, and DQ.
6. Export `results.json` and deploy the frontend in `concluded` mode.

For the full evidence-driven rehearsal, follow [rehearsal.md](./rehearsal.md).

## Post-event

1. Resolve every review, verify corrections/penalties/DQ, then conclude.
2. Export `results.json`, deploy the frontend in concluded mode, and verify it with the API stopped.
3. Preserve the approved non-PII result and evidence, then terminate EC2.
4. Schedule the retention command below for the printed six-month deadline.

## Retention deadline

The deadline is six calendar months after `concludedAt`. By that date:

- export and verify the non-PII final results;
- delete Cognito users;
- delete Registration items and contact fields/direct identifiers on Competitor items;
- anonymize staff usernames in retained penalty, correction, review, and audit records;
- verify the retained result contains only team names, ranks, elapsed times, penalties,
  and non-PII operational data.

Preview the guarded purge after conclusion:

```bash
cd ops
npm run purge-pii
```

The preview prints the exact deadline and refuses to run early. At the approved purge
time, first export and verify static results, take the required backup/evidence, then run:

```bash
npm run purge-pii -- --execute --confirm PURGE-PII
```

`--allow-early` exists only for an explicitly approved early erasure request. The tool
deletes Cognito users, Registration items, password-reset audits, and internal ranking
items containing competitor IDs; scrubs direct identifiers from Competitor profiles;
and replaces retained staff attribution with `ANONYMIZED`. The privacy-safe public
result stored at conclusion remains the authoritative archive. Retain the purge's
count-only JSON summary with the event records.
