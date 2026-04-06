# System State Snapshot
Generated: 2026-04-06 10:23:00 PDT

## System Crontab (crontab -l)
```
0,30 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js health-sync-pipeline -- /opt/homebrew/bin/node scripts/health-sync/health_sync_pipeline.js --mode=sync-only --since=$(date -v-2d +\%Y-\%m-\%d) >> data/cron_health.log 2>&1
5,35 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js auto-track-meds -- /opt/homebrew/bin/node scripts/auto_track_meds.js >> data/cron_health.log 2>&1 && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js calc-notion-projections -- /opt/homebrew/bin/node scripts/calculate_notion_projections.js >> data/cron_health.log 2>&1 && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js radial-dispatcher -- /opt/homebrew/bin/node scripts/radial_dispatcher.js >> data/cron_health.log 2>&1
0 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js backfill-notion-impact -- /opt/homebrew/bin/node scripts/backfill_notion_impact.js >> data/cron_health.log 2>&1
20,50 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js mysql-glucose-sync -- /opt/homebrew/bin/node scripts/mysql_glucose_sync.js >> data/cron_health.log 2>&1
*/5 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js glucose-low-alert -- /opt/homebrew/bin/node scripts/health-sync/glucose_low_alert.js >> data/cron_watchdog.log 2>&1
20 4 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js mysql-backup -- /bin/bash scripts/mysql_backup.sh >> data/cron_health.log 2>&1
0 */4 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js notion-to-mysql -- /opt/homebrew/bin/node scripts/sync_notion_to_mysql.js >> data/cron_health.log 2>&1
30 9 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js daily-report -- /opt/homebrew/bin/node scripts/health-sync/send_daily_health_report_telegram.js >> data/cron_health.log 2>&1
32 9 * * * cd /Users/javier/.openclaw/workspace && REPORT_FALLBACK_CMD="/opt/homebrew/bin/node scripts/health-sync/send_fallback_report.js" /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js report-watchdog -- /opt/homebrew/bin/node scripts/health-sync/report_watchdog.js >> data/cron_health.log 2>&1
37 9 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js daily-charts -- /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js >> data/cron_health.log 2>&1
*/15 * * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js cron-health-watchdog -- /opt/homebrew/bin/node scripts/health-sync/cron_health_watchdog.js >> data/cron_watchdog.log 2>&1
0 8 * * * cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/health-sync/heartbeat_wrap.js check-provider-auth -- /opt/homebrew/bin/node scripts/health-sync/check_provider_auth.js >> data/cron_health.log 2>&1
```

## OpenClaw Cron Jobs
No cron jobs.
## Recent Cron Activity (last 20 lines)
```
Fetching batch of 100...
Full batch received (100). Checking for older records...
Fetching batch of 100...
Full batch received (100). Checking for older records...
Fetching batch of 100...
Full batch received (100). Checking for older records...
Fetching batch of 100...
Full batch received (100). Checking for older records...
Fetching batch of 100...
Partial batch (100) or caught up (age 51h). Sync complete.
Sync Process Finished. Total records processed: 600
  -> Updating Backup Dashboard...
Transfer starting: 50 files
data/backups.json

sent 573015 bytes  received 42 bytes  184857096 bytes/sec
total size is 5679677  speedup is 9.91
[gh-pages f223cd1] deploy: auto-sync site files 2026-04-06T17:20:42.133Z
 1 file changed, 1 insertion(+), 5 deletions(-)
gh-pages: deployed at 2026-04-06T17:20:42.133Z
```

## Backup Dashboard Freshness
backups.json last updated: 2026-04-06T17:20:41.962Z (2 min ago)
Status: ✅ FRESH

## Sync State Summary
Total entries: 2
With Notion page_id: 0
With Nightscout treatment_id: 0

