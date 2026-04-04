# System State Snapshot
Generated: 2026-04-03 22:49:20 PDT

## System Crontab (crontab -l)
```
0,30 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/health_sync_pipeline.js --mode=sync-only --since=$(date -v-2d +\%Y-\%m-\%d) >> data/cron_health.log 2>&1
5,35 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/auto_track_meds.js >> data/cron_health.log 2>&1 && /opt/homebrew/bin/node scripts/calculate_notion_projections.js >> data/cron_health.log 2>&1 && /opt/homebrew/bin/node scripts/radial_dispatcher.js >> data/cron_health.log 2>&1
0 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/backfill_notion_impact.js >> data/cron_health.log 2>&1
20,50 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/mysql_glucose_sync.js >> data/cron_health.log 2>&1
*/5 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/glucose_low_alert.js >> data/cron_watchdog.log 2>&1
20 4 * * * cd /Users/javier/.openclaw/workspace && /bin/bash scripts/mysql_backup.sh >> data/cron_health.log 2>&1
0 */4 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/sync_notion_to_mysql.js >> data/cron_health.log 2>&1
30 9 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/send_daily_health_report_telegram.js >> data/cron_health.log 2>&1
32 9 * * * cd /Users/javier/.openclaw/workspace && REPORT_FALLBACK_CMD="/opt/homebrew/bin/node scripts/health-sync/send_fallback_report.js" /opt/homebrew/bin/node scripts/health-sync/report_watchdog.js >> data/cron_health.log 2>&1
37 9 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js --no-regenerate >> data/cron_health.log 2>&1
*/15 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/cron_health_watchdog.js >> data/cron_watchdog.log 2>&1
0 8 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/check_provider_auth.js >> data/cron_health.log 2>&1
15 9 * * * cd /Users/javier/.openclaw/workspace && /bin/bash scripts/health-sync/daily_log_review.sh >> data/cron_health.log 2>&1
45 9 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/audit_health_sync.js --lookback=2 >> data/cron_health.log 2>&1
0 23 * * 0 /bin/bash scripts/health-sync/weekly_memory_summary.sh >> data/cron_health.log 2>&1
```

## OpenClaw Cron Jobs
No cron jobs.
## Recent Cron Activity (last 20 lines)
```
Full batch received (100). Checking for older records...
Fetching batch of 100...
Full batch received (100). Checking for older records...
Fetching batch of 100...
Partial batch (100) or caught up (age 51h). Sync complete.
Sync Process Finished. Total records processed: 600
  -> Updating Backup Dashboard...
Transfer starting: 50 files
data/backups.json
data/notion_meals.json

sent 635590 bytes  received 64 bytes  104205573 bytes/sec
total size is 5692435  speedup is 8.96
[gh-pages 6100a54] deploy: auto-sync site files 2026-04-04T05:44:25.854Z
 1 file changed, 18 insertions(+), 14 deletions(-)
gh-pages: deployed at 2026-04-04T05:44:25.854Z
[2026-04-03 22:47:27] [weekly-memory] Starting weekly memory summary
[2026-04-03 22:47:27] [weekly-memory] Found 3 daily memory files for 2026-W14
[2026-04-03 22:48:40] [weekly-memory] Wrote weekly summary to /Users/javier/.openclaw/workspace/memory/weekly/2026-W14.md (135 lines)
[2026-04-03 22:48:41] [weekly-memory] Weekly memory summary complete
```

## Backup Dashboard Freshness
backups.json last updated: 2026-04-04T05:44:25.668Z (5 min ago)
Status: ✅ FRESH

## Sync State Summary
Total entries: 2
With Notion page_id: 0
With Nightscout treatment_id: 0

