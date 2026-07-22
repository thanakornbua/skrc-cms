# API Contract

> **Time-only change control (2026-07-20):** Registration omits `slipKey` and
> `/slip-upload-url` is removed. Score/point-demerit fields and routes are retired;
> the timing, correction, penalty, and ranking contract below is authoritative.

Two separate HTTP services, both against the same DynamoDB table (`robo-compet`, see SCHEMA.md), both verifying the same Cognito ID tokens with the same shared auth module (built in Phase 2, imported by both).

- **Registration-week Lambda** — base URL is the frontend's `VITE_REGWEEK_API_URL` env var (see ENV.md). Built in Phase 3. Live only during the `registration` era.
- **EC2 API** — base URL `VITE_API_BASE_URL`. Skeleton built in Phase 2, routes added Phases 4–11. Live only during the `competition` era.

Never call the wrong service from the wrong era — the frontend switches which base URL it targets via `VITE_EVENT_MODE` (`registration` | `competition` | `concluded`). In `concluded` mode, the frontend calls neither service for results — it reads the static `results.json` bundled with the build (Phase 11).

## Conventions

- **Auth header (both services, all routes except `/health` and `/public/*`):** `Authorization: Bearer <Cognito ID token>`.
- **Device auth (EC2 only, `/gate-events`):** `X-Device-Key: <key>` — no Cognito token involved.
- **Roles**, derived from the verified token: `cognito:groups` contains `admin` → role `admin` (superset of `committee` — an admin token passes every `requireRole('committee')` check); contains `committee` (and not `admin`) → role `committee`; no group → role `competitor`, with `custom:competitorId` (if present) identifying which competitor.
- **Error format**, every non-2xx response, both services:
  ```json
  { "error": { "code": "SOME_CODE", "message": "human-readable explanation" } }
  ```
  Standard codes: `UNAUTHORIZED` (401 — missing/invalid/expired token or device key), `FORBIDDEN` (403 — valid token, wrong role/owner), `NOT_FOUND` (404), `VALIDATION_ERROR` (400 — zod failure, includes a `fields` array of `{field, message}` alongside `error`), `CONFLICT` (409 — state-machine violation, duplicate, or competition concluded), `INTERNAL_ERROR` (500).
- **Idempotency:** any route documented "idempotent" below must return the current/resulting state on a repeat call with the same effect, not error and not double-apply.
- All request/response bodies are JSON. All timestamps in responses are ISO 8601 strings unless noted as device timestamps (`deviceTs`, raw milliseconds from the ESP32's `millis()`).

---

## Registration-week Lambda (Phase 3)

### `POST /register`
- **Role:** competitor **only** — a committee or admin token gets `403 FORBIDDEN` (staff cannot compete, D16).
- **Request:**
  ```json
  {
    "teamName": "string", "category": "string",
    "school": "string", "certificateLanguage": "THAI"|"ENGLISH"|"BILINGUAL",
    "advisorNameThai": "string", "advisorNameEnglish": "string",
    "advisorEmail": "advisor@example.com", "advisorPhone": "string",
    "student1NameThai": "string", "student1NameEnglish": "string",
    "contactEmail": "leader@example.com", "contactPhone": "string",
    "student2NameThai": "string", "student2NameEnglish": "string",
    "student3NameThai": "string", "student3NameEnglish": "string",
    "pdpaConsent": true, "pdpaAuthorityConfirmed": true
  }
  ```
  `teamName` is the public competition identity; category must be configured. The school is selected or completed from the official `school68.xlsx` catalogue, but free-text entry remains supported for a school not yet listed. Advisor and all three student names are required in Thai and English. Student 1 is the team leader and correspondence contact. The standalone bilingual notice is shown before authentication or registration fields. `pdpaConsent` and `pdpaAuthorityConfirmed` must explicitly be `true`; the server records the policy version, language, consent time, authority declaration, and six-calendar-month deletion deadline. Registration is free.
- **Response 201:** `{ "competitorId": null, "status": "PENDING_APPROVAL" }` (no `competitorId` yet — minted at approval).
- **Browser preflight:** `OPTIONS /register` returns an empty `204`; the browser then sends the authenticated `POST`, which returns the `201` above.
- **Email side effect:** after the Registration item is committed, a DynamoDB Stream worker asynchronously sends a bilingual receipt to `contactEmail`. Delivery failure never rolls back registration and is retried independently.
- **Errors:** `403 FORBIDDEN` for staff tokens. `409 CONFLICT` if a Registration already exists for this sub. `400 VALIDATION_ERROR` for invalid fields/category.

### `GET /me`
- **Role:** competitor.
- **Response 200:**
  ```json
  {
    "registration": { "status": "PENDING_APPROVAL", "name": "...", "teamName": "...", "category": "...",
      "rejection": null, "approval": null, "createdAt": "..." },
    "competitor": null
  }
  ```
  Once approved, `competitor` is populated with the same shape as the EC2 `GET /competitors/:id` response body's `competitor` fields (status, checkedInAt, etc. — all still at their initial/empty values this early). If rejected, `registration.rejection = {reason, at}` (no `byUser` shown to the competitor — see Phase 10's attribution rule, applied here too).
