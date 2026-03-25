# Daily Health Sync Ops Report

- Window: 2026-03-23T17:55:18.163Z → 2026-03-24T17:55:18.163Z
- Generated: 2026-03-24T17:55:18.184Z

## Summary
- Immediate sync attempts (manual_post_log): 413
- Immediate sync successes: 2
- Immediate sync queued due to lock: 408
- Immediate sync errors: 0
- Sync lock currently present: NO
- Sync lock age (minutes): n/a
- NS fallback matches: 5
- NS ambiguous conflicts: 0
- NS duplicate-key conflicts: 0
- Validation blocked entries: 284
- Missing photo links (watchdog): 0
- Pending photo queue (total): 0
- Pending photo retries unresolved: 0
- Pending nutrition metadata items: 0
- Open backlog items (TODO unchecked): 13

## Resolved yesterday
- Immediate sync successes: 2
- NS fallback auto-resolutions applied: 5
- NS duplicate-key conflicts auto-cleaned: 0

## Still pending
- Pending photo retries unresolved: 0
- Pending nutrition metadata items: 0
- Validation warnings currently present: 42
- Backlog items still open (top):
  - **Temporary safeguard:** enforce per-user minimum 2-minute spacing between logged events to avoid NS fallback timestamp collisions.
  - On collision, shift new event timestamp to `last_event + 2m` and keep original message time in note (`Msg time: ...`) for audit.
  - Mark this as stopgap to remove after strict key-based Nightscout matching fix is deployed.
  - Daily audit output should include `missing_photo_link_count` and list entry keys.
  - Schedule daily cron execution for `send_daily_ops_email_report.js --email --to=<recipient>`.
  - Route `VOICE`/audio payloads through STT first, then intent parser (food/med/activity/question).
  - Correlate adjacent messages (photo + text within short window) into one composite event before logging.
  - Enforce write contract for all actionable types: write + readback before success confirmation.

## Needs manual action
- Review 284 blocked entries (quality gate failures).

## Top blocked validation reasons
- missing_protein_required_for_food: 284

## Key issue details
- [entry_blocked] sha256:7c24b1a3277bcdda1500b396f3700b2f7a4cc9cc89648cbd39bdf4dfc52faeb3 :: missing_protein_required_for_food
- [entry_blocked] sha256:2894309535e49081570aa3acc9b5806f3a871426e37f1f0932aa3f96bb8e4372 :: missing_protein_required_for_food
- [entry_blocked] sha256:8b7e4b9b9aaa66cbea3fe4896408c11e0d51100c569efd678915affbf326b57a :: missing_protein_required_for_food
- [entry_blocked] sha256:394ca775253da5cb3dccd7ff9b2cfed7f1085750c9ded42e7e9cbb9f25901548 :: missing_protein_required_for_food
- [entry_blocked] sha256:76c1222e9d904ebc593ef205469da84b890ebd64d3a2b88f4df4f76e3390228f :: missing_protein_required_for_food
- [entry_blocked] sha256:0e3cf46dec455abba24ea9d39fac4e17c0b422b51e28172360d7b271adc5c1ff :: missing_protein_required_for_food
- [entry_blocked] sha256:11ffe4e23dd63a7fbff237f7591cb00ab26099b7616b219c4765725a27e4e4a0 :: missing_protein_required_for_food
- [entry_blocked] sha256:82d85dd85af381acfb7bffa7ed2aed9af9cf0dc18e5f2140645453216671ef5f :: missing_protein_required_for_food

