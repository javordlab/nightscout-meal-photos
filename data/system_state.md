# System State Snapshot
Generated: 2026-04-03 20:55:15 PDT

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
```

## OpenClaw Cron Jobs
ID                                   Name                     Schedule                         Next       Last       Status    Target    Agent ID   Model               
cron-health-watchdog                 Cron Health Watchdog     every 30m                        in 25m     5m ago     ok        isolated  health-... anthropic/claude-...
d8810b23-d4f7-4dc2-8ee8-7cf68a224fee daily-log-review         cron 15 9 * * * @ America/Los... in 12h     12h ago    ok        isolated  main       anthropic/claude-...
f97ed139-e463-4c4d-a0df-3008be17af43 health-sync-daily-audit  cron 45 9 * * * @ America/Los... in 13h     11h ago    ok        isolated  health-... anthropic/claude-...
weekly-memory-summary                Weekly Memory Summary    cron 0 23 * * 0 @ America/Los... in 2d      5d ago     error     isolated  health-... openai-codex/gpt-...
## Recent Cron Activity (last 20 lines)
```
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

sent 569994 bytes  received 42 bytes  56439207 bytes/sec
total size is 5692506  speedup is 9.99
[gh-pages 97a72f8] deploy: auto-sync site files 2026-04-04T03:50:02.663Z
 1 file changed, 10 insertions(+), 6 deletions(-)
To https://github.com/javordlab/nightscout-meal-photos.git
   096be38..97a72f8  gh-pages -> gh-pages
gh-pages: deployed at 2026-04-04T03:50:02.663Z
```

## Backup Dashboard Freshness
backups.json last updated: 2026-04-04T03:50:02.252Z (5 min ago)
Status: ✅ FRESH

## Sync State Summary
Total entries: 2
With Notion page_id: 0
With Nightscout treatment_id: 0

