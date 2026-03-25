# Active Scripts Inventory

Last updated: 2026-03-25. 29 scripts in `scripts/`, 25 in `scripts/health-sync/`.

## scripts/ (Primary Orchestrators)

| Script | Caller | Purpose |
|--------|--------|---------|
| `radial_dispatcher.js` | Cron (30 min) + PostToolUse hook | Main sync: health_log.md -> Notion + Nightscout + MySQL |
| `auto_track_meds.js` | Cron (30 min) | Auto-log medications based on schedule |
| `calculate_notion_projections.js` | Cron (30 min + hourly) | Calculate predicted peak BG/time for meals |
| `backfill_notion_impact.js` | Cron (2h + hourly) | Backfill actual glucose outcomes |
| `photo_to_log_pipeline.js` | Cron (1 min) | Process inbound photos -> health_log.md |
| `mysql_glucose_sync.js` | Cron (30 min + hourly) | Sync glucose data to MySQL |
| `sync_notion_to_mysql.js` | Cron (4h) | Sync Notion records to MySQL |
| `mysql_backup.sh` | Cron (4:20 AM) | MySQL daily backup -> Telegram |
| `refresh_glucose_data.js` | Cron (pre-report) | Fetch fresh NS data for daily report |
| `generate_daily_report.js` | Required by report sender | Generate Maria's daily health summary |
| `generate_daily_glucose_chart.js` | Cron (report time) | 24h glucose chart image |
| `generate_glucose_chart.js` | Cron (report time) | 14d glucose trends chart |
| `generate_weekly_calories_chart.js` | Cron (report time) | Weekly calorie chart |
| `generate_weekly_carbs_chart.js` | Cron (report time) | Weekly carb chart |
| `generate_notion_gallery_data.js` | Cron (hourly, event-driven) | Regenerate meal gallery JSON |
| `calculate_glucose_summary.js` | Report pipeline | Calculate TIR, avg, GMI, std dev, CV |
| `calculate_14d_stats.js` | Report pipeline | 14-day trend statistics |
| `consistency_check.js` | Manual / npm test | 2-day lookback: duplicates, missing entries |
| `check_notion.js` | Manual | Query Notion DB (--mode=today/24h/3d/recent/projections) |
| `fetch_bg.js` | Agent / manual | Fetch current BG from Nightscout |
| `telegram_ingest_updates.js` | Cron / pipeline | Ingest Telegram messages |
| `telegram_classify_updates.js` | Pipeline | Classify Telegram message types |
| `get_telegram_messages.js` | Manual | Retrieve recent Telegram messages |
| `mysql_glucose_backfill.js` | Manual | Backfill glucose data to MySQL |
| `validate_log_integrity.js` | npm test:integrity | Validate health_log.md structural integrity |
| `validate_sync.js` | npm test:validation | Validate sync state before deploy |
| `deploy.js` | npm deploy:staging/production | Deploy pipeline |

## scripts/health-sync/ (Sync Machinery)

| Script | Caller | Purpose |
|--------|--------|---------|
| `health_sync_pipeline.js` | Cron / manual | Full pipeline: normalize -> validate -> sync -> audit |
| `normalize_health_log.js` | Pipeline step | Parse health_log.md -> canonical JSON |
| `quality_gates.js` | Pipeline / validate | Block placeholders, enforce protein/carbs |
| `unified_sync.js` | Pipeline step | Idempotent Nightscout + Notion + Gallery sync |
| `sync_state.js` | Module (many) | Sync ledger: entry key tracking and hashes |
| `ns_identity.js` | Module | Nightscout entry identity helpers |
| `ns_upsert_safe.js` | Module | Safe Nightscout upsert with dedup |
| `enrich_sync_state.js` | Pipeline step | Enrich sync state with additional metadata |
| `backfill_outcomes.js` | Cron (2h) | Backfill actual glucose outcomes |
| `repair_health_sync.js` | Pipeline step | Auto-repair sync discrepancies |
| `audit_health_sync.js` | Cron (9:45 AM) | Daily discrepancy audit (health_log vs Notion vs NS) |
| `validate_health_sync.js` | npm validate:health | Quality gate validation |
| `validate_write.js` | PostToolUse hook | Post-write quality check for Food entries |
| `confirmation_ledger.js` | Module | Write ledger for Telegram confirmation audit |
| `record_write_to_ledger.js` | PostToolUse hook | Record each health_log.md write to ledger |
| `audit_telegram_confirmations.js` | Cron (2h) | Safety-net: detect phantom confirmations |
| `send_daily_health_report_telegram.js` | System crontab (9:30 AM) | Send daily report to Telegram group |
| `send_daily_charts_telegram.js` | System crontab (9:37 AM) | Send 4 chart images to Telegram |
| `send_fallback_report.js` | System crontab (9:32 AM) | Fallback report if primary fails |
| `report_watchdog.js` | Module / manual | Track report delivery state |
| `photo_link_watchdog.js` | npm watchdog:photo-links | Monitor photo link resolution |
| `cron_health_watchdog.js` | System crontab (every 15 min) | Alert Javi via Telegram DM if any OpenClaw cron job is overdue |
| `resolve_pending_photo_links.js` | Module | Resolve pending photo upload URLs |
| `retry_pending_photo_uploads.js` | Cron (5 min) | Retry failed photo uploads |
| `trigger_post_log_sync.js` | File watcher | Monitor health_log.md changes, trigger sync |
