# Production release procedure

Prepare infrastructure before competition, but do not launch the EC2 instance until
competition day. Use disposable records for all production smoke tests; never reset,
purge, or replace production data.

## Fixed production values

- Region/table: `ap-southeast-7` / `robo-compet`.
- Cognito: pool `ap-southeast-7_ZWnRxXneN`, client `4jennh6lfhjddhd0uksueu9rm4`.
- Browser CORS origin: `https://competitive.skrc.suankularb.space` exactly.
- Cloudflare email token secret: `/robo-compet/production/cloudflare-email-token`,
  holding only `{"apiToken":"..."}`. Never put its value in Git, Lambda environment,
  output, logs, or PRs.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID owning `skrc.suankularb.space`
  (not secret).
- Sender/reply-to: `no-reply@skrc.suankularb.space` / `skrc@skrc.suankularb.space`.

## Staging gate

Deploy with staging-specific resources and `EMAIL_ENABLED=false`; enable notifications
only after `skrc.suankularb.space` is onboarded onto Cloudflare Email Sending and its
SPF/DKIM records have propagated. Rehearse registration and CORS, received/approval
emails, all four stages, serial simulation, scoring, advancement, and final ordering.
Attach results to the PR.

## Production data and worker

Before deployment, record current Lambda configuration/version, frontend commit, and
table description for rollback. With an authenticated production AWS profile:

```bash
aws dynamodb update-continuous-backups --region ap-southeast-7 --table-name robo-compet --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
aws dynamodb create-backup --region ap-southeast-7 --table-name robo-compet --backup-name robo-compet-pre-release-YYYYMMDD
aws dynamodb describe-table --region ap-southeast-7 --table-name robo-compet
aws lambda get-function-configuration --region ap-southeast-7 --function-name robo-compet-registration
```

Run `npm run create-table` with `DYNAMO_TABLE=robo-compet`; it updates stream/TTL in
place and never replaces data. Deploy the registration Lambda using the fixed values.
Deploy the email worker with the production secret, 14-day DLQ, and notifications
disabled. Once the Cloudflare Email Sending domain is verified, enable its mapping
and lifecycle-test a disposable registration and approval.

## Amplify Hosting

Create `robo-compet-production` in `ap-southeast-1`, connected to
`thanakornbua/skrc-cms`, root `frontend`, production branch `main`, and a preview for
`release/competition-production`. Use [amplify.yml](../amplify.yml), publish `dist`,
and configure SPA fallback to `index.html`.

Set build variables outside source control:

```text
VITE_REGWEEK_API_URL=<production registration API>
VITE_API_BASE_URL=<competition EC2 API>
VITE_COGNITO_USER_POOL_ID=ap-southeast-7_ZWnRxXneN
VITE_COGNITO_CLIENT_ID=4jennh6lfhjddhd0uksueu9rm4
VITE_EVENT_MODE=registration
```

Attach `competitive.skrc.suankularb.space` using only Amplify-issued validation and
CNAME records in Cloudflare.

## EC2 preparation and competition day

Push a SHA-tagged immutable backend image to ECR. Prepare, but do not launch, a
Ubuntu 24.04 LTS `t3.small` template: encrypted 20 GiB gp3, SSM-only role/profile
with least-privilege DynamoDB, Cognito password-reset, ECR, logging, and secret
access; public TCP 80/443 only; no public SSH. Cloud-init loads secrets, pulls the
pinned image, starts API/Caddy, and checks `/health`. Allocate an EIP now, document
its public IPv4 charge, and leave it unassociated.

On competition day launch from the tested template, associate the EIP, point
`api.suankularb.space` through Cloudflare, and verify TLS, health, auth, CORS,
DynamoDB, and gate authentication. Set Amplify `VITE_EVENT_MODE=competition` and
redeploy. Admin must configure all four stage limits for every category before Round 1.

## Finalization and rollback

After Cloudflare Email Sending lifecycle evidence, revoke the Resend API key,
delete the `/robo-compet/{staging,production}/resend-api-key` secrets, and remove
the `resend` dependency if any residual references remain. Preserve unrelated MX,
forwarding, and DNS records — only Resend-specific records may be removed. Merge
only after review and green checks; tag the merged commit. Roll back
Lambda/configuration and Amplify first; restore DynamoDB only for confirmed
corruption with explicit authorization.
