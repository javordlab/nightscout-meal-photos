# CLAUDE.md — Full Context Bootstrap for Claude Code Sessions

> Read this file first. Then read today's + yesterday's `memory/YYYY-MM-DD.md`. Then you're ready.

---

## Who You Are Helping

**Javier Ordonez (Javi)** — engineer, timezone: America/Los_Angeles, Telegram: 8335333215. Technical, precise, prefers directness. Contact: ordonez@gmail.com.

**Maria Dennis** — 73yo, 139 lbs, 5'0". Type 2 Diabetes (FreeStyle Libre 3 CGM). The health system exists for her.
- **Meds:** Trulicity (dulaglutide) weekly injection (every Monday morning) | Metformin 500mg (breakfast), 500mg (lunch), 1000mg (dinner) | Lisinopril 10mg (morning) | Rosuvastatin 10mg (every other morning, anchor date 2026-03-01)

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
- **Prediction:** Peak BG predicted immediately using Model v4 (4-layer formula, see AGENTS.md)
- **Sync:** Every 30 min, `radial_dispatcher.js` pushes to Nightscout + Notion + MySQL
- **Monitoring:** Glucose low alerts every 5 min, daily report at 9:30 AM PT, cron watchdog every 30 min
- **Backfill:** Actual glucose outcomes written ~3h after each meal entry

---

## Architecture

