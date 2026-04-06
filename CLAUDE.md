# CLAUDE.md — Full Context Bootstrap for Claude Code Sessions

> Read this file first. Then read today's + yesterday's `memory/YYYY-MM-DD.md`. Then you're ready.

---

## Who You Are Helping

**Javier Ordonez (Javi)** — engineer, timezone: America/Los_Angeles, Telegram: 8335333215. Technical, precise, prefers directness. Contact: ordonez@gmail.com.

**Maria Dennis** — 73yo, 139 lbs, 5'0". Type 2 Diabetes (FreeStyle Libre 3 CGM). The health system exists for her.
- **Meds:** Metformin 500mg (breakfast), 500mg (lunch), 1000mg (dinner) | Lisinopril 10mg (morning) | Rosuvastatin 10mg (every other morning, anchor date 2026-03-01)

---

## Mandatory Reading Order (Every Session)

```bash
# 1. Operational rules — NON-NEGOTIABLE
cat AGENTS.md

# 2. Long-term facts
cat MEMORY.md

# 3. Recent session history (last 2 days)
cat memory/$(date +%Y-%m-%d).md 2>/dev/null
cat memory/$(date -v-1d +%Y-%m-%d).md 2>/dev/null   # macOS
# or: date -d yesterday +%Y-%m-%d on Linux

# 4. Historical bug fixes (reference only, don't load unless debugging)
cat docs/CHANGELOG.md
```

---

## What This System Does

Fully automated health logging pipeline for Maria:
- **Intake:** Maria sends food/medication/exercise via Telegram → logged to `health_log.md` (SSoT)
- **Prediction:** Peak BG predicted immediately using Model v3 (4-layer formula, see AGENTS.md)
- **Sync:** Every 30 min, `radial_dispatcher.js` pushes to Nightscout + Notion + MySQL
- **Monitoring:** Glucose low alerts every 5 min, daily report at 9:30 AM PT, cron watchdog every 30 min
- **Backfill:** Actual glucose outcomes written ~3h after each meal entry

---

## Architecture

```
Maria's Telegram message
    └── OpenClaw webhook → HealthGuard agent (health-guard)
            ├── Photos: uploaded to freeimage.host in same turn, URL written to health_log.md
            └── Text: food/med/exercise entry written to health_log.md

health_log.md  (SSoT — never edit downstream systems directly)
    └── radial_dispatcher.js (system cron, every 5/35 min)
            ├── Nightscout API  → treatments (food, exercise, notes)
            ├── Notion DB       → 31685ec7-0668-813e-8b9e-c5b4d5d70fa5
            └── MySQL           → local backup

Monitoring:
    ├── mysql_glucose_sync.js     → syncs CGM readings to MySQL (20,50 * * * *)
    ├── glucose_low_alert.js      → alerts if BG < 70 mg/dL (*/5 * * * *)
    ├── send_daily_health_report_telegram.js → 9:30 AM daily report (pure script, no LLM)
    └── cron_health_watchdog.js   → checks all cron jobs for staleness (every 30 min, Haiku)
```

---

## Infrastructure & Credentials

| System | Value |
|--------|-------|
| **Nightscout URL** | `https://p01--sefi--s66fclg7g2lm.code.run` |
| **Nightscout secret** | `JaviCare2026` (human) / `b3170e23f45df7738434cd8be9cd79d86a6d0f01` (SHA1 — use this for API calls) |
| **Notion DB ID** | `31685ec7-0668-813e-8b9e-c5b4d5d70fa5` |
| **Photo hosting** | `https://freeimage.host` — API key: `6d207e02198a847aa98d0a2a901485a5` |
| **Photo gallery** | `https://javordlab.github.io/nightscout-meal-photos/` |
| **Telegram group** | `-5262020908` ("Food log") — Bot: `@Javordclaws_bot` |
| **Email (AgentMail)** | `javordclaw@agentmail.to` — API key in `~/.openclaw/secrets/agentmail_api_key` |
| **GitHub** | `javordlab` (all private, 27 repos) |
| **Node binary** | `/opt/homebrew/bin/node` — ALWAYS use full path in scripts (system cron has no PATH) |
| **Workspace** | `/Users/javier/.openclaw/workspace` |
| **Inbound media** | `/Users/javier/.openclaw/media/inbound/` — all Telegram photos auto-saved here |

