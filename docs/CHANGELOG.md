# CHANGELOG — Historical Fixes

This file contains the full root-cause analysis and fix history for the health sync system.
Moved from MEMORY.md on 2026-03-24 during restructure. Agents do NOT need to load this file
every session — it's a reference for debugging regressions.

---

## Critical Fixes Applied (2026-03-21)

### Issue 1: Duplicate Prevention
**Root Cause:** `normalize_health_log.js` and `unified_sync.js` used different entry key generation methods.
**Fix:** Both now use `sha256(timestamp|user|title)` for consistent sync_state tracking.
**Commits:** `1526afb`, `3a9e79c`

### Issue 2: Timestamp Accuracy
**Root Cause:** Photos uploaded at one time were logged with different timestamps.
**Fix:** Photo file timestamps now correctly mapped to meal entry timestamps.
**Example:** March 20 dinner photos (6:45 PM, 7:00 PM) vs incorrectly logged as March 21 (1:45 AM, 2:00 AM).
**Commit:** `c6cea64`, `cab03ed`

### Issue 3: Predictions Not in Database Columns
**Root Cause:** Predictions were only in entry titles, not Notion database columns.
**Fix:** Added script to parse `Pred: XX-XX mg/dL @ HH:MM AM/PM` from titles and populate `Predicted Peak BG` and `Predicted Peak Time` columns.
**Commit:** `362bccd`, `3a9e79c`

### Issue 4: Gallery Missing Recent Entries
**Root Cause:** Date range filter in gallery HTML was backwards (data is descending order).
**Fix:** Fixed date range calculation; added `generate_notion_gallery.js` to auto-generate gallery JSON.
**Commit:** `3a9e79c`

### Issue 5: BG Data Unavailable in Responses
**Root Cause:** Food log session used plaintext secret "JaviCare2026" instead of SHA1 hash.
**Fix:** Created `scripts/fetch_bg.js` with correct secret; documented SHA1 format in MEMORY.md.
**Commit:** `192fccd`, `2e65967`

## Critical Fixes Applied (2026-03-22)

### Issue 6: Projections Not Matching Channel Values
**Root Cause:** `radial_dispatcher.js` and `calculate_notion_projections.js` overwrote Notion "Predicted Peak BG" with `120 + carbs*3.5` formula, ignoring the agent's context-aware prediction in the health_log.md title e.g. `(Pred: 175-200 mg/dL @ 5:30-6:00 PM)`.
**Fix:** Added `parsePredFromText()` to both scripts. Reads upper bound of BG range and midpoint of time window from title. Falls back to formula only when no `(Pred: ...)` is present.
**Commit:** `056f45b`

### Issue 7: Duplicate Notion Entries When Title Changes — PERMANENTLY FIXED
**Root Cause:** Entry key = `sha256(timestamp|user|title)`. Each title edit changed the key -> sync created a NEW Notion page instead of updating the existing one.
**Permanent Fix (2026-03-22):** `radial_dispatcher.js` now queries Notion by `Date + User` (not title). Finds existing page regardless of title changes, updates in-place. Also auto-archives any duplicates found during sync.
**Commit:** `699fcb7`
**Note:** sync_state.json orphaned keys still need manual cleanup after title changes (run validate_sync.js to identify them).

## Critical Fixes Applied (2026-03-22, Round 2 — Opus 4.6 audit)

### Issue 9: Entry Key Divergence Between Scripts — FIXED
**Root Cause:** `radial_dispatcher.js` used `iso|user|category|mealType|cleanText`; `unified_sync.js` used `timestamp|user|title`. Different hashes for same entry -> cross-script NS duplicates.
**Fix:** `radial_dispatcher.js` now uses `normalizeEntryTitle()` (strips BG/Pred/protein/carbs, lowercases) matching `normalize_health_log.js`. Key: `iso|user|normalizedTitle` — identical across all scripts.
**Commit:** `865e15c`

