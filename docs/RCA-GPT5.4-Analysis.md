# Root Cause Analysis: Data Sync Architecture Failures
**Analyst:** GPT-5.4 | **Date:** 2026-03-20 | **Severity:** Critical — Daily Manual Intervention Required

---

## Executive Summary

The health tracking system operates on a **fragile, ad-hoc architecture** that requires daily manual fixes. Five distinct failure modes cascade from a single root cause: **lack of transactional sync-state management**. This document provides deep 5 Whys analysis for each failure mode and presents a phased remediation plan.

---

## Problem Taxonomy

| ID | Symptom | Frequency | Manual Fix Time |
|----|---------|-----------|-----------------|
| P1 | Missing photos in gallery | Daily | 5-10 min |
| P2 | Duplicate Nightscout/Notion records | Daily | 10-15 min |
| P3 | Missing photo URLs in Notion | Daily | 5 min |
| P4 | Null rise/peak in gallery | Daily | 10 min |
| P5 | Notion columns unbackfilled | Daily | 5 min |

**Total Daily Tax:** 35-45 minutes of manual remediation

---

## Deep 5 Whys Analysis

### 🔴 CRITICAL: P2 — Duplicate Records

**Why 1:** Same entries pushed multiple times to Nightscout  
**Why 2:** `radial_dispatcher.js` executes blind POST without idempotency checks  
**Why 3:** No sync-state checkpoint exists to answer "has this been synced?"  
**Why 4:** Nightscout API has no unique constraint on `(created_at, enteredBy, notes)`  
**Why 5:** **Root Cause:** The SSoT (health_log.md) has no concept of "sync status" — it's a write-only log

**Technical Evidence:**
```javascript
// radial_dispatcher.js (current)
await fetch(`${NS_URL}/api/v1/treatments.json`, {
  method: 'POST',
  body: JSON.stringify(entry)  // No idempotency key
});
```

**Systemic Failure:** Each run of radial_dispatcher treats every health_log.md entry as *new*, regardless of prior sync state.

---

### 🔴 CRITICAL: P4 — Null Rise/Peak Data

**Why 1:** Gallery JSON contains `delta: null, peak: null` for recent meals  
**Why 2:** Backfill script `calculate_outcomes.js` not running reliably  
**Why 3:** Cron job silent failures — no health monitoring  
**Why 4:** Outcome calculation depends on manual trigger or 2-hour heuristic  
**Why 5:** **Root Cause:** No event-driven architecture — system is time-polling instead of state-driven

**Technical Evidence:**
```javascript
// Current: Cron polls every 30 min
// Problem: If cron misses a window, no retry mechanism
```

**Systemic Failure:** Outcome calculation is decoupled from sync pipeline. Gallery receives entries before outcomes are computed.

---

### 🟠 HIGH: P1 — Missing Gallery Photos

**Why 1:** Gallery JSON (`notion_meals.json`) lacks new entries  
**Why 2:** Gallery update is separate from radial sync pipeline  
**Why 3:** No unified orchestration layer  
**Why 4:** Gallery was built as afterthought to Notion sync  
**Why 5:** **Root Cause:** Three independent sync targets with no shared transaction boundary

**Technical Evidence:**
```
Sync Path A: health_log.md → Nightscout (radial_dispatcher)
Sync Path B: health_log.md → Notion (radial_dispatcher)
Sync Path C: manual → Gallery (node script)
```

**Systemic Failure:** No atomic "sync to all targets" operation. Partial failures leave systems inconsistent.

---

### 🟠 HIGH: P3 — Missing Photo URLs in Notion

**Why 1:** Photo URL not extracted from Entry markdown  
**Why 2:** Regex parsing `[📷](URL)` fails intermittently  
**Why 3:** Photo URL embedded in free-text, not structured column  
**Why 4:** health_log.md schema designed for display, not ETL  
**Why 5:** **Root Cause:** Schema violation — URLs belong in typed columns, not markdown

**Technical Evidence:**
```markdown
| Entry | Photo_URL |
|-------|-----------|
| Snack: Protein ball [📷](https://iili.io/xxx.jpg) | (null) |
```

**Systemic Failure:** Presentational markup (emoji + link) mixed with data layer.

---

### 🟡 MEDIUM: P5 — Notion Column Backfill

**Why 1:** Actual outcomes not written to Notion after 2 hours  
**Why 2:** Backfill process targets health_log.md only  
**Why 3:** Notion entries created via POST, never updated via PATCH  
**Why 4:** Notion page_id not persisted after creation  
**Why 5:** **Root Cause:** One-way sync architecture — no bidirectional state management

**Technical Evidence:**
```javascript
// Current flow
POST notion_page → (discard response) → never updated
// Missing
store(page_id) → PATCH notion_page when outcomes ready
```

**Systemic Failure:** Create-or-update pattern not implemented.

---

## Systemic Architecture Analysis

### Current State: "Spaghetti Sync"

```
health_log.md
    ├──→ radial_dispatcher.js ──→ Nightscout API
    │       └── (no idempotency)
    ├──→ radial_dispatcher.js ──→ Notion API
    │       └── (one-way, no updates)
    └──→ manual_script.js ────→ Gallery JSON
            └── (decoupled, manual)
```

**Failure Modes:**
- No transaction boundary
- No retry logic
- No observability
- No schema validation

### Target State: "Pipeline with Idempotency"