```
Maria's Telegram message
    └── HealthGuard agent processes via Telegram webhook
            ├── Photos: uploaded to freeimage.host in same turn, URL written to health_log.md
            └── Text: food/med/exercise entry written to health_log.md

health_log.md  (SSoT — never edit downstream systems directly)
    └── radial_dispatcher.js (SOLE syncer — system cron 5/35 min + bridge + post-edit chain)
            ├── Nightscout API  → treatments (food, exercise, notes)
            ├── Notion DB       → 31685ec7-0668-813e-8b9e-c5b4d5d70fa5
            └── MySQL           → local backup

Monitoring:
    ├── mysql_glucose_sync.js     → syncs CGM readings to MySQL (20,50 * * * *)
    ├── glucose_low_alert.js      → daytime (08:30–24:00): BG ≤ 80 / ≤ 90+down. Overnight (00:00–08:30): BG < 70 only. (*/5 * * * *)
    ├── send_daily_health_report_telegram.js → 9:30 AM daily report (pure script, no LLM)
    └── cron_health_watchdog.js   → checks all cron jobs for staleness (every 15 min, pure script)
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
| **GitHub** | `javordlab` (all private, 27 repos) |
| **Node binary** | `/opt/homebrew/bin/node` — ALWAYS use full path in scripts (system cron has no PATH) |
| **Workspace** | `/Users/javier/.openclaw/workspace` |

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
| `scripts/calculate_notion_projections.js` | Peak BG prediction (Model v4, 4-layer formula). Runs in radial sync. |
| `scripts/calculate_glucose_summary.js` | 24h + 14d glucose stats (fetches live from NS). Suppresses 14d when coverage <13 days. |
| `scripts/calculate_14d_stats.js` | 14d trend stats (fetches live from NS). Exits with code 2 when coverage <13 days. |
| `scripts/backfill_meal_outcomes.js` | Writes actual BG outcomes ~3h post-meal to MySQL + best-effort Notion mirror (hourly cron). Replaced `backfill_notion_impact.js` 2026-05-21. |

### Monitoring & Alerts
| Script | Purpose |
|--------|---------|
| `scripts/health-sync/glucose_low_alert.js` | Daytime (08:30–24:00): alerts at BG ≤ 80 (any trend) or BG ≤ 90 + downtrend. Overnight (00:00–08:30): alerts only when BG < 70. Re-alerts on critical re-cross, after 30 min of stale state, or once BG recovers above 100. Runs every 5 min. |
| `scripts/health-sync/cron_health_watchdog.js` | Checks cron job freshness, alerts if stale. Every 15 min. |
| `scripts/health-sync/audit_health_sync.js` | Detects entries missing from Notion or Nightscout. System cron 9:10 AM. |
| `scripts/health-sync/report_watchdog.js` | Verifies daily report was sent; triggers fallback if not. Cron 9:35 (must run AFTER its 9:32 deadline — at the old 8:57 slot it was dead code for 2 months). Exits 0 with a `warn` receipt when the fallback delivered (that's the watchdog succeeding); exits 1 only when the day ends uncovered. |

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
| `scripts/sync_notion_to_mysql.js` | RETIRED 2026-05-21 (`retired: true` in cron config) — MySQL is written from SSoT via `sync_ssot_to_mysql.js`, not from Notion |
| `scripts/mysql_backup.sh` | Daily MySQL backup (4:20 AM) |
| `scripts/generate_backup_dashboard_data.js` | Updates backups.json for gh-pages status dashboard |
| `scripts/health-sync/deploy_gh_pages.js` | Deploys to gh-pages branch — only when a new photo (uploads/) changed, at most-daily for data-only churn, or with `--force` (GitHub Pages throttles >10 builds/hr) |

### Automation
| Script | Purpose |
|--------|---------|
| `scripts/auto_track_meds.js` | Auto-logs scheduled meds (Metformin/Lisinopril/Rosuvastatin) |

### Dead Scripts — DO NOT RESURRECT
| Script | Why Dead |
|--------|---------|
| `scripts/telegram_ingest_updates.js` | Uses `getUpdates` polling — permanently dead since OpenClaw switched to webhooks (late March 2026). Telegram only delivers to webhook OR polling, never both. Last real update: March 28. |
| `scripts/photo_to_log_pipeline.js` | Depends on `telegram_media_envelopes.jsonl` which stopped receiving entries March 28. |
| `scripts/health-sync/auto_fix_pending_photo_refs.js` | Looks for `[📷](file_NNN)` temp refs that were never written. |
| `data/telegram_media_envelopes.jsonl` | Dead data source — last entry March 28. |

---

## Cron Jobs

### System Crontab
| Schedule | Script | Notes |
|----------|--------|-------|
| `0,30 * * * *` | `health_sync_pipeline.js` | `--mode=sync-only`: resolve photos + normalize + enrich + validate (hard gate). NS/Notion sync REMOVED 2026-06-12 — radial_dispatcher is the sole syncer. |
| `5,35 * * * *` | `auto_track_meds.js` + `calculate_notion_projections.js` + `radial_dispatcher.js` | Meds auto-log + projections + master sync |
| `20,50 * * * *` | `mysql_glucose_sync.js` | CGM → MySQL, 48h age cutoff |
| `0 * * * *` | `backfill_meal_outcomes.js` | Actual outcomes backfill (MySQL canonical + Notion mirror) |
| `*/5 * * * *` | `glucose_low_alert.js` | Low BG alert — daytime ≤80 / ≤90+down, overnight <70 only |
| `20 4 * * *` | `mysql_backup.sh` | Daily MySQL backup |
| `15 4 * * *` | `rotate_cron_logs.sh` | Rotate cron_health/cron_watchdog logs when >50MB (added 2026-06-10) |
| `35 9 * * *` | `report_watchdog.js` | Report fallback if 08:55 launchd job failed (9:35 > its 9:32 deadline) |
| `2 9 * * *` | `send_daily_charts_telegram.js` | Chart fallback — early-exits if 08:55 launchd job already sent all charts (otherwise regenerates + sends only the missing ones) |
| `10 9 * * *` | `audit_health_sync.js --lookback=2` | Daily sync audit. |
| `10,40 * * * *` | `sync_ssot_to_mysql.js` | SSoT → MySQL mirror |
| `15,45 * * * *` | `publish_photos_to_gh_pages.js` | Push new meal photos to gh-pages |
| `*/20 * * * *` | `rescue_pending_photos.js` | Re-attempt any photos that failed initial upload |
| `*/5 * * * *` | `probe_launchd_jobs.js` | Heartbeat-mirror for launchd jobs so the watchdog can see them. Jobs flagged `selfHeartbeat: true` in cron_jobs_config.json (daily-report) write their own heartbeat via heartbeat_wrap — for those the probe only checks loaded-ness and never overwrites the heartbeat or re-reports launchd's sticky `last exit code`. |
| `*/15 * * * *` | `cron_health_watchdog.js` | Infrastructure health check + crontab/config drift detection |
| `0 23 * * 0` | `weekly_memory_summary.sh` | Weekly memory rollup via `claude -p` OAuth (Opus 4.7). |

> **Critical:** All scripts must use `/opt/homebrew/bin/node` explicitly (or `/Users/javier/.local/bin/claude` for OAuth calls). System cron PATH is `/usr/bin:/bin` — bare `node`/`claude` fails silently.

> **Also critical — all crontab entries must `cd /Users/javier/.openclaw/workspace &&` before invoking scripts.** Heartbeat_wrap and all relative paths (`scripts/...`, `data/...`) break silently without it. Drift detector in `cron_health_watchdog.js` catches missing entries but not a missing `cd` prefix — review crontab by hand when adding new jobs.

### launchd Plists (`~/Library/LaunchAgents/`)
| Plist | Schedule | What it runs |
|-------|----------|--------------|
| `com.healthguard.daily-report.plist` | 08:55 daily | `send_daily_health_report_telegram.js` — sends the daily report AND chains into `send_daily_charts_telegram.js` for all charts. This is the authoritative daily send. |
| `com.healthguard.dashboard-server.plist` | RunAtLoad | Serves the local cron dashboard at `http://localhost/healthguard` |
| `com.healthguard.glucose-sync.plist` | every 120s | `mysql_glucose_sync.js` — fast path for dashboard freshness. The crontab `20,50` entry runs the SAME script as the heartbeat-monitored backup path; idempotent, intentional dual-path. |