- **Errors:** `404 NOT_FOUND` if no Registration exists yet for this sub.

### `GET /pending`
- **Role:** committee (admin passes).
- **Query:** optional `?category=`.
- **Response 200:** `{ "items": [ { "sub": "...", "teamName": "...", "category": "...", "contactPhone": "...", "contactEmail": "...", "createdAt": "..." } ] }`.

### `POST /registrations/:sub/approve`
- **Role:** committee (admin passes).
- **Request:** `{}` (no body needed).
- **Behavior:** conditional update `status: PENDING_APPROVAL|REJECTED → APPROVED`; atomic `ADD` on `CONFIG#COUNTER`; create `COMP#<competitorId>` (status `REGISTERED`); `AdminUpdateUserAttributes` on the Cognito user to stamp `custom:competitorId`. Idempotent: if already `APPROVED`, return the existing result with no further writes.
- **Response 200:** `{ "competitorId": "C-0042", "status": "APPROVED" }`.
- **Email side effect:** the first real transition to `APPROVED` asynchronously sends a bilingual approval email containing the assigned `competitorId`. Idempotent approval retries do not enqueue another email.
- **Errors:** `404 NOT_FOUND` unknown sub.

### `POST /registrations/:sub/reject`
- **Role:** committee (admin passes).
- **Request:** `{ "reason": "string (required, non-empty)" }`.
- **Response 200:** `{ "status": "REJECTED" }`.
- **Errors:** `400 VALIDATION_ERROR` empty/missing reason. `404 NOT_FOUND` unknown sub.

### `GET /export.csv?entity=registrations|competitors`
- **Role:** admin **only** (committee gets 403) — D18.
- **Response 200:** `text/csv` with a header row; one row per Registration or Competitor item (all profile/status columns, no password material — none exists in the table). Intended for committee record-keeping; contains PII, hence admin-only.
- **Errors:** `400 VALIDATION_ERROR` unknown `entity` value. `403 FORBIDDEN` non-admin.
- The same route is added to the EC2 API during Phase 11's export work.

---

## EC2 API

### Phase 2 — health & identity

#### `GET /health`
- **Role:** none (unauthenticated).
- **Response 200:** `{ "status": "ok", "version": "<build info>" }`.

#### `GET /auth/me`
- **Role:** any authenticated user.
- **Response 200:** `{ "sub": "...", "role": "admin"|"committee"|"competitor", "competitorId": "C-0042"|null }`.

### Phase 4 — competitor read, check-in

#### `GET /competitors/:id`
- **Role:** self (competitor whose `custom:competitorId` matches `:id`) or staff (committee/admin).
- **Response 200:**
  ```json
  {
    "competitorId": "C-0042", "name": "...", "teamName": "...", "category": "...",
    "status": "REGISTERED", "checkedInAt": null, "inspectedAt": null,
    "disqualified": { "bool": false, "reason": null, "byUser": null, "at": null },
    "lane": null,
    "penalties": [], "runs": [], "aggregateTimeMs": null, "penaltyTimeMs": 0, "finalTimeMs": null,
    "rank": null
  }
  ```
  Arrays/fields populated by later phases are present and empty/null until those phases exist — do not change this shape then; only start filling it in. `lane` (added in Phase 6) is `{ "laneId": "1", "state": "ASSIGNED"|"ARMED"|"RUNNING" }` while the competitor occupies a non-IDLE lane, else `null` — it is what drives portal steps 5–6 (Lane assigned / Timer armed).