---

## Scripts Reference

### Core Pipeline
| Script | Purpose |
|--------|---------|
| `scripts/radial_dispatcher.js` | Master sync: health_log → Nightscout + Notion + MySQL. Run after any manual log change. |
| `scripts/health-sync/health_sync_pipeline.js` | Full pipeline: normalize → resolve photos → sync → gallery |
| `scripts/health-sync/normalize_health_log.js` | Parses health_log.md into structured JSON |
| `scripts/health-sync/ns_upsert_safe.js` | Idempotent Nightscout write with dedup (use this, never raw POST) |
| `scripts/health-sync/sync_state.js` | Entry key management — SHA256-based, never hand-roll keys |
| `scripts/consistency_check.js` | Pre/post-sync validation gate — run before and after major changes |

### Prediction & Analytics
| Script | Purpose |
|--------|---------|
| `scripts/calculate_notion_projections.js` | Peak BG prediction (Model v3, 4-layer formula). Runs in radial sync. |
| `scripts/calculate_glucose_summary.js` | 24h glucose stats — used by daily report. Always use exact output, never eyeball. |
| `scripts/calculate_14d_stats.js` | 14-day trend stats — used by daily report. Same rule. |
| `scripts/backfill_notion_impact.js` | Writes actual outcomes ~3h post-meal (hourly cron) |
| `scripts/refresh_glucose_data.js` | Fetches latest CGM data from Nightscout |

### Monitoring & Alerts
| Script | Purpose |
|--------|---------|
| `scripts/health-sync/glucose_low_alert.js` | Alerts Javi if BG < 70 mg/dL. Runs every 5 min. |
| `scripts/health-sync/cron_health_watchdog.js` | Checks cron job freshness, alerts if stale. Every 30 min. |
| `scripts/health-sync/audit_health_sync.js` | Detects entries missing from Notion or Nightscout. System cron 9:45 AM. |
| `scripts/health-sync/daily_log_review.sh` | Reviews gateway logs via `claude -p` OAuth (Haiku). System cron 9:15 AM. |
| `scripts/health-sync/report_watchdog.js` | Verifies daily report was sent; triggers fallback if not |

### Daily Report
| Script | Purpose |
|--------|---------|
| `scripts/health-sync/send_daily_health_report_telegram.js` | 9:30 AM daily report — pure Node, no LLM |
| `scripts/health-sync/send_daily_charts_telegram.js` | Sends glucose + nutrition charts |
| `scripts/generate_daily_glucose_chart.js` | Generates daily glucose chart PNG |
| `scripts/generate_daily_report.js` | Generates report text from script outputs |

### Data Integrity
| Script | Purpose |
|--------|---------|
| `scripts/health-sync/quality_gates.js` | Blocks malformed entries. Runs pre-write. |
| `scripts/health-sync/confirmation_ledger.js` | Write ledger — guards against fake confirmations in Telegram |
| `scripts/health-sync/validate_health_sync.js` | Full cross-system validation |
| `scripts/validate_log_integrity.js` | Validates health_log.md structure |
| `scripts/health-sync/record_write_to_ledger.js` | PostToolUse hook — records every health_log.md write |

### MySQL / Backup
| Script | Purpose |
|--------|---------|
| `scripts/mysql_glucose_sync.js` | Syncs CGM readings to MySQL. Has 48h age cutoff to prevent runaway pagination. |
| `scripts/sync_notion_to_mysql.js` | Async Notion → MySQL sync (every 4h) |
| `scripts/mysql_backup.sh` | Daily MySQL backup (4:20 AM) |
| `scripts/generate_backup_dashboard_data.js` | Updates backups.json for gh-pages status dashboard |
| `scripts/health-sync/deploy_gh_pages.js` | Deploys to gh-pages branch |

### Automation
| Script | Purpose |
|--------|---------|
| `scripts/auto_track_meds.js` | Auto-logs scheduled meds (Metformin/Lisinopril/Rosuvastatin) |
| `scripts/health-sync/process_missed_text_messages.js` | Processes Telegram messages that arrived while bot was down |