### Issue 10: Peak Time Timezone Missing in calculate_notion_projections.js — FIXED
**Root Cause:** `parsePredFromText` received only `YYYY-MM-DD`; produced offset-less ISO -> Notion treated as UTC -> displayed time off by 7-8h.
**Fix:** Full ISO date string passed; offset extracted and appended.
**Commit:** `865e15c`

### Issue 11: No Projection Fallback in unified_sync.js — FIXED
**Root Cause:** Missing `(Pred: ...)` annotation -> predicted peak BG/time omitted from Notion entirely.
**Fix:** Falls back to `120 + carbs*3.5` / `mealTime + 105min`.
**Commit:** `865e15c`

### Issue 12: Protein Decimal Parsing — FIXED
**Root Cause:** `radial_dispatcher.js` used `\d+` / `parseInt` -> missed values like `25.5g`.
**Fix:** `[\d.]+` / `parseFloat`.
**Commit:** `865e15c`

### Issue 13: Stale Photo Alert Spam — FIXED
**Root Cause:** `check_pending_photos.js` re-alerted every 30 min indefinitely for unresolved photos.
**Fix:** `data/pending_photo_alert_state.json` tracks last alert per entry; re-alerts suppressed for 2 hours.
**Commit:** `865e15c`

## GitHub Backup (2026-03-22)
All of `~/.openclaw/` and related projects are now versioned on GitHub under `javordlab` (all private). Global git config: `Javier Ordonez <ordonez@gmail.com>`. 27 repos total.

## Critical Fixes Applied (2026-03-22, Round 3)

### Issue 14: Pipe-Split Bug in radial_dispatcher — FIXED (commit `d135004`)
**Root Cause:** Nutrition format `(Protein: 18g | Carbs: ~45g | Cals: ~340)` embeds pipe characters inside the entry text column. Fixed-index parsing (`p[7]` for carbs, `p[8]` for cals) broke when these pipes shifted column indices. Result: `carbs: null`, truncated notes, photos not sent to Notion, `proteins: null` in MySQL.
**Fix:** Use last-two columns as carbs/cals (`p[p.length-3]`, `p[p.length-2]`); join all middle columns as entry text (`p.slice(6, carbsIdx).join(' | ')`). Protein extracted via regex `/\(Protein:\s*([\d.]+)g[^)]*\)/i` (note `[^)]*` to handle embedded pipes before closing paren).
**Impact:** ALL downstream systems affected — Nightscout carbs, Notion photo field, MySQL proteins, gallery.

### Issue 15: Nightscout Timestamp Fallback Broken — FIXED (commit `d135004`)
**Root Cause:** `find[created_at]=2026-03-22T19:24:00-07:00` rejected by Nightscout with "Cannot parse - as a valid ISO-8601 date". Both timezone-offset and UTC exact-match formats fail with the `find[field]=value` syntax.
**Fix:** Use `$gte`/`$lte` +/-1-minute UTC range. The Nightscout API supports range operators but not exact-match on ISO dates.
**Rule:** Never use `find[created_at]=<value>` in Nightscout queries. Always use range operators with UTC timestamps.

### Issue 16: Radial Dispatcher Creating Duplicates for Old Entries — FIXED (commit `d135004`)
**Root Cause:** Dispatcher processed ALL 178 entries on every run. Old entries without matching `entry_key` in NS notes failed both key-lookup and (broken) timestamp-fallback -> POSTed as new duplicate treatments every 30 minutes.
**Fix:** Added 30-day rolling cutoff. Only today's entries + last 30 days processed per run.

### Issue 17: Corrupted Nightscout Treatment After Pipe-Split Bug
**Pattern:** Pipe-split bug created Nightscout entry with `carbs: null` and truncated notes. After pipe-split fix, `normalizeEntryTitle()` strips the full `(Protein:...)` block -> new entry key differs from the one stored in NS -> key-lookup fails -> entry stays corrupted indefinitely.
**Fix procedure:** DELETE the corrupted NS treatment by `_id`; dispatcher will POST a fresh correct one on next run.
**Lesson:** When entry key generation logic changes, old NS entries become invisible to new key-lookups. Must delete-and-recreate.