- **Errors:** `403 FORBIDDEN` competitor requesting another competitor's ID. `404 NOT_FOUND`.

#### `GET /admin/competitors?category=&status=&q=`
- **Role:** staff.
- **Response 200:** `{ "items": [ { competitorId, name, teamName, category, status, disqualified.bool } ] }` — via GSI1, `q` is a client-applied substring filter on name/team (simple `contains`, no full-text search).

#### `POST /admin/competitors/:id/check-in`
- **Role:** admin.
- **Request:** `{}`.
- **Response 200:** `{ "status": "CHECKED_IN", "checkedInAt": "..." }`. Idempotent — repeat on already-checked-in returns current state with `"notice": "already checked in"`.
- **Errors:** `404 NOT_FOUND`.

#### `POST /admin/competitors/:id/reset-password`
- **Role:** admin only.
- **Request:** `{}`.
- **Behavior:** starts Cognito's password-recovery flow for the linked competitor
  account. Cognito sends the reset code to the account's verified delivery
  destination; the admin never sees or sets the password. A six-month-retained
  audit item records the admin username and request time.
- **Response 202:** `{ "status": "RESET_CODE_SENT", "requestedAt": "..." }`.
- **Errors:** `404 NOT_FOUND` or `AUTH_USER_NOT_FOUND`; `409 PORTAL_ACCOUNT_UNLINKED`
  or `RESET_DELIVERY_UNAVAILABLE`; `429 RESET_RATE_LIMITED`.

### Phase 5 — inspection

#### `POST /committee/competitors/:id/inspect`
- **Role:** committee (admin passes).
- **Request:** `{}`.
- **Response 200:** `{ "status": "INSPECTED", "inspectedAt": "..." }`. Idempotent on repeat.
- **Errors:** `409 CONFLICT` `{code: "NOT_CHECKED_IN"}` if status is still `REGISTERED`. `404 NOT_FOUND`.

### Phase 6 — lanes

#### `GET /admin/lanes`
- **Role:** staff.
- **Response 200:** `{ "lanes": [ { "laneId": "1", "state": "IDLE", "competitorId": null, "deviceId": null, "armedBy": null, "updatedAt": "..." } ] }`.

#### `POST /admin/lanes/:laneId/assign`
- **Role:** admin.
- **Request:** `{ "competitorId": "C-0042" }`.
- **Response 200:** `{ "laneId": "1", "state": "ASSIGNED", "competitorId": "C-0042" }`.
- **Errors:** `409 CONFLICT` — not `INSPECTED`, disqualified, already assigned elsewhere, or lane not `IDLE`. `404 NOT_FOUND` unknown competitor/lane.

#### `POST /admin/lanes/:laneId/arm`
- **Role:** admin.
- **Request:** `{}`.
- **Response 200:** `{ "laneId": "1", "state": "ARMED", "armedBy": "..." }`.
- **Errors:** `409 CONFLICT` lane not `ASSIGNED`.

#### `POST /admin/lanes/:laneId/reset`
- **Role:** admin.
- **Request:** `{}`.
- **Response 200:** `{ "laneId": "1", "state": "IDLE" }`. If a Run was in flight, it is marked `VOID`.

### Phase 7 — timer ingestion (device auth, not Cognito)

#### `POST /gate-events`
- **Role:** device (`X-Device-Key` header, matched against `DEVICE_KEYS` env map by `deviceId` in the body).
- **Request:**
  ```json
  { "eventId": "esp32-lane1-3-00042", "deviceId": "esp32-lane1", "laneId": "1", "gateId": "start", "type": "START", "deviceTs": 1234567 }
  ```
  `type` is one of `START`|`CHECKPOINT`|`STOP`. `deviceTs` is the raw `millis()` value from the device — never server receive-time.