> **Why launchd, not crontab, for the daily report:** launchd survives sleep — if the laptop is asleep at 08:55, the job fires on next wake. crontab silently skips missed runs. Documented here because the system crontab `2 9 * * *` chart entry is a *fallback*, not the primary path; the watchdog reads `cron_jobs_config.json` which already declares `daily-report` with `source: launchd`.

### Cron Monitoring — Drift Detection (2026-04-06)

The cron watchdog (`cron_health_watchdog.js`) ensures consistency across three sources:
- `data/cron_jobs_config.json` = declared truth (what should run)
- `crontab -l` = scheduler truth (what IS scheduled)
- `data/heartbeats/<id>.json` = observed truth (what DID run)

A job is only "really running" if all three agree. The drift detector alerts on misalignment. Docs (CLAUDE.md) are not authoritative — always verify against the three-way truth.

### Cron Monitoring — Heartbeat + Receipt Architecture (2026-04-06)

The HealthGuard cron dashboard at http://localhost/healthguard monitors three dimensions per job:

1. **Liveness** — did it run? (`lastRunAtMs` vs `nextRunAtMs` + grace window)
2. **Duration** — did it finish in expected time? (`lastDurationMs` vs `maxDurationMs`)
3. **Outcome** — did it achieve its purpose? (script-reported `status` + `summary` + `metrics`)

**How it works:**

- Every crontab entry is wrapped with `scripts/health-sync/heartbeat_wrap.js <job-id> -- <command...>`. The wrapper runs the command, preserves exit code, and writes `data/heartbeats/<job-id>.json` with timing + exit info. `consecutiveErrors` counts only hard errors (`lastStatus === 'error'`); `warn`/`partial` receipts do not increment it (2026-07-02 fix — a partial probe receipt used to accumulate hundreds of phantom "consecutive errors").
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

All health-critical and data-touching tasks use **Claude Opus 4.8** (`claude-opus-4-8`) — switched from Fable 5 on 2026-06-21 (scheduled), prev. Fable 5 since 2026-06-10:
- Any write to `health_log.md`, Nightscout, or Notion
- Entry key computation and deduplication (hash errors corrupt SSoT)
- Quality gate evaluation (blocks malformed entries)
- Glucose alerts, outlier detection, peak BG projection
- Image/photo analysis and food description accuracy
- Daily health report (all sections including Coach narration)
- Conflict resolution when systems diverge
- Daily log review and cron monitoring via `claude -p` OAuth
- Weekly memory summaries

**Why Opus 4.8 across the board:** No cost-based tradeoffs for health data. Medication errors, food carb misestimation, or data deduplication failures have direct clinical consequence. Consistency of model across all health operations reduces risk of subtle model-specific bugs.

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

## Prediction Model v4 (Calibrated 2026-06-12, n=145 clean meals, holdout-validated)

> Supersedes v3 (2026-04-02, n=57). Full analysis: `docs/model_v4_calibration_2026-06-12.md`.
> Parity contract — the formula lives in FOUR places, change all together:
> `foodlog-cwd/CLAUDE.md` Step 4, `scripts/calculate_notion_projections.js`, `AGENTS.md`, this section.

```
Peak BG = preBG + (carbs × factor) + meal_intercept − 0.35 × (preBG − 115)   [capped at 300]

Carb factors (Metformin-adjusted, monotonically declining):
  0–15g:  × 2.0
  16–30g: × 1.2
  31–50g: × 0.9
  51+g:   × 0.7

Meal intercepts:
  Breakfast: +25   (dawn phenomenon / cortisol)
  Lunch:      −5
  Dinner:      0
  Snack:       0
  Dessert:   −10

preBG damping term:
  −0.35 × (preBG − 115) — high baselines regress down, low baselines up.

Layer 3 — Cumulative anchor:
  If food within 1h of prior same-type meal, use FIRST item's preBG (not current live BG mid-digestion).
  Failure to do this causes ~47–56 mg/dL underestimate errors.

Layer 4 — Time-to-peak defaults (minutes):
  Breakfast: 87 | Lunch: 75 | Dinner: 55 | Snack: 60 | Dessert: 95
```

Measured accuracy (clean meals, no stacking): MAE ~15 mg/dL, ~68% within ±20, ~90% within ±30.
(v3 measured: MAE 20.6, 57% within ±20 — its "87–89% within ±20" claim never held on real data.)

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

Claude Code runs in a sandbox. `crontab -l` and live process queries will return empty/fail when run directly from Claude Code.

To get a current snapshot of live state, run:
```bash
bash scripts/dump_system_state.sh
cat data/system_state.md
```
This queries the real `crontab -l` outside the sandbox and writes results to a file you can read.

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
- Prediction Model v4 (all 4 layers, recalibrated 2026-06-12)
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
