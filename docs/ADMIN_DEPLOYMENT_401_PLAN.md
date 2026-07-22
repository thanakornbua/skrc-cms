# `/admin/deployment` 401 investigation and remediation

## Objective

Ensure a fresh Cognito administrator receives `200` from `GET /deployment/status`; preserve `401` for missing or invalid credentials and `403` for authenticated non-administrators.

## Baseline (2026-07-22)

- Amplify and the control Lambda use Cognito pool `ap-southeast-7_ZWnRxXneN` and client `4jennh6lfhjddhd0uksueu9rm4`.
- The control HTTP API permits the production origin, `authorization`, and `content-type`.
- Commit `fce59e4` added case-insensitive authorization-header handling and CloudWatch log permissions.
- The control Lambda intentionally returns generic authentication responses. It must never return a token or decoded claims.

## Remediation implemented

1. `LoginGate` now requires an actual Cognito ID token rather than merely a remembered current user before rendering protected content.
2. Control API calls retry exactly once with `fetchAuthSession({ forceRefresh: true })` after a `401`. A second `401` signs the user out locally and displays `Session expired—sign in again.`
3. The Lambda emits only `{ event, requestId, category }` for failed authentication. Categories are `missing_token`, `expired_token`, `wrong_pool`, `wrong_client`, `wrong_token_use`, `invalid_signature`, and `non_admin`.
4. UI errors distinguish expired session (`401`), insufficient admin role (`403`), network failure, and unexpected server failure.

## Verification procedure

1. Sign out, clear the Amplify session, sign in as the existing administrator, and open `/admin/deployment`.
2. In browser Network tools, confirm the status request has a bearer header. Record only origin, status/error code, and JWT metadata (issuer, client ID, expiry, token use, groups); never save a token, password, email, subject, or refresh token.
3. Confirm the status response reports the active branch, commit, job, and `registration` mode.
4. Confirm CloudWatch contains only the fixed diagnostic category and request ID for a deliberately unauthenticated request; inspect that no token or PII is logged.
5. Verify missing/invalid credentials return `401`, an authenticated non-admin returns `403`, and a fresh admin receives `200`.

## Deployment record

- Source commit: `b51787bd1f6b6fdfff55ad7ad2f8cf31440bafa2` (`Harden deployment control authentication`).
- Control Lambda updated: `2026-07-22T06:28:34.471Z`, runtime `nodejs22.x`.
- Amplify job `18` succeeded for the same source commit at `2026-07-22T06:30:12.476+07:00`.
- Sanitized API evidence before frontend release: no bearer header returned `401 UNAUTHORIZED` and logged `missing_token`; an intentionally invalid bearer value returned `401 UNAUTHORIZED` and logged `invalid_signature`.
- No bearer values, claims, usernames, email addresses, subjects, or refresh tokens were recorded.
- Frontend and source commit / Amplify job ID are populated after the release. Event mode remains `registration`.
