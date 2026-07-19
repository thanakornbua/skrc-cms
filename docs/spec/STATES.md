# State Machines

Three independent state machines. None of them may gain a new state or transition without stopping to flag it for human review.

## 1. Registration.status

```
PENDING_APPROVAL ──approve──> APPROVED
PENDING_APPROVAL ──reject──>  REJECTED
REJECTED         ──approve──> APPROVED
```

- There is no self-service resubmission; a staff member may approve a rejected registration after resolution. Registration is free and has no payment/slip state.
- `APPROVED` is terminal — a Registration never leaves `APPROVED`.
- Approving (from either `PENDING_APPROVAL` or `REJECTED`) is the **only** event that mints a `competitorId` (via the atomic counter) and creates the corresponding Competitor item. The Competitor entity does not exist before its Registration is approved.
- Approve is idempotent: calling it twice on an already-`APPROVED` registration must return the existing result (same `competitorId`, no second counter increment, no second Competitor item).

## 2. Competitor.status

```
REGISTERED ──check-in──> CHECKED_IN ──inspect──> INSPECTED ──(first completed run)──> RUN_COMPLETE
```

- Strictly forward-only. There is no transition back to an earlier status.
- `RUN_COMPLETE` is set the moment the competitor's **first** `Run` reaches `status = COMPLETE` (Phase 7). Subsequent runs (2nd, 3rd attempt) do not change `status` further — it stays `RUN_COMPLETE`.
- `disqualified` (`{bool, reason, byUser, at}`) is an **independent flag**, not a status value. It can be set at any point regardless of the competitor's current `status`, and it never itself advances or reverts `status`. A disqualified competitor is excluded from ranking (Phase 11) and rejected at lane assignment (Phase 6), but their `status` field keeps recording flow progress normally.
- Competition conclusion (`OPEN → CONCLUDED`) is **global** state (`CONFIG#COMPETITION`), not a per-competitor status.

Valid actions per status (who / what is required before the action is accepted):

| Action | Requires status | Sets |
|---|---|---|
| Check-in | `REGISTERED` | → `CHECKED_IN`, `checkedInAt` |
| Inspect | `CHECKED_IN` (or later) | → `INSPECTED`, `inspectedAt` |
| Lane assignment | `INSPECTED` (or later), not disqualified | (no status change; lane state changes) |
| First completed run | any (already inspected/assigned to reach this point) | → `RUN_COMPLETE` |

Check-in and inspect are each idempotent: repeating the call on a competitor already at or past that status returns the current state with a notice rather than erroring or reverting.

## 3. Lane.state

```
IDLE ──assign (scan)──> ASSIGNED ──arm (admin)──> ARMED ──START event──> RUNNING ──STOP event / timeout / admin reset──> IDLE
```

- `assign`: requires the target competitor to be `INSPECTED` (or later status) and not disqualified, and not already occupying another lane whose state is not `IDLE`. `IDLE → ASSIGNED`.
- `arm`: only valid from `ASSIGNED`. `ASSIGNED → ARMED`, records `armedBy`.
- `reset`: valid from **any** state, always returns the lane to `IDLE`. If the lane was `RUNNING`, resetting voids the in-flight Run (`status → VOID`).
- Gate events (from Phase 7's `POST /gate-events`) are evaluated against lane state:
  - `ARMED` accepts a `START` event only → transitions to `RUNNING`, opens a new `Run` item with `startDeviceTs`.
  - `RUNNING` accepts `CHECKPOINT` and `STOP` events only. A STOP within snapshotted bounds produces `COMPLETE`; below minimum produces `UNDER_REVIEW`; either returns the lane to `IDLE`.
  - Any gate event received while the lane is in any other state (or of a type not valid for the current state) is still written to the Gate-event audit item, but is otherwise ignored (`{accepted:false, reason:"invalid_state"}` per the Phase 7 API contract) — it causes no state change.
- A timeout sweeper (Phase 7) may force `RUNNING → IDLE` (via `Run.status = TIMED_OUT`) after D10's window elapses with no `STOP`.

## 4. Run review and attempt accounting

- `COMPLETE`, `TIMED_OUT`, and `INVALID` consume one attempt. `VOID` does not.
- `UNDER_REVIEW` blocks lane assignment until an admin resolves it to `INVALID` or
  `VOID`, or attaches a valid correction. A correction keeps the same attempt.
- A corrected run qualifies using the correction time; raw device data remains unchanged.
- Three consumed attempts blocks further lane assignment.