### Dead Scripts — DO NOT RESURRECT
| Script | Why Dead |
|--------|---------|
| `scripts/telegram_ingest_updates.js` | Uses `getUpdates` polling — permanently dead since OpenClaw switched to webhooks (late March 2026). Telegram only delivers to webhook OR polling, never both. Last real update: March 28. |
| `scripts/photo_to_log_pipeline.js` | Depends on `telegram_media_envelopes.jsonl` which stopped receiving entries March 28. |
| `scripts/health-sync/auto_fix_pending_photo_refs.js` | Looks for `[📷](file_NNN)` temp refs that were never written. |
| `data/telegram_media_envelopes.jsonl` | Dead data source — last entry March 28. |

---

## Cron Jobs

### System Crontab (run even if OpenClaw is down)
| Schedule | Script | Notes |
|----------|--------|-------|
| `0,30 * * * *` | `health_sync_pipeline.js` | Normalize + validate + unified sync |
| `5,35 * * * *` | `auto_track_meds.js` + `calculate_notion_projections.js` + `radial_dispatcher.js` | Meds auto-log + projections + master sync |
| `20,50 * * * *` | `mysql_glucose_sync.js` | CGM → MySQL, 48h age cutoff |
| `0 * * * *` | `backfill_notion_impact.js` | Actual outcomes backfill |
| `*/5 * * * *` | `glucose_low_alert.js` | Low BG (<70) alert |
| `20 4 * * *` | `mysql_backup.sh` | Daily MySQL backup |
| `0 */4 * * *` | `sync_notion_to_mysql.js` | Notion → MySQL async |
| `0 8 * * *` | `check_provider_auth.js` | OAuth token health check (Nightscout/Notion/Codex/Gemini/Anthropic/Claude OAuth). Log-scan based, not CLI probes. |
| `15 9 * * *` | `daily_log_review.sh` | Gateway log review via `claude -p` OAuth (Haiku). Migrated from OpenClaw 2026-04-03. **Crontab entry was missing Apr 3–6 despite migration claim** — restored 2026-04-06. |
| `30 9 * * *` | `send_daily_health_report_telegram.js` | Daily report |
| `32 9 * * *` | `report_watchdog.js` | Report fallback if 9:30 fails |
| `37 9 * * *` | `send_daily_charts_telegram.js --no-regenerate` | Chart fallback |
| `45 9 * * *` | `audit_health_sync.js --lookback=2` | Daily sync audit. Migrated from OpenClaw 2026-04-03. **Crontab entry was missing Apr 3–6 despite migration claim** — restored 2026-04-06. |
| `*/15 * * * *` | `cron_health_watchdog.js` | Infrastructure health check + crontab/config drift detection |
| `0 23 * * 0` | `weekly_memory_summary.sh` | Weekly memory rollup via `claude -p` OAuth (Sonnet). Migrated from OpenClaw 2026-04-03. **Crontab entry was missing Apr 3–6 despite migration claim** — restored 2026-04-06. |

> **Critical:** All scripts must use `/opt/homebrew/bin/node` explicitly (or `/Users/javier/.local/bin/claude` for OAuth calls). System cron PATH is `/usr/bin:/bin` — bare `node`/`claude` fails silently.

> **Also critical — all crontab entries must `cd /Users/javier/.openclaw/workspace &&` before invoking scripts.** Heartbeat_wrap and all relative paths (`scripts/...`, `data/...`) break silently without it. Drift detector in `cron_health_watchdog.js` catches missing entries but not a missing `cd` prefix — review crontab by hand when adding new jobs.

### OpenClaw Cron Jobs
All 4 LLM-assisted jobs **intended** to migrate to system crontab 2026-04-03; 3 of 4 were actually installed in crontab only on 2026-04-06 after the drift was discovered. See "Trust drift incident" note below. Zero OpenClaw cron dependency now.

> **Migrated (verified in live crontab 2026-04-06):** `cron-health-watchdog`, `daily-log-review` (`claude -p` Haiku OAuth), `health-sync-daily-audit`, `weekly-memory-summary` (`claude -p` Sonnet OAuth).

### ⚠️ Trust Drift Incident (2026-04-03 → 2026-04-06)

On 2026-04-03, CLAUDE.md was updated to claim 4 OpenClaw cron jobs had been migrated to system crontab. In reality only 1 (`cron-health-watchdog`) was actually installed — the other 3 were removed from OpenClaw but the crontab entries were never added. They lived in the docs and the scripts directory but nowhere the OS would ever run them.

