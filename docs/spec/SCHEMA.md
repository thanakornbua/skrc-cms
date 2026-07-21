# DynamoDB Schema

Single table, single-table design. Created by `ops/create-table.ts`.

- **Table name:** `robo-compet` (D5)
- **Region:** `ap-southeast-7` (D5)
- **Billing mode:** `PAY_PER_REQUEST` (on-demand, D5)
- **Primary key:** `PK` (partition, string), `SK` (sort, string) — both on every item.
- **GSI1:** partition `GSI1PK` (string), sort `GSI1SK` (string). Used for admin/committee lists, the pending-approval queue, and ranking scans. Projection: `ALL`.

No other tables, no other indexes. If a phase seems to need a new GSI or a second table, STOP and flag for human review — do not add one.

## Entities

| Entity | PK | SK | Key attributes |
|---|---|---|---|
| Registration | `REG#<cognitoSub>` | `PROFILE` | `teamName`, `category`, `student1NameThai`, `student1NameEnglish` (student 1 is team leader/correspondent), equivalent Thai/English fields for students 2–3, `contactEmail`, `contactPhone`, `pdpaConsent` (`accepted`, `version`, `at`, `retentionMonths`, `deleteBy`, `authorityConfirmed`, `language`), status/review fields, and `createdAt`. Registration is free; no payment/slip attributes. |
| Competitor | `COMP#<competitorId>` | `PROFILE` | Created at approval by copying the team, student, contact, PDPA consent, category, and `cognitoSub` fields; plus flow status, disqualification, check-in/inspection timestamps, and `createdAt`. |
| ID counter | `CONFIG#COUNTER` | `COMPETITORID` | `value` (number) — incremented only via an atomic DynamoDB `ADD` update inside the approve route. This is the **only** source of new `competitorId`s anywhere in the system. |
| Email notification ledger | `NOTIFY#<cognitoSub>` | `REGISTRATION_RECEIVED` \| `REGISTRATION_APPROVED` | Async delivery state via Cloudflare Email Sending (`PROCESSING`, `FAILED`, or `ACCEPTED`), attempt count, destination, provider message ID, timestamps, and `expiresAt`. Stream records for these items are ignored by the worker; TTL follows the registration's PDPA deletion date. |
| Category config | `CONFIG#CATEGORY#<cat>` | `PROFILE` | integer `minTimeMs`, `stageMaxTimeMs` map (`ROUND_1`, `BEST_OF_4`, `BEST_OF_2`, `THE_BEST`), legacy `maxTimeMs` fallback, `updatedAt`, `updatedBy` |
| Penalty rule | `CONFIG#PENALTY#<ruleId>` | `PROFILE` | `ruleId`, `label`, integer `penaltyMs`, `active`, `updatedAt`, `updatedBy` |
| Competition state | `CONFIG#COMPETITION` | `STATE` | `phase` (`OPEN`\|`CONCLUDED`), `activeStage`, `eligibleCompetitorIds`, immutable-on-advance `stageResults`, final `results`, and conclusion/update audit fields |
| Lane | `LANE#<laneId>` | `STATE` | `state` (`IDLE`\|`ASSIGNED`\|`ARMED`\|`RUNNING`), `competitorId`, `deviceId`, `armedBy`, `updatedAt` |
| Gate event (audit) | `LANE#<laneId>` | `EVT#<deviceTs>#<eventId>` | `eventId`, `type` (`START`\|`CHECKPOINT`\|`STOP`), `gateId`, `deviceTs`, `receivedAt`. Every well-formed event is written here, whether accepted or rejected downstream. |
| Gate-event claim | `EVENT#<eventId>` | `CLAIM` | `eventId`, `deviceId`, `laneId`, `deviceTs`, `receivedAt`. Written atomically with the Gate-event audit item on first receipt; its conditional creation enforces global `eventId` deduplication even if a replay mutates its lane or timestamp (D19). |
| Run | `COMP#<competitorId>` | `RUN#<runId>` | snapshotted `stage`, device timestamps, raw `elapsedMs`, splits, snapshotted `minTimeMs`/`maxTimeMs`, status/review metadata, `createdAt`. Legacy unstaged runs are Round 1. |
| Time correction | `COMP#<competitorId>` | `CORRECTION#<runId>` | `runId`, valid integer `elapsedMs`, mandatory `reason`, `byUser`, `at`; original Run is never overwritten |
| Applied penalty | `COMP#<competitorId>` | `PENALTY#<isoTs>#<ruleId>` | snapshotted `stage`, `ruleId`, `label`, `penaltyMs`, `byUser`, `at`, optional `revocation` `{reason,byUser,at}` |
| Password-reset audit | `COMP#<competitorId>` | `AUDIT#PASSWORD_RESET#<isoTs>` | `type`, `byUser`, `at`, `deleteBy`; records only that an admin requested Cognito delivery and contains no password or reset code |
| Ranking snapshot | `RANKING#<category>` | `RANK#<zero-padded n>` or `DQ#<competitorId>` | internal `competitorId`, `teamName`, `aggregateTimeMs`, `penaltyTimeMs`, `finalTimeMs`, qualifying run IDs |

Runs, corrections, and penalties are evaluated only in their snapshotted stage.
Protected stage snapshots retain competitor numbers for advancement; public responses
and final exports strip them.

## GSI1 usage

- Every Competitor item additionally carries `GSI1PK = "COMPETITOR"`, `GSI1SK = "<category>#<status>#<competitorId>"` — powers `GET /admin/competitors?category=&status=&q=` and the ranking-computation scan in Phase 11.
- Every Registration item additionally carries `GSI1PK = "REGISTRATION"`, `GSI1SK = "<status>#<createdAt>"` — powers `GET /pending` (query `GSI1PK = REGISTRATION`, filter/begins_with on status prefix).

## Cross-cutting rules

- `competitorId` (short, human-readable, e.g. `C-0042` — zero-padded sequence from the counter with a `C-` prefix) is **the single cross-system key**: QR/barcode payload, lane assignment, run records, ranking records. It does not exist until Registration approval.
- Portal login is always by email via Cognito. The Cognito ID token carries `custom:competitorId` once approval has stamped it onto the user; before approval, that claim is absent.
- **No password material of any kind is stored in this table.** Cognito owns all credentials. There is no "staff user" item — staff exist only as Cognito users in the `committee` / `admin` groups.
- Every `byUser` attribute anywhere in the schema stores the **Cognito username** (the staff member's or the system's identifier for who took the action) — never a raw sub unless that's the only identifier available.
- Do not rename any entity, attribute, or key pattern above, and do not add a GSI2 or a second table without stopping to flag it for human review.
- A first-seen gate event creates its Gate-event claim and lane audit item in one
  transaction before state evaluation. A failed claim means `duplicate`; neither
  item may be created without the other.