### Issue 18: check_pending_photos.js Removed
**Why removed:** (a) Nutrition estimation is always the agent's job — Maria must never be asked for macros. (b) State file not written if Telegram API returned `!ok` on first run -> duplicate alerts.
**Status:** Script deleted, cron job `stale-pending-photo-alert` removed from `jobs.json`.

### Issue 19: HealthGuard Persona — Nutrition Always from Vision
**Change:** `health-guard.md` updated. Agent always estimates carbs, cals, and protein using vision. Maria is never prompted for macros.

### Issue 20: Gallery Now Event-Driven
**Change:** Gallery regeneration triggered only when `photoSyncedToNotion = true`. Previously ran on hourly cron regardless.

### Issue 21: MySQL proteins Column Added
**Change:** `ALTER TABLE maria_health_log ADD COLUMN proteins decimal(5,1) NULL AFTER calories_est`.

### Issue 22: Quality Gates — Protein Required for ALL Food
**Change:** `quality_gates.js` now requires protein for all Food category entries. Error code: `missing_protein_required_for_food`.

## Critical Fixes Applied (2026-03-23)

### Issue 23: Daily Report TIR/Stats Used Rolling Count Instead of Calendar Day — FIXED (commit `29262c2`)
**Root Cause:** `refresh_glucose_data.js` fetched `count=300` with no date filter for the "24h" window. At 9:30 AM report time, this bled into the prior evening's data, producing incorrect TIR, average, GMI, std dev, CV. Also had no `api-secret` header on NS requests.
**Fix:** Use exact PDT midnight-to-midnight epoch bounds (`$gte`/`$lte`). Auto-detect PDT/PST offset. Add `api-secret` header.
**Rule:** Never use `count=N` as a proxy for a time window. Always use explicit timestamp bounds.

### Issue 24: auto_track_meds.js — Rosuvastatin Cycle, Missing Metformin, Timezone — FIXED (commit `0af111e`)
**Root Cause (3 bugs):**
1. Rosuvastatin used `dayOfMonth % 2 !== 0` instead of anchor-based cycle.
2. Metformin entirely unimplemented (TODO comment only).
3. Timezone functions used UTC / hardcoded offsets.
**Fix:** Anchor-based Rosuvastatin cycle (2026-03-01 = day 0, even days), implemented all 3 Metformin doses with idempotent check, host-system timezone throughout.

## Sync-State + Cron Infrastructure Audit (2026-06-10)

### Issue 25: Daily false-positive "Sync Audit Gap" alert (~98% noise) — FIXED (commit `621f2a6ee`)
**Root Cause:** `sync_state.json` is keyed by content-hash `entry_key`. Normal edits (title rewrites, "(cont.)" merges, retro-timestamps) move an entry to a new key while its NS/Notion IDs stay on the old record. `audit_health_sync.js` used direct key lookups + a global (un-windowed) `page_id` collision scan, so ~264 benign drift pairs re-alerted every 9:10 AM.
**Fix:** New `consolidate_sync_state_drift.js` sweep merged 478 stale siblings (2262→1777 records, 1:1 with SSoT). Audit made drift-robust (resolve IDs via (ts,user,category) siblings; collision only flagged across different (ts,user)); `--lookback=N` finally parsed (was silently ignored → 7-day default); Sleep exempted from NS check; alert sent as plain text (Markdown mangled underscores). Restored 7 wrongly-archived Notion pages + recreated 1 snack page; deleted 1 phantom NS treatment.