**Consequences, discovered 2026-04-06:**
- `daily_log_review.sh` — the script whose entire purpose is to scan gateway logs for actionable issues and alert — never ran. It would have caught the `openai-codex` OAuth `refresh_token_reused` failures that were printing hourly into `gateway.err.log` (902 occurrences by 2026-04-06).
- `audit_health_sync.js` — daily Notion/Nightscout sync audit never ran.
- `weekly_memory_summary.sh` — weekly memory rollup never ran.

**Why the cron watchdog didn't catch it:** the watchdog only alerts on jobs it knows about. These 3 jobs weren't in `data/cron_jobs_config.json` either, so the watchdog had no baseline to notice they were missing.

**Fix (2026-04-06):**
1. All 3 crontab entries installed + verified in live `crontab -l`.
2. All 3 registered in `data/cron_jobs_config.json` so the watchdog tracks them.
3. **New: crontab ↔ config drift detector** added to `cron_health_watchdog.js`. Every 15 min it parses `crontab -l`, extracts `heartbeat_wrap.js <id>` tokens, diffs against the config, and alerts on three drift classes:
   - `unscheduled` — in config, not in crontab
   - `unmonitored` — in crontab, not in config
   - `schedule-drift` — both sides have it but cronExpr differs
4. Drift issues appear in `data/cron_watchdog_status.json` under `driftIssues` and in the Telegram alert as a dedicated "Cron ↔ Config Drift" section.

**Rule going forward — the three-way source of truth:**
- `data/cron_jobs_config.json` = declared truth (what should run)
- `crontab -l` = scheduler truth (what IS scheduled)
- `data/heartbeats/<id>.json` = observed truth (what DID run)

A job is only "really running" if all three agree. The drift detector now enforces (1) ↔ (2); the stale-heartbeat detector enforces (1) ↔ (3). Docs (CLAUDE.md) are not a fourth source of truth — they describe state but cannot guarantee it. Never treat a CLAUDE.md entry as proof that something runs.

### Cron Monitoring — Heartbeat + Receipt Architecture (2026-04-06)

The HealthGuard cron dashboard at http://localhost/healthguard monitors three dimensions per job:

1. **Liveness** — did it run? (`lastRunAtMs` vs `nextRunAtMs` + grace window)
2. **Duration** — did it finish in expected time? (`lastDurationMs` vs `maxDurationMs`)
3. **Outcome** — did it achieve its purpose? (script-reported `status` + `summary` + `metrics`)

**How it works:**

- Every crontab entry is wrapped with `scripts/health-sync/heartbeat_wrap.js <job-id> -- <command...>`. The wrapper runs the command, preserves exit code, and writes `data/heartbeats/<job-id>.json` with timing + exit info.
- The wrapper sets `CRON_RECEIPT_FILE=<tmp>` in the child env. Scripts that want to report outcome beyond "it exited 0" call `writeReceipt()` before exiting:
  ```js
  const { writeReceipt } = require('./health-sync/cron_receipt'); // path is relative to the script
  writeReceipt({
    status: errors === 0 ? 'ok' : (errors < processed ? 'partial' : 'error'),
    summary: `Synced ${processed} entries — ${ok} ok / ${errors} errors`,
    metrics: { processed, ok, errors }
  });
  ```
  Valid statuses: `ok` | `partial` | `warn` | `error` | `noop`. Scripts that don't call `writeReceipt` keep working — they fall back to exit-code-only monitoring.
- `scripts/health-sync/cron_health_watchdog.js` runs every 15 min, reads `data/cron_jobs_config.json` + heartbeats, computes status, writes `data/cron_watchdog_status.json`, and Telegrams Javi if anything is overdue, errored, or exceeded its duration threshold.
- To add/remove a monitored job, edit `data/cron_jobs_config.json` (id, cronExpr, staleMaxMs, maxDurationMs) and update the crontab to wrap the new command with `heartbeat_wrap.js`.
- **Reference implementation:** `scripts/radial_dispatcher.js` is the exemplar retrofit — tracks NS/Notion outcomes per entry and writes a structured receipt.

---

## Model Routing (MANDATORY — see AGENTS.md for full rules)

