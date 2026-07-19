# Competition operations

## Domains

- Frontend: `https://competitive.skrc.suankularb.space`
- API: `https://api.suankularb.space`
- Point the API record at the EC2 Elastic IP before starting Caddy. Set
  `CORS_ORIGIN=https://competitive.skrc.suankularb.space`.
- Start production TLS with `docker compose --profile tls up -d`; Caddy obtains and
  renews the certificate for `api.suankularb.space` automatically.

## Staff bootstrap

`roster.csv` contains temporary credentials and must remain outside version control.
From `ops/`, run `npm run bootstrap-staff -- ../roster.csv`. The importer validates
all rows before any Cognito write and accepts the supplied `comittee` spelling as
`committee`. Correct every reported password error, bootstrap once, then securely
delete the local CSV after staff have changed their temporary passwords.
Use `npm run bootstrap-staff -- ../roster.csv --validate-only` for a no-AWS preflight.

## EC2 API permissions

The EC2 instance role must allow `cognito-idp:AdminResetUserPassword` on the
competition Cognito user pool. This permission is used only by the admin-only
password-assistance endpoint; competitors complete the reset themselves using
the code Cognito sends to their verified email. Keep the existing least-privilege
DynamoDB permissions for the competition table so the API can record the reset
request audit item.

## Competition day

Before the event, complete the browser-to-device rehearsal in [DRY_RUN.md](./DRY_RUN.md).

1. Admin saves minimum and maximum times for every active category.
2. Admin creates the allowed time-penalty rules.
3. Committee/admin uses signed-in competitor, lane, inspection, and timing pages.
4. Resolve every under-minimum run before giving that team another attempt.
5. Conclude only after checking unresolved runs, manual corrections, penalties, and DQ.
6. Export `results.json` and deploy the frontend in `concluded` mode.

## Retention deadline

The deadline is six calendar months after `concludedAt`. By that date:

- export and verify the non-PII final results;
- delete Cognito users;
- delete Registration items and contact fields/direct identifiers on Competitor items;
- anonymize staff usernames in retained penalty, correction, review, and audit records;
- verify the retained result contains only team names, ranks, elapsed times, penalties,
  and non-PII operational data.