### Issue 26: cron watchdog staleness check was unreachable dead code — FIXED (commit `0e1f2c39b`)
**Root Cause:** `cron_health_watchdog.js` computed `nextRunAtMs` from `now()` (always future) and early-returned "healthy" on it, so the staleness branch never executed. No silently-stopped job was ever flagged.
**Fix:** Rekeyed on age-since-last-heartbeat vs `staleMaxMs` + one interval; interval derived from two future cron ticks. `sendAlert` `.ok` now checked (it resolves `{ok:false}`, never rejects) with plain-text retry.

### Issue 27: two cron jobs dead 49 days (missing `cd` prefix) — FIXED (commit `0e1f2c39b`)
**Root Cause:** `rescue_pending_photos` + `probe_launchd_jobs` crontab lines lacked the `cd workspace &&` prefix → `MODULE_NOT_FOUND` from `$HOME` every 5/20 min since ~Apr 22; masked by Issue 26. Failed photo uploads weren't retried; the dashboard was blind to all launchd jobs.
**Fix:** Added `cd` prefixes (crontab backed up); rescued the 4 aged-out photos via `RESCUE_MAX_AGE_HOURS`; `probe_launchd_jobs` now judges live KeepAlive daemons by `state=running`+pid, not the prior incarnation's exit code.

### Issue 28: pipeline validation gate permanently red, sync silently skipped — FIXED (commit `0e1f2c39b`)
**Root Cause:** `MEAL_TYPE_PREFIX_REGEX` rejected the agent's real titles ("Lunch (cont.):", "Pre-sleep snack (…):") → validation hard-aborted before Unified Sync, then exited 0 ("ok" heartbeat). 1,111 silent aborts.
**Fix:** Relaxed regex to allow qualifiers; aborted pipeline now writes an `error` receipt + exits 1. Added `rotate_cron_logs.sh` (cron_health.log had reached 668 MB).

## Program Audit — 47 Findings (2026-06-11)

Companion sweep across ~40 scripts (4 parallel reviewers, all findings verified). Commit `0a7c3dfe2`.

### Issue 29: dead CGM sensor / NS outage silently disabled low-glucose alerting — FIXED (P0)
**Root Cause:** `glucose_low_alert.js` evaluated `entries[0].sgv` without checking the reading's age — a dead sensor reported "BG fine" off a 6-hour-old value. A persistent NS outage returned a `warn` receipt (dashboard-only; watchdog pages on `error` only).
**Fix:** Staleness gate (>20 min old → "CGM DATA STALE" group alert, BG not evaluated); NS-outage escalation (3 consecutive failures → Telegram + `error` receipt); skip-path `lastBg` persistence; corrupt-state age-out.

### Issue 30: consistency_check.js was vacuous since inception — FIXED (P0)
**Root Cause:** `` `${date}T${time}:00` `` on offset-bearing time cells ("19:00 +02:00") produced `Invalid Date` → every row skipped → "PASS" on an empty set. No pre-2026-06-11 "consistency check passed" meant anything.
**Fix:** Parse offsets, render all three sources through one host-TZ key, encode category semantics (Sleep≠NS, Exercise≈Activity, Medication/BG Check/Sensor→NS Note). First honest run caught a real missing Notion page.

### Issue 31: Row Id reconciler archived LIVE Notion pages — FIXED (P0)
**Root Cause:** `radial_dispatcher.js` reconciler judged orphans against a single run-start read of `health_log.md`; concurrent whole-file writers (bridge, meds tracker, photo publisher) made live rows momentarily invisible → ~20 live pages archived May 23–Jun 7. The post-Jun-3 skip-gate then never recreated them.
**Fix:** Sanity brake (rowIds vs window pages), fresh SSoT re-read sparing, two-strike pending file (`data/row_id_archive_pending.json`) before any archive, archive-PATCH error checks.