- **Response:** always `200`, body `{ "accepted": true }` or `{ "accepted": false, "reason": "duplicate"|"invalid_state"|"clock_anomaly" }`. See IMPLEMENTATION_PLAN.md Phase 7 for the full processing algorithm (dedup → audit → state validation → debounce → elapsed/split computation).
- **Errors (transport/auth only, firmware retries these):** `401 UNAUTHORIZED` bad/missing device key. `400 VALIDATION_ERROR` malformed body.

### Phase 9 — timing, corrections, and penalties

- `GET /admin/config/categories` (admin): `{categories:[{category,minTimeMs,maxTimeMs,stageMaxTimeMs,stageMaxAttempts}]}`.
- `PUT /admin/config/categories` (admin): `{category,minTimeMs,stageMaxTimeMs,stageMaxAttempts}`; requires
  positive integer milliseconds, `minTimeMs` below every stage maximum, and 1–20 attempts per stage.
- `GET /admin/config/penalties` (committee/admin): returns the penalty-rule catalog so committee can apply a configured rule.
- `POST /admin/config/penalties` (admin): `{label,penaltyMs}`.
- `PUT /admin/config/penalties/:ruleId` (admin): `{label,penaltyMs,active}`.
- `POST /committee/competitors/:id/penalties` (committee/admin): `{ruleId}`; snapshots
  the current label/duration.
- `POST /admin/competitors/:id/penalties/:penaltySk/revoke` (admin): `{reason}`.
- `POST /admin/competitors/:id/runs/:runId/resolve` (admin):
  `{decision:"consume"|"void",reason}` for an `UNDER_REVIEW` run.
- `POST /admin/competitors/:id/runs/:runId/correct` (admin): `{elapsedMs,reason}` for
  an `UNDER_REVIEW` or `TIMED_OUT` run; time must be inside snapshotted limits.
- `GET /competitors/:id` includes `penalties`, `aggregateTimeMs`, `penaltyTimeMs`,
  `finalTimeMs`, and run correction/review data. It contains no score fields.

### Phase 10 — disqualification

#### `POST /committee/competitors/:id/disqualify`
- **Role:** committee (admin passes).
- **Request:** `{ "reason": "string (required, non-empty)" }`.
- **Response 200:** `{ "disqualified": { "bool": true, "reason": "...", "at": "..." } }`. Idempotent.
- **Errors:** `400 VALIDATION_ERROR` empty reason.

#### `POST /admin/competitors/:id/reinstate`
- **Role:** admin only.
- **Request:** `{ "reason": "string (required)" }`.
- **Response 200:** `{ "disqualified": { "bool": false } }`.

### Phase 11 — conclusion & ranking

#### `GET /admin/competition/state`
- **Role:** committee/admin.
- **Response:** `{phase,activeStage,eligibleCompetitorIds}`.

#### `POST /admin/competition/advance`
- **Role:** admin. Body `{ "confirm": "ADVANCE" }`.
- Freezes the active result and advances `ROUND_1 → BEST_OF_4 → BEST_OF_2 → THE_BEST`.
- Top 8, 4, and 2 advance per category. Active or under-review runs block advancement.

#### `POST /admin/competition/conclude`
- **Role:** admin only.
- **Request:** `{ "confirm": "CONCLUDE" }` (exact string required — a safety check, not real security).
- Allowed only during The Best. Computes 1st/2nd from The Best, 3rd/4th from
  Best-of-4 ordering among Best-of-2 eliminations, and 5th–8th from Best of 4.
- **Errors:** `400 VALIDATION_ERROR` wrong confirm string. `409 CONFLICT` already concluded.

#### `POST /admin/competition/reopen`
- **Role:** admin only.
- **Response 200:** `{ "phase": "OPEN" }`. Deletes the ranking snapshot.

#### `GET /admin/competition/export`
- **Role:** admin only.
- **Preconditions:** `409 CONFLICT` if not yet concluded.
- **Response 200:** stage-aware category results with checkpoint/lap or time-average
  fields plus `ranked`, `unranked`, and `disqualified`; no competitor ID/contact data.

#### `GET /public/scoreboard?category=`
- **Role:** none (unauthenticated).
- **Response 200:** `{state:"PROVISIONAL"|"FINAL",activeStage,categories:[...]}` using the same stage-aware public shape as the export.

All mutation endpoints return `409 COMPETITION_CONCLUDED` after conclusion, except `reopen`.
