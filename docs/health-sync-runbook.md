# Health Sync Runbook
**Purpose:** day-to-day operating instructions for the health sync system.

---

## 1. Core Commands

### Unified sync
```bash
node scripts/unified_health_sync.js
```

### Outcome backfill
```bash
node scripts/backfill_meal_outcomes.js
```

### Audit
```bash
node scripts/audit_health_sync.js
```

### Repair
```bash
node scripts/repair_health_sync.js --since 2026-03-19 --apply
```

---

## 2. Normal Operating Schedule

### Every 15 minutes
Run unified sync.

### Every 30 minutes
Run backfill for meals older than threshold.

### Daily at 9:45 AM PT
Run discrepancy audit and produce summary report.

### On manual edits to health_log.md
Run unified sync immediately.

---

## 3. Healthy System Expectations

A healthy run means:
- no duplicate creates
- photo-bearing meals appear in gallery
- Notion has Photo URL set
- outcome fields fill after eligibility window
- audit finds zero or near-zero discrepancies

---

## 4. Triage Workflow

### Symptom: duplicate Nightscout record
1. Run audit
2. Identify duplicate group by `entry_key`
3. Confirm canonical entry in normalized data
4. Delete duplicate treatment(s)
5. Ensure sync_state retains correct treatment ID
6. Re-run unified sync

### Symptom: missing photo in gallery
1. Confirm `photo_urls[]` exists in normalized entry
2. Confirm gallery projection generated entry
3. Confirm JSON pushed to site repo
4. Re-run unified sync
5. If still missing, run repair for date range

### Symptom: missing Photo URL in Notion
1. Query page by `entry_key` or date/title
2. Check `Photo` property
3. PATCH `Photo` from canonical `photo_urls[0]`
4. Re-run audit

### Symptom: missing rise/peak
1. Confirm entry age > backfill threshold
2. Confirm Nightscout glucose window exists
3. Run backfill manually
4. Confirm Notion and gallery patched

---

## 5. Incident Severity Levels

### Sev 1
- widespread duplicate creation
- sync pipeline failing entirely
- Nightscout or Notion writes failing for all entries

### Sev 2
- outcomes backfill stalled
- gallery not updating
- isolated duplicate cluster

### Sev 3
- one missing photo URL
- one stale Notion page
- one non-critical discrepancy

---

## 6. Manual Recovery Rules

### Allowed manual recovery
- remove duplicates
- patch one Notion page
- rebuild gallery JSON
- rerun backfill over bounded range

### Avoid unless necessary
- hand-editing gallery JSON as routine workflow
- manually creating Notion duplicates
- re-posting entries to Nightscout without checking sync_state

---

## 7. Daily Checklist

- unified sync succeeded within last hour
- backfill succeeded within last hour
- no audit discrepancy spike
- gallery reflects latest photo-bearing meals
- Notion photo property filled for latest meals

---

## 8. Weekly Checklist

- review sync error log
- inspect duplicate count trend
- inspect backfill lag trend
- validate Notion schema still matches expectations
- verify cron jobs still healthy

---

## 9. Logging Expectations

### sync_runs.jsonl
Each line should include:
- timestamp
- entries_seen
- entries_created
- entries_updated
- entries_skipped
- errors
- duration_ms

### sync_errors.jsonl
Each line should include:
- timestamp
- entry_key
- subsystem
- operation
- error_class
- error_message
- retryable

---

## 10. Escalation Criteria

Escalate to implementation/debug work when:
- duplicates appear in 2 consecutive days
- backfill delay exceeds 4 hours
- gallery misses >1 photo-bearing meal in a day
- Notion fill rate drops below 95%

---

## 11. Safe Rollback Plan

If unified sync introduces bad writes:
1. disable cron for unified sync
2. preserve sync logs
3. export recent normalized entries
4. restore last good gallery JSON
5. use repair script on bounded range
6. re-enable after fix validation