### Issue 32: radial skip-gate ignored category — FIXED
**Root Cause:** The "already fully synced" filter matched `(timestamp, user)` only, so same-minute siblings of different categories (19:00 Metformin + 19:00 snack) permanently masked each other.
**Fix:** Filter now includes category. Also: Notion query/create/patch responses checked (a failed query no longer routes into create → dupes), `notion_errors` folded into receipt totals, drift-aware `knownTreatmentId`, single local-calendar 7-day cutoff, entry-key fallback uses normalize's own `parseRow`/`buildEntryKey` (old local recompute lowercased → never matched).

### Issue 33: report_watchdog fallback was dead code; bridge swallowed errors — FIXED
**Root Cause:** `report_watchdog.js` ran at 8:57 but its deadline required ≥9:32 → never fired (dead since Apr 13); fallback also couldn't chunk >4096-char reports. `bridge.js` resolved claude-CLI `is_error` JSON as a successful reply (error text sent to Maria, fallback chain skipped); committed the poll offset before processing so `process.exit(2)` dropped queued messages; never checked Telegram `ok:false`.
**Fix:** Watchdog cron 8:57→9:35; fallback chunks + only marks sent on delivery. Bridge: error-JSON triggers fallback chain, durable inbox journal, `ok:false` checks + 429 retry, photo-download status/timeout, SIGKILL escalation, atomic state writes.

### Issue 34: MySQL paths — silent truncation, mass-delete, failed backups — FIXED
**Root Cause:** `mysql_glucose_sync.js` reported NS outages as "Caught up — 0 new rows"; `sync_ssot_to_mysql.js` had no brake on mass soft-delete; `backfill_meal_outcomes.js` sent UPDATEs as one abort-on-first-error batch (May-26 freeze pattern) with dead `partial` logic; `mysql_backup.sh` (no `pipefail`) produced "Completed" empty `.gz` files that rotated away good backups within 7 days.
**Fix:** Outage→error; empty-SSoT abort + mass-delete cap; chunk-then-row-by-row UPDATEs; `pipefail` + size check; utf8mb4 charset on raw mysql calls.

### Issue 35: dead scripts + parity contract — FIXED
**Root Cause:** `photo_link_watchdog.js` watched a feed dead since March; `retry_pending_photo_uploads.js` + `process_missed_text_messages.js` were orphaned; `record_write_to_ledger.js` stripMetadata diverged from normalize's (every Coach entry a false "phantom"); unit tests appended fixtures to the production ledger; `validate_log_integrity.js` false-alarmed off a March baseline.
**Fix:** Removed the 3 dead scripts; aligned the entry-key strip (now a THREE-copy contract — change one, change all); env-overridable test ledger (production fixtures purged); integrity validator rebased + absolute paths. Notion gallery no longer overwrites+deploys empty data on API failure.

## Sync Path Consolidation (2026-06-12)

### Issue 36: dual redundant syncers (unified_sync + radial_dispatcher) — CONSOLIDATED (commit pending)
**Root Cause:** Two independent code paths synced health_log.md → Nightscout + Notion: the pipeline's Unified Sync step (`:00/:30`) and `radial_dispatcher.js` (`:05/:35` + bridge + post-edit chain). They were NOT equal — radial is a strict superset: it additionally writes Notion Meal Assessment + Sleep stage columns, stamps Row Ids, runs the orphan reconciler, injects BG/projections, regenerates the gallery, and covers wider windows (7d Notion / 30d NS vs unified's 2d). unified-only behaviors (Date time_zone, syncGallery, validateEntry, NS protein) were all verified covered elsewhere (radial's gallery regen, the pipeline's separate Validate step, cosmetic/no-consumer fields).
**Fix:** Removed the Unified Sync step from `health_sync_pipeline.js` — radial_dispatcher is now the sole syncer. Pipeline retains photo resolution + normalize + enrich + validate (now ~7s, was ~58s). `unified_sync.js` kept on disk for manual use; its only other caller (`trigger_post_log_sync` via the dead `photo_to_log_pipeline.js`) is itself dead. Verified: radial covers all entries (1725 skipped / 19 NS re-writes / 10s), no functional gap.
