# MEMORY.md — Long-Term Memory

## People
### Javier Ordonez (Javi)
- **Timezone:** America/Los_Angeles
- **Contact:** ordonez@gmail.com | Telegram: 8335333215
- **Notes:** Technical, precise, prefers honesty and directness.

### Maria Dennis
- **Details:** 73yo, 139 lbs, 5'0". Type 2 Diabetes (FreeStyle Libre 3).
- **Meds:** Metformin (500mg breakfast, 500mg lunch, 1000mg dinner), Lisinopril (10mg daily morning), Rosuvastatin (10mg every other morning).
- **Rosuvastatin Cycle:** Anchor date 2026-03-01 (taken).

## Communication Channels
- **Email (AgentMail):** `javordclaw@agentmail.to`
  - **API Key:** Stored in `~/.openclaw/secrets/agentmail_api_key`.
  - **Protocol:** Use this account for automated notifications and to send information to Javi (ordonez@gmail.com) upon request.
  - **Skills:** `agentmail` skill (Python SDK in `.venv_agentmail`, scripts in `skills/agentmail/scripts/`).
- **Web Search (Brave Search):**
  - **API Key:** `BSAS4Bs1x3W5uCLR6tQMLq3NAXxRi6o` (from `openclaw.json`).
  - **Protocol:** Use `curl` to call `https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header for real-time web information.

## Core Operational Protocols
- **Radial Architecture:** `health_log.md` is the only SSoT. All syncs (Notion, Nightscout, MySQL) must trigger every 30 minutes and after any manual log update.
- **Reporting (9:30 AM PT Daily):** Must include 24-hour summary (Avg, TIR, GMI), 14-day trends (GMI, Avg, TIR, CV), Nutrition (24h full + 14d avg), Medication status, Outliers, and Supervisor Analysis. Use emojis/bolding.
- **Projections & Outcomes:** Every Food entry MUST have `Predicted Peak BG` and `Predicted Peak Time` calculated immediately upon logging. After meal completion (~3 hours), automatically backfill actual outcomes: `Pre-Meal BG`, `2hr Peak BG`, `Peak Time`, `BG Delta`, `Time to Peak (min)`, `Peak BG Delta`, and `Peak Time Delta (min)`. Automated backfill runs every 2 hours via cron.
- **Silent Logging:** Food, Medication, and Exercise entries are auto-logged immediately without confirmation. Photos are optional — log the entry either way.
- **Real-time Context:** Every manual log entry (Food, Medication, Activity) MUST include the most recent glucose value from Nightscout in the response and the log note.
- **Data Integrity:** All dashboard data and visual charts must be pushed to GitHub at the end of every sync cycle.
- **STRICT DATA RULE — NEVER EYEBALL:** When reporting any numerical values (glucose, carbs, calories, TIR, GMI, etc.), **NEVER estimate or eyeball**. Always:
  1. Execute the calculation scripts (`scripts/calculate_glucose_summary.js`, `scripts/calculate_14d_stats.js`)
  2. Use the EXACT output values in reports
  3. Do not round or approximate unless the script already does
  4. Never invent numbers — if data is missing, state "Data unavailable" instead of guessing

## Model Configuration (Updated 2026-03-21)

### Default Runtime Chain (OpenClaw)
| Priority | Model |
|----------|-------|
| Primary | `ollama/kimi-k2.5:cloud` |
| Fallback #1 | `google-gemini-cli/gemini-3-flash-preview` |
| Fallback #2 | `ollama/qwen2.5-coder:7b` |

### Escalation Policy (Manual)
| Trigger | Escalate To |
|---------|-------------|
| Routine sync / dashboards / CRUD | Keep `ollama/kimi-k2.5:cloud` |
| Cross-system mismatch after first fix | `google-gemini-cli/gemini-3-flash-preview` |
| Persistent high-risk bug (idempotency, dedupe, data integrity) | `openai-codex/gpt-5.3-codex` |

### Verification Rule (Mandatory)
- Never mark incidents as fixed without live verification against target systems (Notion UI/API, Nightscout API, deployed dashboard JSON/HTML).

## Infrastructure
- **Nightscout:** https://p01--sefi--s66fclg7g2lm.code.run (Secret: JaviCare2026)
  - **API Secret (SHA1 hash):** `b3170e23f45df7738434cd8be9cd79d86a6d0f01` (Use this for API calls)
- **Photos:** https://javordlab.github.io/nightscout-meal-photos/

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

## CI/CD Pipeline
- Pre-commit hooks validate sync state (0 duplicates allowed)
- Unit tests for entry key generation
- Integration tests with mock APIs
- All changes must pass validation before production deploy
**Commit:** `61b0dfa`

## Model Usage Reference (OpenAI shared traffic)
- OpenAI shared free daily token tiers:
  - **250K/day**: gpt-5.4, gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5, gpt-5-codex, gpt-5-chat-latest, gpt-4.1, gpt-4o, o1, o3.
  - **2.5M/day**: gpt-5.1-codex-mini, gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, o1-mini, o3-mini, o4-mini, codex-mini-latest.
- Important correction from Javi: this second tier is **2.5M** (not 2M).

## Critical Fixes Applied (2026-03-22)

### Issue 6: Projections Not Matching Channel Values
**Root Cause:** `radial_dispatcher.js` and `calculate_notion_projections.js` overwrote Notion "Predicted Peak BG" with `120 + carbs×3.5` formula, ignoring the agent's context-aware prediction in the health_log.md title e.g. `(Pred: 175-200 mg/dL @ 5:30-6:00 PM)`.
**Fix:** Added `parsePredFromText()` to both scripts. Reads upper bound of BG range and midpoint of time window from title. Falls back to formula only when no `(Pred: ...)` is present.
**Commit:** `056f45b`

### Issue 7: Duplicate Notion Entries When Title Changes — PERMANENTLY FIXED
**Root Cause:** Entry key = `sha256(timestamp|user|title)`. Each title edit changed the key → sync created a NEW Notion page instead of updating the existing one.
**Permanent Fix (2026-03-22):** `radial_dispatcher.js` now queries Notion by `Date + User` (not title). Finds existing page regardless of title changes, updates in-place. Also auto-archives any duplicates found during sync.
**Commit:** `699fcb7`
**Note:** sync_state.json orphaned keys still need manual cleanup after title changes (run validate_sync.js to identify them).

## Critical Fixes Applied (2026-03-22, Round 2 — Opus 4.6 audit)

### Issue 9: Entry Key Divergence Between Scripts — FIXED
**Root Cause:** `radial_dispatcher.js` used `iso|user|category|mealType|cleanText`; `unified_sync.js` used `timestamp|user|title`. Different hashes for same entry → cross-script NS duplicates.
**Fix:** `radial_dispatcher.js` now uses `normalizeEntryTitle()` (strips BG/Pred/protein/carbs, lowercases) matching `normalize_health_log.js`. Key: `iso|user|normalizedTitle` — identical across all scripts.
**Commit:** `865e15c`

### Issue 10: Peak Time Timezone Missing in calculate_notion_projections.js — FIXED
**Root Cause:** `parsePredFromText` received only `YYYY-MM-DD`; produced offset-less ISO → Notion treated as UTC → displayed time off by 7–8h.
**Fix:** Full ISO date string passed; offset extracted and appended.
**Commit:** `865e15c`

### Issue 11: No Projection Fallback in unified_sync.js — FIXED
**Root Cause:** Missing `(Pred: ...)` annotation → predicted peak BG/time omitted from Notion entirely.
**Fix:** Falls back to `120 + carbs×3.5` / `mealTime + 105min`.
**Commit:** `865e15c`

### Issue 12: Protein Decimal Parsing — FIXED
**Root Cause:** `radial_dispatcher.js` used `\d+` / `parseInt` → missed values like `25.5g`.
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
**Fix:** Use `$gte`/`$lte` ±1-minute UTC range: `find[created_at][$gte]=...&find[created_at][$lte]=...`. The Nightscout API supports range operators but not exact-match on ISO dates.
**Rule:** Never use `find[created_at]=<value>` in Nightscout queries. Always use range operators with UTC timestamps.

### Issue 16: Radial Dispatcher Creating Duplicates for Old Entries — FIXED (commit `d135004`)
**Root Cause:** Dispatcher processed ALL 178 entries on every run. Old entries without matching `entry_key` in NS notes failed both key-lookup and (broken) timestamp-fallback → POSTed as new duplicate treatments every 30 minutes.
**Fix:** Added 30-day rolling cutoff. Only today's entries + last 30 days processed per run.

### Issue 17: Corrupted Nightscout Treatment After Pipe-Split Bug
**Pattern:** Pipe-split bug created Nightscout entry with `carbs: null` and truncated notes (text cut at first pipe). After pipe-split fix, `normalizeEntryTitle()` strips the full `(Protein:...)` block → new entry key differs from the one stored in NS → key-lookup fails → timestamp fallback also fails → entry stays corrupted indefinitely.
**Fix procedure:** DELETE the corrupted NS treatment by `_id`; dispatcher will POST a fresh correct one on next run.
**Lesson:** When entry key generation logic changes (normalization rules updated), old NS entries become invisible to new key-lookups. Must delete-and-recreate, not patch.

### Issue 18: check_pending_photos.js Removed
**Why removed:** (a) Nutrition estimation is always the agent's job — Maria must never be asked for macros. Alert was therefore moot. (b) State file not written if Telegram API returned `!ok` on first run → duplicate alerts 30 min apart.
**Status:** Script deleted, cron job `stale-pending-photo-alert` removed from `jobs.json`.

### Issue 19: HealthGuard Persona — Nutrition Always from Vision
**Change:** `health-guard.md` updated. Old: agent could ask Maria for nutrition details if entry looked incomplete. New: agent **always** estimates carbs, cals, and protein using vision. Maria is never prompted for macros.

### Issue 20: Gallery Now Event-Driven
**Change:** Gallery regeneration (`generate_notion_gallery_data.js` + git push) now triggered only when `photoSyncedToNotion = true` (a new/changed photo URL was written to Notion). Previously ran on hourly cron regardless.

### Issue 21: MySQL proteins Column Added
**Change:** `ALTER TABLE maria_health_log ADD COLUMN proteins decimal(5,1) NULL AFTER calories_est`. Required for radial_dispatcher to sync protein values to MySQL.

### Issue 22: Quality Gates — Protein Required for ALL Food (not just Breakfast)
**Change:** `quality_gates.js` now requires protein for all Food category entries. Error code: `missing_protein_required_for_food`. Unit test updated to accept either `missing_protein_required_for_food` or `missing_protein_required_for_breakfast` for compatibility.

## Critical Fixes Applied (2026-03-23)

### Issue 23: Daily Report TIR/Stats Used Rolling Count Instead of Calendar Day — FIXED (commit `29262c2`)
**Root Cause:** `refresh_glucose_data.js` fetched `count=300` with no date filter for the "24h" window. At 9:30 AM report time, this bled into the prior evening's data (e.g. included Mar 21 highs in the Mar 22 report), producing incorrect TIR, average, GMI, std dev, CV. Also had no `api-secret` header on NS requests.
**Fix:** Use exact PDT midnight-to-midnight epoch bounds (`$gte`/`$lte`) for both the previous-day window and the 14-day window. Auto-detect PDT/PST offset. Add `api-secret` header.
**Scope:** Affects ALL stats derived from `glucose_24h.json` and `glucose_14d.json` — TIR, average, GMI, std dev, CV, outliers count.
**Rule:** Never use `count=N` as a proxy for a time window. Always use explicit timestamp bounds.

### Issue 24: auto_track_meds.js — Rosuvastatin Cycle, Missing Metformin, Timezone — FIXED (commit `0af111e`)
**Root Cause (3 bugs):**
1. Rosuvastatin used `dayOfMonth % 2 !== 0` (odd calendar days) instead of anchor-based cycle — diverges at month boundaries (e.g. would wrongly dose on 2026-04-01).
2. Metformin entirely unimplemented — only a TODO comment. All three daily doses missing from automated tracking.
3. `getIsoDate()` used `toISOString()` (UTC date). `getOffset()` hardcoded `-07:00`. `getHours()` returned UTC hours.
**Fix:**
- Rosuvastatin: anchor date 2026-03-01 (taken = day 0), take on even days since anchor (`daysSince % 2 === 0`). Correct through all month boundaries.
- Metformin: 500mg breakfast (log when LA hour ≥ 9), 500mg lunch (≥ 12), 1000mg dinner (≥ 19). Each idempotent — skipped if already in log.
- Timezone: all date/hour/offset derived from `Intl.DateTimeFormat('America/Los_Angeles')`. Auto-detects PDT/PST.
**Metformin schedule:** 09:10 500mg breakfast | 13:00 500mg lunch | 19:00 1000mg dinner.
