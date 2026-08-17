# API Contract

> **Time-only change control (2026-07-20):** Registration omits `slipKey` and
> `/slip-upload-url` is removed. Score/point-demerit fields and routes are retired;
> the timing, correction, penalty, and ranking contract below is authoritative.

Two separate HTTP services, both against the same DynamoDB table (`robo-compet`, see SCHEMA.md), both verifying the same Cognito ID tokens with the same shared auth module (built in Phase 2, imported by both).

- **Always-on registration and staff Lambda** — base URL is the frontend's `VITE_REGWEEK_API_URL` env var (see ENV.md). It serves registration during the registration era and staff competitor management in every event mode.
- **EC2 API** — base URL `VITE_API_BASE_URL`. Skeleton built in Phase 2, routes added Phases 4–11. Live only during the `competition` era.

Competition workflow routes remain on the EC2 service and are called only in competition mode. Staff competitor-record management always calls the Lambda, so it remains available when the EC2 host is stopped. In `concluded` mode, public results are read from the static `results.json` bundled with the build (Phase 11).

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
    "school": "optional string", "certificateLanguage": "THAI"|"ENGLISH"|"BILINGUAL",
    "advisorNameThai": "optional string", "advisorNameEnglish": "optional string",
    "advisorEmail": "optional advisor@example.com", "advisorPhone": "optional string",
    "student1NameThai": "string", "student1NameEnglish": "string",
    "contactEmail": "leader@example.com", "contactPhone": "string",
    "student2NameThai": "optional string", "student2NameEnglish": "optional string",
    "student3NameThai": "optional string", "student3NameEnglish": "optional string",
    "student1FoodAllergy": "NONE or details", "student2FoodAllergy": "optional: NONE or details", "student3FoodAllergy": "optional: NONE or details",
    "pdpaConsent": true, "pdpaAuthorityConfirmed": true
  }
  ```
  `teamName` is the public competition identity; category must be configured. A team has 1–3 members, in accordance with Rules 1.2(3) and 2.2. Member 1 is required and is the team leader/correspondence contact; Members 2–3 are optional, contiguous members. Every listed member must provide Thai and English names and explicitly declare `NONE` or their food-allergy details. School/affiliation and advisor are optional so unaffiliated entrants and adults remain eligible under Rule 2.1; when any advisor field is supplied, the complete bilingual name, email, and phone record is required. A supplied school can be selected from the official `school68.xlsx` catalogue or entered as free text. The standalone bilingual notice is shown before authentication or registration fields. `pdpaConsent` and `pdpaAuthorityConfirmed` must explicitly be `true`; the server records the policy version, language, consent time, authority declaration, and six-calendar-month deletion deadline. Registration is free.
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
- **Response 200:** `{ "items": [registration review records] }`. Each protected staff record includes every applicant-supplied team, school, advisor, contact, student name, food-allergy and certificate field; derived `memberCount`; the complete recorded PDPA consent metadata; status, account `sub`, and `createdAt`. Empty Student 2/3 fields mean those optional members are not part of the team. This PII response is never public.

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

### `GET /staff/competitors?category=&status=&q=`
- **Role:** committee (admin passes).
- **Availability:** every event mode.
- **Response 200:** `{ "canEdit": boolean, "items": [...] }`. Returns the complete competitor list by default; `q` matches competitor number, team, school, or any member name. Category and workflow status are optional filters.

### `GET /staff/competitors/:id`
- **Role:** committee (admin passes).
- **Response 200:** `{ "competitor": {...}, "activity": [...] }`. The protected detail contains all team, 1–3 member, allergy, advisor, contact, certificate, PDPA, and workflow fields. Activity contains approval, edits, password-reset requests, check-in, inspection, and disqualification events. Staff actor identifiers are returned to admins only.

### `PATCH /staff/competitors/:id`
- **Role:** admin only.
- **Request:** all editable registration-profile fields, plus `expectedUpdatedAt` and a required `reason`.
- **Behavior:** a DynamoDB transaction updates both the Competitor profile and its source Registration, and writes an immutable field-level activity record. `expectedUpdatedAt` provides optimistic concurrency.
- **Errors:** `409 CONFLICT` when another administrator changed the record first; `400 VALIDATION_ERROR` for an incomplete member/advisor group or other invalid profile field.

### `POST /staff/competitors/:id/reset-password`
- **Role:** admin only.
- **Behavior:** asks Cognito to deliver its normal reset code and writes an audit event; the application never handles or stores password material.

### Admin user management

These routes are admin-only and manage Cognito accounts for every role
(`competitor`, `committee`, and `admin`). Path identifiers are URL-encoded
Cognito `sub` values.

- `GET /admin/users` returns `{users,currentUserSub}`. Users include identity
  attributes, role, optional competitor ID, Cognito status, access state, and
  creation/last-modified timestamps.
- `POST /admin/users` accepts
  `{email,name,role,competitorId?,temporaryPassword}`. Temporary passwords must
  follow the 12-character Cognito password policy and change at first sign-in.
- `PATCH /admin/users/:sub` accepts
  `{email,name,role,competitorId?,enabled}`. An admin cannot disable or remove
  the admin role from their own account, and the last enabled admin cannot be
  disabled or demoted.
- `POST /admin/users/:sub/reset-password` starts Cognito's verified-email reset
  flow. No password or reset code is returned by the API.

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
  During competition mode the response also includes `weightInspections`, with staff attribution removed from this self-or-staff summary. The dedicated committee inspection route retains the inspector audit field.
  Arrays/fields populated by later phases are present and empty/null until those phases exist — do not change this shape then; only start filling it in. `lane` (added in Phase 6) is `{ "laneId": "1", "state": "ASSIGNED"|"ARMED"|"RUNNING" }` while the competitor occupies a non-IDLE lane, else `null` — it is what drives portal steps 5–6 (Lane assigned / Timer armed).
- **Errors:** `403 FORBIDDEN` competitor requesting another competitor's ID. `404 NOT_FOUND`.

#### `GET /admin/competitors?category=&status=&q=`
- **Role:** staff.
- **Response 200:** `{ "items": [ { competitorId, name, teamName, category, status, disqualified.bool } ] }` — via GSI1, `q` is a client-applied substring filter on name/team (simple `contains`, no full-text search).

> **Competitor numbers.** Every `:id` path parameter is normalised to the
> canonical `C-0042` form before any handler runs (`backend/src/competitorId.ts`,
> installed via `router.param`). Operators may type digits only, and badge
> scanners send the full printed `C-0042`; both resolve to the same key, as do
> `c-14` and `C-14`. Bodies carrying a competitor number use the shared
> `competitorIdSchema`.

#### `POST /admin/competitors/:id/check-in`
- **Role:** committee (admin passes as a superset). Rule 8.1(1) places check-in
  under general staff authority, and 8.1(2)'s admin-reserved list excludes it.
  The path keeps its `/admin` prefix for compatibility with deployed clients.
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

#### `POST /committee/competitors/:id/weight-inspections`
- **Role:** committee (admin passes).
- **Request:** `{ "inspectionId":"uuid", "stage":"CHECK_IN"|"PRE_COMPETITION"|"ROUND_1"|"BEST_OF_4"|"BEST_OF_2"|"THE_BEST", "weightGrams":2500, "dimensionResult":"PASS"|"FAIL", "voltageResult":"PASS"|"FAIL", "notes":"optional" }`.
  Inspection repeats before every round per Rule 3.7(1), not once per event.
  **Neither the weight verdict nor the overall verdict is accepted from the
  client.** The server derives `weightResult` by comparing `weightGrams` against
  Rule 3.2's 4000 g limit (recorded as `weightLimitGrams`), and `result` is PASS
  only when weight, dimension (Rule 3.1) and voltage (Rule 3.3) all pass — so an
  over-weight robot cannot be recorded as passing. Dimension and voltage remain
  inspector judgements, since neither is measurable by the system.
- **Response 200:** `{ inspection, status, inspectedAt, duplicate }`. A passed pre-competition inspection advances to `INSPECTED` only when a passed check-in inspection exists.
- **Errors:** `409 NOT_CHECKED_IN` before check-in; `409 CHECK_IN_INSPECTION_REQUIRED` when the pre-competition stage is attempted without a passed first weigh-in; `404 NOT_FOUND`.

#### `GET /committee/competitors/:id/weight-inspections`
- **Role:** committee (admin passes).
- **Response 200:** `{ "inspections": [...] }`, in measurement-time order. Staff attribution is retained in this protected response.

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

#### `POST /device/lane-state`, `POST /device/heartbeat`
- **Role:** configured device key. Used by the normal-UNO laptop bridge to map a single sensor edge to START or STOP and publish serial health.
- Device timestamps still originate at the Arduino (`millis()`); the heartbeat never participates in elapsed-time calculation.

#### `GET /admin/hardware`
- **Role:** staff.
- **Response 200:** configured device status with `online=true` only when a connected heartbeat is less than 30 seconds old.

### Phase 9 — timing, corrections, and penalties

- `GET /admin/config/categories` (admin): `{categories:[{category,minTimeMs,maxTimeMs,stageMaxTimeMs,stageMaxAttempts}]}`.
- `PUT /admin/config/categories` (admin): `{category,minTimeMs,stageMaxTimeMs,stageMaxAttempts}`; requires
  positive integer milliseconds, `minTimeMs` below every stage maximum, and exactly three attempts per round/match as fixed by Rules 4.2, 4.5, and 6.2.
- `GET /admin/config/penalties` (committee/admin): returns the penalty-rule catalog so committee can apply a configured rule.
- `POST /admin/config/penalties` (admin): `{label,penaltyMs,kind?:"INTERVENTION"}`. At
  most a labeling convenience except for `kind:"INTERVENTION"`, which flags this rule
  as Rule 7.3's unauthorized-intervention penalty — see `/committee/.../penalties`
  below for what that flag does.
- `PUT /admin/config/penalties/:ruleId` (admin): `{label,penaltyMs,active,kind?}`;
  omitting `kind` clears it, so a caller preserving `INTERVENTION` must resend it.
- `POST /committee/competitors/:id/penalties` (committee/admin): `{ruleId,runId?}`;
  snapshots the current label/duration. `runId` should be the competitor's
  currently in-flight run when the applied rule has `kind:"INTERVENTION"` — Rule
  7.3(2)-(3) counts interventions per attempt: the first two against the same
  `runId` are ordinary time penalties, and the third auto-ends that run (attempt
  consumed, stage max time charged — never voided) via the same mechanism as a
  missed STOP. `runId` is ignored for any rule without that `kind`.
- `POST /admin/competitors/:id/penalties/:penaltySk/revoke` (admin): `{reason}`.
- `POST /admin/competitors/:id/runs/:runId/resolve` (admin):
  `{decision:"consume"|"void",reason}` for an `UNDER_REVIEW` run.
- `POST /admin/competitors/:id/runs/:runId/correct` (admin): `{elapsedMs,reason}` for
  an `UNDER_REVIEW` or `TIMED_OUT` run; time must be inside snapshotted limits.
  Admin-only per Rule 8.5(1), which reserves official time correction to
  ผู้ดูแลระบบ specifically — committee cannot call this even though it can void.
- `POST /committee/competitors/:id/end-run` (**committee/admin**):
  `{resolution,reason}` where `resolution` is one of `STALLED`, `FORFEIT`,
  `GRACE_EXPIRED`, `NO_SHOW`, `OFFICIAL_STOP`, `RESTART_LIMIT`. Ends the
  competitor's current attempt at the stage maximum and **consumes** it — the
  opposite of `/void`, which refunds. This is the single action behind every
  rule that ends a run without a STOP: Rule 5.3(6) fourth restart, 5.4(1)-(3)
  stall/forfeit, 5.1(2) official stop, 8.4(4) expired grace period, and 6.1(3)
  a team that never presented. If a run is in flight it is ended in place; if
  the robot was never released, a run is synthesized already `TIMED_OUT` so the
  no-show is ranked last per Rule 6.4(2) rather than being absent from the
  standings. A no-show is explicitly **not** a disqualification: the team keeps
  any time it had already set. Returns `409 CONFLICT` if the attempts for the
  stage are already spent, if a run is `UNDER_REVIEW`, or if the in-flight run
  resolved (e.g. a STOP landed) before the write.
- `POST /admin/competitors/:id/runs/:runId/void` (**committee/admin**): `{reason}`;
  administrative void (Rule 5.5 — "เจ้าหน้าที่" broadly, not admin-only) of any
  finished run in the active stage — `COMPLETE`, `TIMED_OUT`, `INVALID`, or
  `UNDER_REVIEW` — not just ones already flagged for review. This is also the
  "delete" action: official records are never hard-deleted (Rule 8.5(2)/10.2), so
  deleting a run means voiding it, keeping the record in the audit trail. A voided
  run never consumes an attempt (STATES.md §4). Idempotent on an already-`VOID`
  run (returns success, no further write) so a committee void and a later admin
  `/redo` never race into a spurious conflict. Rejects a corrected or in-flight
  (still-`RUNNING`) run with `409 CONFLICT`.
- `POST /admin/competitors/:id/runs/:runId/redo` (**admin only**): `{laneId,reason}`;
  voids the run (a no-op if committee already voided it) then assigns and arms
  `laneId` for the same competitor in one call. Deliberately admin-only — voiding
  is a committee-level call, but only an admin may actually grant the team a new
  attempt. Fails with the same errors as `/void`, or with `assign`/`arm`'s own
  `409 CONFLICT` if the lane wasn't free (the run stays voided either way; retry
  the lane step manually from `/admin/lanes`).
- `GET /competitors/:id` includes `penalties`, `aggregateTimeMs`, `penaltyTimeMs`,
  `finalTimeMs`, and run correction/review data (including `reviewReason`, but not
  staff attribution, consistent with this route's no-attribution rule). It contains
  no score fields.

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
- Freezes the active result and advances the internal stages `ROUND_1 → BEST_OF_4 → BEST_OF_2 → THE_BEST`, displayed publicly as Qualifying → Quarterfinals → Semifinals → Finals.
- After qualifying, the top eight are selected and then randomly assigned to eight bracket positions once, without regard to qualifying rank. The draw timestamp and staff actor are retained internally; only the timestamp, team names, positions, matches, start order, adjusted times, and winners are public.
- Quarterfinal winners populate the semifinals. Semifinal winners populate the final and semifinal losers populate the third-place match. Active, under-review, or fewer than three consumed attempts block advancement.

#### `POST /admin/competition/conclude`
- **Role:** admin only.
- **Request:** `{ "confirm": "CONCLUDE" }` (exact string required — a safety check, not real security).
- Allowed only during Finals. Settles the final and third-place matches, then computes 1st–4th from those match winners/losers and 5th–8th from the quarterfinal results.
- **Errors:** `400 VALIDATION_ERROR` wrong confirm string. `409 CONFLICT` already concluded.

#### `POST /admin/competition/reopen`
- **Role:** admin only.
- **Response 200:** `{ "phase": "OPEN" }`. Deletes the ranking snapshot.

#### `GET /admin/competition/export`
- **Role:** admin only.
- **Preconditions:** `409 CONFLICT` if not yet concluded.
- **Response 200:** `{categories,brackets}` with best-two-of-three averages, round penalties, final times, and the public bracket; no competitor ID/contact/staff data.

#### `GET /public/scoreboard?category=`
- **Role:** none (unauthenticated).
- **Response 200:** `{state:"PROVISIONAL"|"FINAL",activeStage,categories:[...],brackets:[...]}`. Brackets contain only public team names, draw time, positions, matches, random start-order assignment, adjusted times, status, and winners.

All mutation endpoints return `409 COMPETITION_CONCLUDED` after conclusion, except `reopen`.
