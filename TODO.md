# TODO - Stability + Reliability Backlog

## Reconciled status (2026-03-23)

### 1) Immediate sync on new Food/Medication/Activity post (in addition to cron)
- [x] Add post-log sync trigger after successful `health_log.md` write+readback verification. *(implemented as file-change immediate trigger script: `scripts/health-sync/trigger_post_log_sync.js`, invoked by 1m photo pipeline cron)*
- [x] Keep existing async cron sync (`Radial Sync (30m)`) as fallback safety net.
- [x] Debounce/coalesce triggers (e.g., 30-90s window) to avoid duplicate sync bursts. *(45s debounce in `trigger_post_log_sync.js`)*
- [x] Add idempotency checks so immediate + cron sync cannot create duplicates. *(entry_key + safe NS upsert parity path)*
- [x] Add telemetry line in logs: `trigger=manual_post_log|cron`. *(manual trigger logged in `data/post_log_sync.log.jsonl`)*
- [ ] **Temporary safeguard:** enforce per-user minimum 2-minute spacing between logged events to avoid NS fallback timestamp collisions.
- [ ] On collision, shift new event timestamp to `last_event + 2m` and keep original message time in note (`Msg time: ...`) for audit.
- [ ] Mark this as stopgap to remove after strict key-based Nightscout matching fix is deployed.
- [x] Add automatic retry of `queued` immediate sync when `sync.lock` clears (without requiring a second external trigger). *(implemented in `trigger_post_log_sync.js` via lock wait/poll with timeout)*

### 2) Missing photo URL in Notion for Telegram image posts
- [x] Ensure Telegram media messages always produce a durable photo URL for log rows.
- [x] If image tool fails (e.g., `Unsupported media type: document`), route through photo pipeline fallback.
- [x] Fallback policy: use pipeline-created public URL (`iili.io/...`) instead of Telegram message URL when Telegram payload is `document`.
- [x] Add handoff step: before finalizing Food row, check pending photo queue by message/file prefix and inject `[📷](public_url)`.
- [x] Guarantee `[📷](...)` link insertion in `health_log.md` before sync when a valid photo exists.
- [x] Add validation gate: Food entry came from image message but `photoUrls.length===0` => warning/error.
- [x] Add regression test for Telegram image-as-document payloads.

### 3) Verification / observability
- [x] Add watchdog check: recent Telegram Food image message IDs must map to Notion entries with `Photo` URL.
- [ ] Daily audit output should include `missing_photo_link_count` and list entry keys.

### 4) Telegram content-type decision table (routing)
- [x] Implement normalized content classifier: `TEXT`, `PHOTO`, `PHOTO_TEXT`, `IMAGE_DOCUMENT`, `DOCUMENT_NON_IMAGE`, `VOICE`, `VIDEO`, `UNSUPPORTED_MEDIA`, `COMPOSITE_EVENT`.
- [x] Detect `IMAGE_DOCUMENT` via `document.mime_type` (`image/*`) and/or file extension; do not treat as generic document.
- [ ] Route `VOICE`/audio payloads through STT first, then intent parser (food/med/activity/question).
- [ ] Correlate adjacent messages (photo + text within short window) into one composite event before logging.
- [ ] Enforce write contract for all actionable types: write + readback before success confirmation.

### 5) Upload-failure resilience (photo exists locally)
- [x] If public upload fails, preserve local media reference (`filePrefix`, local path, message_id, timestamp) and queue retry.
- [x] Mark state explicitly as `upload_failed_pending_retry` (fail-open for capture, fail-closed for completion claim).
- [x] For food-from-photo rows, insert pending marker (`[📷](pending:...)`) or hold completion per strict mode.
- [x] Block/flag complete Notion sync for food-photo rows lacking resolved public photo URL.
- [x] Retry uploads with backoff schedule (e.g., 1m, 5m, 15m, 1h), then alert after max retries.
- [x] On later upload success, patch `health_log.md` row with real URL and re-upsert Notion/Nightscout.

### 6) Improvements: timezone handling (remove hardcoded Los Angeles)
- [ ] Replace hardcoded `America/Los_Angeles` usage with system timezone detection at runtime.
- [ ] Standardize timezone source in one utility (single `getSystemTimezone()` + offset helper) and reuse across scripts.
- [ ] Ensure reports, log writes, sync timestamps, cron displays, and prediction windows all use detected system timezone consistently.
- [ ] Add explicit override env var (e.g., `HEALTH_TZ`) for travel/manual control, defaulting to system timezone.
- [ ] Add regression tests for timezone change scenario (e.g., LA -> Europe) to verify date boundaries and report windows remain correct.

## New completion note
- [x] Nightscout parity hardening completed via shared upsert path:
  - `scripts/health-sync/ns_identity.js`
  - `scripts/health-sync/ns_upsert_safe.js`
  - wired in both `scripts/health-sync/unified_sync.js` and `scripts/radial_dispatcher.js`
  - shared telemetry counters: `fallback_match_count`, `ambiguous_match_count`, `duplicate_key_conflict_count`, `verify_fail_count`
- [x] Immediate post-log sync trigger dry validation completed:
  - `scripts/health-sync/trigger_post_log_sync.js` returns expected states (`debounced`, `queued` on lock)
  - telemetry confirmed in `data/post_log_sync.log.jsonl`
  - lock-aware fail-safe behavior confirmed with active `data/sync.lock`
- [x] Lock-clear auto-retry behavior implemented in trigger:
  - queued trigger now waits/polls for lock release (`POST_LOG_SYNC_LOCK_WAIT_MS`, `POST_LOG_SYNC_LOCK_POLL_MS`)
  - if lock clears within wait window, sync runs in same invocation (no second trigger required)
  - timeout path returns `sync_lock_present_timeout`