| Task | Model | Reason |
|------|-------|--------|
| Food/med/exercise writes to health_log.md | **Sonnet 4.6** | Clinical data — no shortcuts |
| Entry key computation, deduplication | **Sonnet 4.6** | Hash errors silently corrupt SSoT |
| Quality gate evaluation | **Sonnet 4.6** | Wrong pass = garbage in production |
| Glucose alerts, outlier detection | **Sonnet 4.6** | False negatives are clinically dangerous |
| Image/photo analysis | **Sonnet 4.6** | Vision quality matters for nutrition accuracy |
| Daily health report narration | **Sonnet 4.6** | Clinical interpretation required |
| Conflict resolution (Notion/NS mismatch) | **Sonnet 4.6** | Data integrity |
| Cron monitoring, log review, acks | **Haiku 4.5** | Cheap, fast, no health data writes |
| Weekly memory summary | **Sonnet 4.6** via `claude -p` OAuth | Replaced Codex (was timing out). Runs locally in system cron. |
| Interactive dev sessions (like this one) | **Claude Code subscription** | Free — doesn't hit API tokens |

---

## Key Rules (Abridged — full rules in AGENTS.md)

1. **Never edit Nightscout or Notion directly.** Always edit `health_log.md` first, then run `radial_dispatcher.js`.
2. **Readback after every write.** Claim success only after write + readback + sync completed. Never fake confirmations.
3. **Fetch BG before every Telegram reply** that acknowledges food/med/exercise. Include `Current BG: X mg/dL [trend]`.
4. **Medication photo = confirmation, NOT new entry.** Check if same med+date already exists before writing.
5. **Cumulative meals within 2h = same meal type.** Food within 2h of breakfast IS breakfast, not a snack. Use cumulative carb sum.
6. **Never eyeball numbers in reports.** Run the stats scripts and use exact output.
7. **Timezone: always derive dynamically.** Never hardcode `-07:00` or `-08:00`.
8. **Photo recovery: check inbound folder first.** `/Users/javier/.openclaw/media/inbound/` has all Telegram photos. Never ask Javi to resend.

---

## Prediction Model v3 (Calibrated 2026-04-02, n=57)

```
Peak BG = preBG + (carbs × factor) + meal_intercept   [capped at 300]

Carb factors (Metformin-adjusted):
  0–15g:  × 2.0
  16–30g: × 1.3
  31–50g: × 1.2
  51+g:   × 0.8

Meal intercepts:
  Breakfast: +31   (dawn phenomenon / cortisol)
  Lunch:     −12   (Metformin fully active)
  Dinner:     −2
  Snack:      +4
  Dessert:   −14

Layer 3 — Cumulative anchor:
  If food within 2h of prior same-type meal, use FIRST item's preBG (not current live BG mid-digestion).
  Failure to do this causes ~47–56 mg/dL underestimate errors.

Layer 4 — Time-to-peak defaults (minutes):
  Breakfast: 87 | Lunch: 113 | Dinner: 76 | Snack: 126 | Dessert: 102
```

Expected accuracy: ~87–89% within ±20 mg/dL.

---

## Known Bugs Fixed (Key Ones — Full History in docs/CHANGELOG.md)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Photos never got URLs (Mar 29 – Apr 3) | `getUpdates` polling dead after webhook switch. Envelopes file stopped updating March 28. | HealthGuard now uploads in same webhook turn. Dead scripts disabled. |
| backups.json stale alerts every 15 min | Scripts called bare `node` inside `execSync` — system cron PATH has no Homebrew. Silent "command not found". | All execSync calls now use `/opt/homebrew/bin/node`. Fixed 2026-04-03. |
| MySQL glucose sync infinite loop | `INSERT IGNORE` skips duplicates silently, loop never knew it was caught up. Paginated through all history every run. | Added 48h age threshold — stop when oldest batch entry >48h old. Fixed 2026-04-03. |
| Prediction systematic overestimation | Flat `120 + carbs×3.5` baseline ignored Metformin effect, preBG, meal type. Mean error: −24 mg/dL, 75% overshoot. | Model v3: range-based carb factors + meal intercepts + preBG anchor. |
| Duplicate Notion entries on title edit | Entry key included title → any edit = new key → new Notion page every sync. | radial_dispatcher now queries Notion by Date+User, not title. |
| Pipe-split bug corrupting carbs/protein | Nutrition string `(Protein: 18g | Carbs: ~45g)` embeds pipes → fixed-index column parsing broke. | Regex extraction for all nutrition fields; join middle columns for entry text. |
| Charts silent failure (Apr 1–2) | chart.mjs referenced sandbox path that expired after session. `ensureCharts()` swallowed errors. | Copied chart-image skill to stable workspace path. Added error propagation. |
| Duplicate medication entries | Medication photo treated as new entry instead of confirmation of scheduled dose. | Rule: photo of any med = confirmation only. Check for existing entry first. |
| Duplicate NS treatments every 30 min | Old entries without NS entry_key failed both key-lookup and timestamp-lookup → POSTed as new every run. | Added 30-day rolling cutoff in radial_dispatcher. |
| False "outcomes not backfilled" audit alerts | Audit checked for non-existent `outcomes_backfilled` flag. Always false. 224 false alerts. | Changed to check Notion page_id presence instead. |
| Cron narration spam (30 min blocks) | MySQL sync job was `agentTurn` type → full agent session per run → verbose output to Telegram. | Moved to system crontab as pure script. Zero agent overhead. |

