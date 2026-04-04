# CLAUDE.md — Bootstrap for Claude Code Sessions

This is the health monitoring and automation workspace for **Maria Dennis** (73yo, T2D), managed by **Javier Ordonez**.

## Start Every Session By Reading These Files

```
AGENTS.md        — All operational rules (NON-NEGOTIABLE). Read this first.
MEMORY.md        — Long-term curated facts (people, infrastructure, model config)
TOOLS.md         — Credentials, logging protocol, Nightscout/Notion endpoints
memory/          — Daily session memory files (YYYY-MM-DD.md). Read today + yesterday.
```

Do NOT read SOUL.md, HEARTBEAT.md, or BOOTSTRAP.md — those are OpenClaw runtime files.

## What This Workspace Does

A fully automated health logging pipeline for a Type 2 Diabetic patient:
- **Intake:** Maria sends food/medication/exercise via Telegram → logged to `health_log.md`
- **Prediction:** Peak BG predicted immediately using Model v3 formula (see AGENTS.md)
- **Sync:** Every 30 min, `radial_dispatcher.js` pushes to Nightscout + Notion + MySQL
- **Monitoring:** Glucose low alerts every 5 min, daily report at 9:30 AM PT
- **Backfill:** Actual outcomes written ~3h after each meal entry

## Architecture

```
health_log.md (SSoT)
    └── radial_dispatcher.js (every 30 min via system cron)
            ├── Nightscout API  (CGM treatments)
            ├── Notion DB       (31685ec7-0668-813e-8b9e-c5b4d5d70fa5)
            └── MySQL           (local backup)
```

## Key Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/radial_dispatcher.js` | Master sync: health_log → Nightscout + Notion + MySQL |
| `scripts/calculate_notion_projections.js` | Peak BG prediction (Model v3, 4-layer formula) |
| `scripts/calculate_glucose_summary.js` | 24h glucose stats for daily report |
| `scripts/calculate_14d_stats.js` | 14-day trend stats for daily report |
| `scripts/mysql_glucose_sync.js` | CGM data → MySQL (48h age cutoff pagination) |
| `scripts/consistency_check.js` | Pre/post-sync validation gate |
| `scripts/health-sync/audit_health_sync.js` | Detects entries missing from Notion/NS |
| `scripts/health-sync/quality_gates.js` | Blocks malformed entries before they persist |
| `scripts/health-sync/ns_upsert_safe.js` | Idempotent Nightscout write with dedup |
| `scripts/health-sync/cron_health_watchdog.js` | Checks system cron job freshness |
| `scripts/health-sync/send_daily_health_report_telegram.js` | 9:30 AM daily report |
| `scripts/health-sync/glucose_low_alert.js` | Real-time low BG alert (<70 mg/dL) |
| `scripts/auto_track_meds.js` | Auto-logs Metformin/Lisinopril/Rosuvastatin on schedule |
| `scripts/health-sync/confirmation_ledger.js` | Write ledger — guards against fake confirmations |

## System Cron Jobs (pure scripts, no LLM)

| Schedule | Script |
|----------|--------|
| `5,35 * * * *` | Radial Sync pipeline |
| `20,50 * * * *` | MySQL Glucose Sync |
| `0 * * * *` | Notion impact backfill |
| `*/5 * * * *` | Glucose Low Alert |
| `20 4 * * *` | MySQL Daily Backup |
| `0 */4 * * *` | Notion → MySQL Async Sync |
| `30 9 * * *` | Daily health report (Telegram) |

## OpenClaw Cron Jobs (LLM-assisted, isolated sessions)

| Job | Model | Purpose |
|-----|-------|---------|
| cron-health-watchdog (every 30m) | Haiku | Checks cron freshness, alerts if stale |
| daily-log-review (9:15 AM) | Haiku | Reviews gateway logs for actionable issues |
| health-sync-daily-audit (9:45 AM) | Haiku | Audits Notion/NS for missing entries |
| weekly-memory-summary (Sun 11 PM) | Codex | Synthesizes weekly memory files |

## Model Routing (CRITICAL — follow AGENTS.md exactly)

| Task | Model |
|------|-------|
| Health log writes, BG alerts, image analysis, quality gates | `anthropic/claude-sonnet-4-6` |
| Cron monitoring, log review, simple acks | `anthropic/claude-haiku-4-5` |
| Weekly summaries, non-critical background | `openai-codex/gpt-5.3-codex` |
| Interactive dev sessions (you're in one now) | Claude Code subscription — free |

## Infrastructure

- **Nightscout:** `https://p01--sefi--s66fclg7g2lm.code.run`
  - API Secret (SHA1): `b3170e23f45df7738434cd8be9cd79d86a6d0f01`
- **Notion DB:** `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`
- **Photo hosting:** `freeimage.host` (Key: `6d207e02198a847aa98d0a2a901485a5`)
- **Telegram group:** `-5262020908` | Bot: `@Javordclaws_bot`
- **GitHub:** `javordlab` (all private, 27 repos)

## Data Integrity Rules

1. **Never edit Nightscout or Notion directly** — always edit `health_log.md` first, then sync
2. **Always run `node scripts/consistency_check.js 2`** before and after major changes
3. **All paths use absolute paths** — system cron has no `$HOME`
4. **Node binary:** always `/opt/homebrew/bin/node` in scripts (system cron PATH is minimal)
5. **Timezone:** always derive dynamically — never hardcode `-07:00` or `-08:00`
6. **Entry keys:** SHA256-based, computed by `health-sync/sync_state.js` — never guess or hand-roll

## Common Tasks

```bash
# Run full sync manually
node scripts/radial_dispatcher.js

# Check sync consistency
node scripts/consistency_check.js 2

# Audit Notion for missing entries (last 2 days)
node scripts/health-sync/audit_health_sync.js --lookback=2

# Run daily report manually
node scripts/health-sync/send_daily_health_report_telegram.js

# Check glucose stats
node scripts/calculate_glucose_summary.js
node scripts/calculate_14d_stats.js
```

## Git Workflow

- All changes committed to `main` before considering done
- Pre-commit hooks run unit tests + sync state validation — do not skip
- Commit messages follow conventional commits: `fix:`, `feat:`, `chore:`
- After infra changes: always verify with `node scripts/consistency_check.js 2`
