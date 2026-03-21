# Root Cause Analysis: Data Sync Issues
**Date:** 2026-03-20
**Scope:** Nightscout, Notion, Gallery Sync Pipeline

---

## Problem Statement
Daily manual fixes required for:
1. Missing photos in gallery
2. Duplicate records in Nightscout/Notion
3. Missing photo URLs in Notion entries
4. Missing rise/peak data in gallery
5. Notion columns not backfilled after 2-hour meal window

---

## The 5 Whys Analysis

### Issue 1: Missing Photos in Gallery
**Why?** Gallery JSON not updated when new entries added  
**Why?** No automated trigger connects health_log.md → gallery  
**Why?** Gallery was built as separate component from radial sync  
**Why?** No unified pipeline architecture defined  
**Why?** Each sync target (Nightscout, Notion, Gallery) was built independently

**Root Cause:** Fragmented architecture with 3 separate sync paths instead of one unified pipeline.

---

### Issue 2: Duplicate Records
**Why?** Same entries pushed multiple times  
**Why?** radial_dispatcher doesn't check for existing entries before POST  
**Why?** No deduplication logic in sync scripts  
**Why?** Nightscout API doesn't enforce unique constraints  
**Why?** SSoT (health_log.md) has no sync-state tracking

**Root Cause:** No sync-state checkpoint system — can't determine "what's already synced."

---

### Issue 3: Missing Photo URLs in Notion
**Why?** Photo URL not extracted from health_log.md Entry field  
**Why?** radial_dispatcher parses markdown link syntax inconsistently  
**Why?** No standardized photo field in health_log schema  
**Why?** Photo URLs embedded in free-text Entry column  
**Why?** Schema designed for display, not machine parsing

**Root Cause:** Photo URLs trapped in markdown syntax within text fields instead of structured data.

---

### Issue 4: Missing Rise/Peak in Gallery
**Why?** Gallery JSON has null delta/peak values  
**Why?** Backfill script not running automatically  
**Why?** Cron job either failing or not configured  
**Why?** No health monitoring on cron jobs  
**Why?** Silent failures in background processes

**Root Cause:** No observability on background jobs — failures go unnoticed.

---

### Issue 5: Notion Columns Not Backfilled
**Why?** Actual outcomes not written to Notion after 2 hours  
**Why?** Backfill process doesn't target Notion API  
**Why?** Notion sync is one-way (create only, no update)  
**Why?** Page IDs not stored after creation  
**Why?** No bi-directional sync architecture

**Root Cause:** Notion entries created but never updated — no persistent ID mapping.

---

## Systemic Solutions (In Priority Order)

### 1. Unified Sync Architecture — Single Source of Truth Pipeline
**Current:** 3 separate scripts (radial_dispatcher, gallery updater, manual fixes)  
**Target:** One orchestrated pipeline with stages

```
health_log.md 
    → Parse & Validate
    → Deduplicate (by hash of date+user+type+entry)
    → Enrich (fetch glucose outcomes if >2hrs old)
    → Sync Stage 1: Nightscout (with idempotency check)
    → Sync Stage 2: Notion (create or update by page_id)
    → Sync Stage 3: Gallery JSON (append only new)
    → Checkpoint: Mark as synced
```

### 2. Add Sync State Tracking
Create `sync_state.json`:
```json
{
  "entries": {
    "2026-03-20T16:13:00-Maria-Food": {
      "hash": "sha256:abc123...",
      "nightscout_id": "69bde...",
      "notion_page_id": "32a85ec7...",
      "gallery_index": 0,
      "last_synced": "2026-03-20T17:30:00Z",
      "outcomes_backfilled": true
    }
  }
}
```

### 3. Structured Photo Schema
Change health_log.md from:
```markdown
| ... | Snack: Protein ball [📷](URL) | ... |
```

To explicit columns:
```markdown
| Date | User | Category | Type | Entry | Photo_URL | Carbs | Cals |
```

### 4. Cron Job Health Monitoring
- Add heartbeat to cron jobs (write to `cron_status.json`)
- Alert when cron hasn't reported in >1 hour
- Log all sync attempts with success/failure

### 5. Notion Update Capability
Store Notion page_id in sync_state, then PATCH updates instead of creating duplicates.

### 6. Automated Backfill Pipeline
Run every 2 hours:
- Query health_log for entries >2hrs old with null outcomes
- Fetch glucose from Nightscout API
- Calculate delta, peak, time_to_peak
- Update health_log.md (source of truth)
- Propagate to Notion and Gallery

---

## Immediate Actions Required

| # | Action | Owner | ETA |
|---|--------|-------|-----|
| 1 | Create sync_state.json schema | Javi/Javordclaw | 2026-03-21 |
| 2 | Refactor radial_dispatcher with idempotency | Javordclaw | 2026-03-22 |
| 3 | Add Photo_URL column to health_log.md | Javi | 2026-03-21 |
| 4 | Build unified pipeline script | Javordclaw | 2026-03-23 |
| 5 | Add cron monitoring/alerting | Javordclaw | 2026-03-24 |
| 6 | Test end-to-end with 3 new entries | Both | 2026-03-25 |

---

## Success Metrics
- Zero manual fixes required for 7 consecutive days
- Gallery auto-updates within 5 minutes of health_log.md commit
- Duplicate rate: 0%
- Backfill completion rate: 100% (within 2 hours of meal)
- Notion column population: 100%

---

## Decision Required
Do you want me to:
1. **Implement the unified pipeline** (2-3 days work)
2. **Patch current system** with quick fixes (1 day, but tech debt remains)
3. **Design v2 architecture** from scratch (1 week, but future-proof)
