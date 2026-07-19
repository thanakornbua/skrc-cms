# Full-stack competition dry run

This runbook exercises the real browser UI, Cognito authentication, registration
API, competition API, DynamoDB state machine, and gate-event ingestion. The gate
simulator acts as `esp32-lane1`; it uses the same payload, device clock, retry,
deduplication, and API-key contract as the Arduino/ESP32 firmware.

Do not use real participant personal data. Perform the rehearsal in the intended
dry-run environment and reset its records before accepting production entries.

## Readiness

- `roster.csv` passes `npm run bootstrap-staff -- ../roster.csv --validate-only`.
- Admin and committee test accounts can sign in and have changed temporary passwords.
- `competitive.skrc.suankularb.space` points to the built frontend.
- `api.suankularb.space` responds to `GET /health` and allows the frontend origin.
- Backend `LANES` maps lane `1` to `esp32-lane1`.
- Backend `DEVICE_KEYS` contains the simulator's device key.
- One disposable competitor email is available for the registration journey.
- Browsers are open on the competitor portal, admin lanes, staff timing, and public
  scoreboard so each transition can be observed end to end.

Keep the device key in the shell environment, not in command history:

```bash
cd ops
read -rsp "Simulator device key: " SIM_DEVICE_KEY
export SIM_DEVICE_KEY
export SIM_API_URL=https://api.suankularb.space
```

## Happy-path rehearsal

1. In `/staff/timing`, admin sets minimum and maximum time for the category and
   creates the approved penalty rules. Use a window that contains the simulated
   duration; for example, `5.000 s` minimum and `20.000 s` maximum.
2. In `/register`, create the disposable competitor account and submit the team.
   Confirm that no payment step appears.
3. In `/committee/approvals`, approve the registration. Record the generated
   competitor number shown in the competitor portal.
4. In `/admin`, search for that team, check it in, and print-preview the QR badge.
5. In `/committee/scan`, scan or type the competitor number and mark it inspected.
6. In `/admin/lanes`, assign the competitor number to lane `1`, then arm it. Confirm
   the card changes `IDLE → ASSIGNED → ARMED` and the competitor portal follows.
7. From `ops/`, act as the Arduino/ESP32:

   ```bash
   npm run simulate-gates -- run --device esp32-lane1 --lane 1 --duration 8000 --checkpoints 2
   ```

8. While it runs, observe `/admin/lanes` change `ARMED → RUNNING → IDLE`. Confirm
   the portal shows the completed attempt and `/staff/timing` shows the same raw
   elapsed time. The expected simulator time is printed after STOP.
9. Repeat assignment, arming, and simulation until the configured number of
   qualifying attempts exists. Confirm the best-two average, penalties, final time,
   and time-based rank agree on the portal, timing screen, and scoreboard.
10. Apply one penalty in `/staff/timing`; confirm it adds time and therefore can move
    the team down the ranking. Revoke it as admin and confirm the original result.

## Device and state-machine checks

Run each check only after putting the lane in the state named in the expectation.

| Check | Action | Expected result |
| --- | --- | --- |
| Duplicate event | `npm run simulate-gates -- send START --dup` on an armed lane | First event accepted; replay returns `accepted=false`, `reason=duplicate` |
| Unarmed START | Send START while lane is IDLE | Event is audited but returns `accepted=false`, `reason=invalid_state` |
| Under minimum | Arm, then run with a duration below the configured minimum | Run becomes `UNDER_REVIEW`; admin must consume/void/correct it |
| Missed STOP | Arm and send only START, then wait beyond the snapshotted maximum | Sweeper marks `TIMED_OUT`, consumes the attempt, lane returns to IDLE |
| Bad device key | Run once with a deliberately wrong key | HTTP 401; no lane transition |
| Device reboot | `npm run simulate-gates -- reboot` | Boot counter increments and subsequent event IDs remain unique |
| Admin reset | Reset a RUNNING lane from `/admin/lanes` | In-flight run becomes `VOID`; lane returns to IDLE |

## Result freeze and recovery

1. Resolve every `UNDER_REVIEW` run and confirm penalties, corrections, and DQ state.
2. In `/staff/timing`, type the explicit confirmation and conclude the competition.
3. Confirm `/scoreboard` displays final results and new competitive mutations are rejected.
4. Reopen once during the rehearsal; confirm the frozen snapshot is removed and the
   competition accepts operations again. Conclude again only after rechecking results.

## Evidence to retain

- Timestamp, operator, environment, frontend/backend build identifiers.
- Screenshots of the armed lane, completed run, portal result, and scoreboard.
- Simulator output for happy path, duplicate, under-minimum, and bad-key checks.
- Any discrepancy with the competitor number, expected device elapsed time, API
  response, and UI state where it occurred.

Do not retain participant passwords, Cognito tokens, device keys, or unnecessary
personal data in the evidence. Rehearsal data follows the same six-month maximum
retention policy and should be deleted sooner when no longer needed.
