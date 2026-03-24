# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Workspace Is

A production health data orchestration system for Maria Dennis (Type 2 Diabetic) managed by Javier Ordonez. It maintains a single source of truth (SSoT) health log and syncs it across Nightscout, Notion, and MySQL.

**Radial architecture:** `health_log.md` → `scripts/radial_dispatcher.js` → (Nightscout + Notion + MySQL + Gallery). Downstream systems are overwritten on every sync — changes made directly to Notion/MySQL/Nightscout are ephemeral.

## Commands

```bash
# Run all tests
npm test

# Unit / integration / validation tests individually
node --test tests/unit/*.test.js
node --test tests/integration/*.test.js
node scripts/health-sync/validate_health_sync.js --fail-on-error

# Lint
npx eslint scripts/

# Dry-run sync (no writes)
node scripts/health-sync/unified_sync.js --dry-run

# Consistency check (always run before/after sync)
node scripts/consistency_check.js 2

# Daily report
node scripts/generate_daily_report.js

# Watchdog (alert if 9:30 AM report missed)
node scripts/health-sync/report_watchdog.js

# Deploy
node scripts/deploy.js --env=staging
node scripts/validate_sync.js --env=staging
node scripts/deploy.js --env=production
```

**Node.js >= 18 required.**

## Key Files

| Path | Purpose |
|------|---------|
| `health_log.md` | SSoT — never edit downstream systems directly |
| `scripts/radial_dispatcher.js` | Main sync orchestrator (cron every 30 min) |
| `scripts/health-sync/unified_sync.js` | Idempotent Nightscout + Notion + Gallery sync |
| `scripts/health-sync/normalize_health_log.js` | Parses `health_log.md` → canonical JSON |
| `scripts/health-sync/quality_gates.js` | Validation — blocks placeholders, enforces protein/carbs |
| `scripts/health-sync/sync_state.js` | Sync ledger tracking entry keys and hashes |
| `scripts/consistency_check.js` | 2-day lookback: duplicates, missing entries |
| `data/sync_state.json` | State ledger (156 KB) — critical, don't delete |
| `data/health_log.normalized.json` | Canonical JSON from last normalization |
| `MEMORY.md` | Long-term curated memory for agents |
| `memory/YYYY-MM-DD.md` | Daily memory snapshots |

## Data Entry Rules

- **Timezone:** Always use PST/PDT offsets (e.g., `2026-03-22 09:00 -07:00`). Never raw UTC.
- **Entry key:** `sha256(timestamp|user|title)` — used for deduplication across all systems.
- **Food entries:** Must include BG at meal time, predicted peak (`meal_time + 105 min`, `peak = 120 + carbs * 3.5` capped at 300), protein, carbs, cals, and photo link.
- **Medications:** Use `Note` eventType in Nightscout.
- **Activity:** Use `Exercise` eventType in Nightscout.
- **No placeholders:** Quality gates hard-block entries like `[Photo received - awaiting manual description]`.

## External Integrations

| System | Detail |
|--------|--------|
| **Nightscout** | `https://p01--sefi--s66fclg7g2lm.code.run` — secret is SHA1-hashed |
| **Notion DB** | `31685ec7-0668-813e-8b9e-c5b4d5d70fa5` (Maria Health Log) |
| **MySQL** | Database `health_monitor`, table `maria_health_log`, binary at `/opt/homebrew/opt/mysql@8.4/bin/mysql` |
| **Gallery** | `nightscout-meal-photos/data/notion_meals.json` (GitHub-hosted) |
| **Telegram** | Group `-5262020908` ("Food log"), bot `@Javordclaws_bot` |

API keys are stored in `~/.openclaw/secrets/` and referenced in `TOOLS.md`.

## Cron Jobs (Active)

| Schedule | Job | Script |
|----------|-----|--------|
| Every 30 min | Radial sync | `radial_dispatcher.js` |
| Every hour | Impact projections | backfill + projections |
| Every 2h | Outcome backfill | `backfill_notion_impact.js` |
| 9:15 AM PT | Daily audit | audit health_log vs Notion |
| 9:30 AM PT | Daily report | `generate_daily_report.js` → Telegram |

## Testing Strategy

- **Unit tests** (`tests/unit/`): quality gate logic, entry key/dedup in sync_state
- **Integration tests** (`tests/integration/`): full Nightscout + Notion sync against real APIs
- **Fixtures** (`tests/fixtures/`): test data stubs

## Agent Operational Rules (summary of AGENTS.md)

- On HEARTBEAT checks: reply exactly `HEARTBEAT_OK`, nothing else.
- Handle tool/edit errors silently. Report only gateway-level failures.
- Use `trash` not `rm`.
- Default model: `ollama/kimi-k2.5:cloud` → fallback `openai-codex/gpt-5.3-codex` → `ollama/qwen2.5-coder:7b`. **Hard rule:** all image interpretation must use `openai-codex/gpt-5.3-codex` (never Gemini/Kimi for image understanding).
- Daily reports must state the model name used to generate them.
- Read `memory/YYYY-MM-DD.md` (today + yesterday) and `MEMORY.md` at session start.
