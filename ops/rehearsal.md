# End-to-end rehearsal

Use disposable identities only. Complete `DRY_RUN.md`, then retain this evidence without
tokens, passwords, device keys, or participant data.

1. Record UTC timestamp, operator, Git commit, frontend build ID, and backend image ID.
2. Run `npm run build` in `backend`, `frontend`, and `ops`.
3. Configure two disposable lanes and arm one inspected competitor on each.
4. Export `STRESS_LANES` as a JSON array of two lane/device/key entries and run
   `npm run stress-gates`; retain its single PASS line.
5. Complete the clean run, timeout/correction, under-minimum resolution,
   applied/revoked penalty, DQ, conclusion, reopen, and reconclusion journeys in
   `DRY_RUN.md`. Verify every value by hand.
6. Export final `results.json`, build with `VITE_EVENT_MODE=concluded`, stop the API,
   and verify the public scoreboard still renders identical FINAL standings.
7. Run `npm run purge-pii` in preview mode and record the printed six-month deadline.
   Do not execute the purge during rehearsal.