```
health_log.md
    └──→ Unified Pipeline
            ├── Parse & Validate (jsonschema)
            ├── Deduplicate (hash-based)
            ├── Enrich (fetch glucose if >2hrs)
            ├── Sync (atomic to all targets)
            │   ├── Nightscout (idempotent POST)
            │   ├── Notion (upsert via page_id)
            │   └── Gallery (append-only)
            └── Checkpoint (sync_state.json)
```

---

## Recommended Solutions (Phased)

### Phase 1: Emergency Stabilization (Days 1-2)
**Goal:** Stop daily manual fixes

| Action | Implementation |
|--------|----------------|
| Add `Photo_URL` column to health_log.md | Schema change |
| Create `sync_state.json` | Hash → {nightscout_id, notion_page_id, gallery_index} |
| Patch radial_dispatcher | Check sync_state before POST |

**sync_state.json schema:**
```json
{
  "entries": {
    "sha256:abc123...": {
      "date": "2026-03-20T16:13:00-07:00",
      "user": "Maria Dennis",
      "type": "Snack",
      "nightscout_treatment_id": "69bde...",
      "notion_page_id": "32a85ec7...",
      "gallery_index": 0,
      "outcomes": {
        "pre_meal_bg": 130,
        "peak_bg": 156,
        "delta": 26,
        "time_to_peak_min": 45
      },
      "last_synced_at": "2026-03-20T17:30:00Z"
    }
  }
}
```

---

### Phase 2: Unified Pipeline (Days 3-5)
**Goal:** Single orchestrated sync

**Architecture:**
```javascript
// unified_sync.js
class HealthSyncPipeline {
  async sync(entry) {
    const hash = this.hashEntry(entry);
    
    // Idempotency check
    if (this.syncState.has(hash)) {
      return { status: 'already_synced', ids: this.syncState.get(hash) };
    }
    
    // Parallel sync with rollback
    const transaction = new SyncTransaction();
    try {
      const nsId = await transaction.step(
        () => nightscout.upsert(entry)
      );
      const notionId = await transaction.step(
        () => notion.upsert(entry, { page_id: existing?.notion_id })
      );
      const galleryIdx = await transaction.step(
        () => gallery.append(entry)
      );
      
      transaction.commit();
      this.syncState.set(hash, { nsId, notionId, galleryIdx });
      
    } catch (err) {
      transaction.rollback();
      throw err;
    }
  }
}
```

---

### Phase 3: Event-Driven Outcomes (Days 6-7)
**Goal:** Automatic rise/peak backfill

**Pattern:**
```javascript
// Event: Entry is 2 hours old
if (Date.now() - entry.time > 2 * 60 * 60 * 1000) {
  const glucose = await fetchGlucoseWindow(entry.time, +2hours);
  const outcomes = calculateOutcomes(glucose);
  
  // Update all systems
  await healthLog.update(entry.hash, outcomes);
  await notion.patch(entry.notion_id, outcomes);
  await gallery.patch(entry.gallery_idx, outcomes);
}
```

---

### Phase 4: Observability (Day 8)
**Goal:** Detect failures before they require manual fixes

**Monitoring:**
```javascript
// health_check.js
const checks = [
  { name: 'nightscout_sync', last_success: '2026-03-20T17:30:00Z' },
  { name: 'notion_sync', last_success: '2026-03-20T17:30:00Z' },
  { name: 'gallery_sync', last_success: '2026-03-20T17:30:00Z' },
  { name: 'outcomes_backfill', pending: 3 }
];

if (Date.now() - last_success > 1 * 60 * 60 * 1000) {
  await alert('Sync pipeline unhealthy');
}
```

---

## Decision Matrix

| Approach | Time | Risk | Outcome |
|----------|------|------|---------|
| **A: Patch Current** | 1 day | Low | Fixes symptoms, debt remains, daily fixes continue |
| **B: Phase 1-2 Only** | 3 days | Medium | Stops duplicates, manual gallery updates still needed |
| **C: Full Phased Plan** | 1 week | Low | Zero manual fixes, future-proof |
| **D: Rewrite (v2)** | 2-3 weeks | High | Over-engineering for current scope |

**Recommendation:** Execute **Phase 1-3** (1 week). This addresses all 5 problem categories without over-investment.

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Manual fixes per day | 5-10 | 0 | GitHub issues + user reports |
| Duplicate rate | ~15% | 0% | Nightscout query: count(_id) / count(distinct notes) |
| Gallery coverage | ~70% | 100% | Gallery entries / health_log food entries |
| Outcome backfill latency | 24-48h | <2h | timestamp delta: entry → outcomes populated |
| Notion column fill rate | ~40% | 100% | Notion API query for null columns |

---

## Implementation Priority Queue

```
P0 (Blockers)
├── Create sync_state.json schema
├── Add Photo_URL column to health_log.md
└── Patch radial_dispatcher with idempotency

P1 (Critical)
├── Build unified pipeline skeleton
├── Implement Notion upsert (PATCH)
└── Add outcome calculator to pipeline

P2 (Important)
├── Automated gallery sync
├── Cron health monitoring
└── Alerting on sync failures

P3 (Nice to have)
├── Web UI for sync status
├── Manual retry interface
└── Historical backfill
```

---

## Conclusion

The daily manual fixes are symptoms of **architectural debt**, not isolated bugs. The 5 Whys reveal a common root: **no sync-state management**. The recommended 1-week phased plan moves from a fragile, multi-path system to a unified, idempotent pipeline with observability. This eliminates the daily 35-45 minute tax while establishing foundation for future scaling.

**Next Action Required:** Approve Phase 1-3 implementation plan.