---

## ⚠️ Sandbox Limitation — Live System State

Claude Code runs in a sandbox. `crontab -l`, OpenClaw API calls, and live process queries will return empty/fail.
**Do not tell the user there are no cron jobs.** There are 11 system cron entries and 4 OpenClaw jobs.

To get a current snapshot of live state, run:
```bash
bash scripts/dump_system_state.sh
cat data/system_state.md
```
This queries the real `crontab -l` and `openclaw cron list` outside the sandbox and writes results to a file you can read.

---

## Common Commands

```bash
# Run full sync manually (always do this after editing health_log.md)
node scripts/radial_dispatcher.js

# Check sync consistency (run before and after major changes)
node scripts/consistency_check.js 2

# Audit Notion for missing entries
node scripts/health-sync/audit_health_sync.js --lookback=2

# Get current glucose stats
node scripts/calculate_glucose_summary.js
node scripts/calculate_14d_stats.js

# Check what system cron is doing
crontab -l

# Check cron/sync logs
tail -50 data/cron_health.log
tail -50 data/cron_watchdog.log

# Run daily report manually
node scripts/health-sync/send_daily_health_report_telegram.js

# Deploy gh-pages (backup dashboard + gallery)
node scripts/health-sync/deploy_gh_pages.js

# Verify backups.json freshness
node -e "const d=require('./nightscout-meal-photos/data/backups.json'); console.log('Age:', Math.round((Date.now()-new Date(d.lastUpdated))/60000), 'min')"

# Upload a photo to freeimage.host
curl -s -X POST "https://freeimage.host/api/1/upload" \
  -F "key=6d207e02198a847aa98d0a2a901485a5" \
  -F "source=@/path/to/photo.jpg" | python3 -m json.tool
```

---

## Git Workflow

```bash
# Pre-commit hooks run automatically:
#   - Unit tests (27 tests, must all pass)
#   - Sync state validation (0 duplicates allowed)
#   - Photo reference check
# Do not skip or force-push.

git add -A && git commit -m "fix: <description>"
git push origin main
```

Commit message convention: `fix:`, `feat:`, `chore:`, `refactor:`. Be specific — describe root cause and solution, not just "updated X".

---

## What's Currently Stable vs. Pending

### ✅ Stable / Working
- Radial sync to Nightscout + Notion + MySQL
- Daily report (9:30 AM, pure script)
- Glucose low alerts
- Prediction Model v3 (all 4 layers)
- System cron PATH (all scripts use full node path)
- MySQL pagination (48h cutoff)
- Photo upload via HealthGuard in real-time
- gh-pages backup status dashboard
- Pre-commit hooks + unit tests

### ⚠️ Watch / Pending Verification
- HealthGuard photo upload (new flow — first real test when Maria sends next food photo with image)
- Weekly memory summary on Codex (was timing out on Haiku — first Sunday run will tell)
- Anthropic API key transition (OpenClaw subscription ends April 4, 2026 12pm PT — decision pending)

### 🗑️ Cleanup Pending (safe to delete after 48h from 2026-04-03)
- `scripts/photo_to_log_pipeline.js`
- `scripts/health-sync/auto_fix_pending_photo_refs.js`
- `data/telegram_media_envelopes.jsonl`
- All `pending_photo_entries.json` references
