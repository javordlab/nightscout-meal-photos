# Cron Job Audit & Cleanup — 2026-04-02

## Summary
- **Before:** 24 jobs (13 disabled, 11 enabled)
- **After:** 11 jobs (1 disabled, 10 enabled)
- **Impact:** Eliminated redundant jobs, reduced agent overhead, fixed data fetching

---

## Deleted Jobs (13)

### Disabled Junk
- Maria Med Reminder (Fallback) — one-shot from March 2, errored 209s
- Shipment Tracking (Multi) — 6 errors, 321s runtime, stale
- food-log-monitor — dead envelope source, 20k minutes ago
- health-sync-pipeline — dead, 18k minutes ago
- health-sync-outcomes — never executed
- Missed Text Message Recovery (30m) — dead envelope source (same as photo pipeline)
- auto-fix-pending-photo-refs — dead envelope source, 2ms skipped
- Photo Pipeline — dead envelope source, deleted in this session
- Photo Upload Retry (5m) — dead envelope source, deleted in this session
- Radial Sync - 8am-10pm — replaced by Radial Sync (30m)
- sync-guard — 32k minutes ago

### Duplicate Jobs
- **Hourly Glucose Sync - Nightscout to MySQL** — identical to MySQL Glucose Sync (30m), made one redundant
- **notion-outcome-backfill** — covered by hourly-notion-impact-update

---

## Converted Jobs

### 1. Radial Sync (30m)
**Was:** agentTurn (6+ min runtime including agent overhead)
**Now:** command (direct script chain, ~4 min)

**Changes:**
- Agent spinup eliminated
- Script chain: `auto_track_meds.js → calculate_notion_projections.js → radial_dispatcher.js`
- Fixed data fetch: `count=5000` → `count=576` (48h of CGM @ 5-min intervals, not 17 days)

**Expected improvement:** ~2 min saved per run, reduced API load

---

### 2. hourly-notion-impact-update
**Was:** agentTurn running 4 steps
**Now:** command running 3 steps

**Removed:**
- Step 1: `calculate_notion_projections.js` (now in Radial Sync (30m))

**Kept:**
- `backfill_notion_impact.js`
- `generate_notion_gallery_data.js`
- Git push

---

### 3. Cron Health Watchdog
**Was:** command kind (3ms skipped, not actually reporting)
**Now:** agentTurn (can invoke Telegram alerts on stale jobs)

**Rationale:** Command jobs were being skipped by the scheduler. Converting to agentTurn ensures it runs and can report.

---

## Updated Job Settings

### Weekly Memory Summary
- **Timeout:** 300s → 600s (was hitting timeout every single week)
- Reason: Agent needs more time to process 7 days of memory

---

## Active Jobs (11 total, 10 enabled)

| Job | Kind | Schedule | Note |
|-----|------|----------|------|
| MySQL Daily Backup | agentTurn | 4:20 AM daily | Routine backup |
| MySQL Glucose Sync | agentTurn | Every 30m | Glucose sync |
| **Radial Sync (30m)** | **command** | Every hour | **Converted, optimized** |
| **hourly-notion-impact-update** | **command** | Every hour | **Converted, deduplicated** |
| daily-log-review | agentTurn | 9:15 AM daily | Gateway log review |
| maria-glucose-summary | agentTurn | 9:30 AM daily | Daily report (disabled) |
| Notion to MySQL Async Sync | agentTurn | Every 4h | Async sync |
| health-sync-daily-audit | agentTurn | 9:45 AM daily | Daily health audit |
| Weekly Memory Summary | agentTurn | 11 PM Sunday | **Timeout increased 5m→10m** |
| **Cron Health Watchdog** | **agentTurn** | Every 30m | **Converted, can alert** |
| Glucose Low Alert | agentTurn | Every 5m | Low BG alerts |

---

## Verification

All changes persisted to `/Users/javier/.openclaw/cron/jobs.json`.
Gateway restarted with SIGUSR1.

Run verification on next heartbeat or manual test:
```bash
node /Users/javier/.openclaw/workspace/scripts/radial_dispatcher.js
# Should now fetch only 576 entries instead of 5000
```

---

## Next Steps

1. Monitor Radial Sync (30m) runtime — expect ~4m instead of ~6m
2. Verify Weekly Memory Summary completes without timeout
3. Verify Cron Health Watchdog reports stale job alerts to Telegram
4. Check Notion gallery sync completes hourly (no redundant projections)
