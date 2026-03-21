# Health Sync Migration Plan
**Purpose:** move from the current fragmented sync model to the unified pipeline with minimal disruption.

---

## 1. Migration Goals

- preserve current data
- stop duplicate creation
- establish stable identity and sync linkage
- move to upsert-based downstream writes
- introduce automated backfill and audit safely

---

## 2. Migration Strategy

Use an incremental migration, not a hard cutover.

### Principle
For a short period, the current system remains readable while the new system builds state in parallel. Then switch traffic to the unified pipeline.

---

## 3. Migration Phases

## Phase A — Inventory and Snapshot
**Duration:** half day

### Tasks
- snapshot current `health_log.md`
- snapshot current Nightscout treatments in scope
- snapshot current Notion meal pages in scope
- snapshot current gallery JSON
- export current discrepancy list

### Deliverables
- baseline backup artifacts
- date-bounded audit scope

---

## Phase B — Build Identity Without Changing Behavior
**Duration:** 1 day

### Tasks
- generate normalized entries from existing log
- assign `entry_key` and `content_hash`
- build initial `sync_state.json`
- map current Nightscout / Notion / Gallery artifacts to entry keys where possible

### Deliverables
- first populated sync ledger
- unresolved mapping report for ambiguous items

---

## Phase C — Reconcile Historical Drift
**Duration:** 1 day

### Tasks
- detect duplicates
- detect missing Notion photo URLs
- detect missing gallery entries
- detect missing outcome columns
- resolve historical data over a bounded recent window first (e.g. last 14 days)

### Deliverables
- repaired recent history
- clean recent baseline

---

## Phase D — Activate Unified Sync for New Entries
**Duration:** 1 day

### Tasks
- disable blind POST paths in legacy scripts
- route new sync activity through `unified_health_sync.js`
- log every run
- validate one full day of new entries

### Deliverables
- new writes handled only by unified pipeline

---

## Phase E — Activate Outcome Backfill
**Duration:** 1 day

### Tasks
- enable scheduled backfill
- patch Notion and gallery from canonical source
- verify latency and correctness

### Deliverables
- automatic outcomes for new meals

---

## Phase F — Activate Audit and Alerting
**Duration:** half day

### Tasks
- run daily audit automatically
- produce summary discrepancy report
- set alert thresholds

### Deliverables
- drift becomes visible automatically

---

## 4. Cutover Criteria

Switch fully to unified pipeline when all are true:
- sync_state populated for recent history
- no unresolved ambiguous mapping for recent 14 days
- one full day of new entries processed without duplicates
- gallery and Notion photo propagation validated
- outcome backfill validated on at least 3 meals

---

## 5. Legacy Decommission Plan

Once cutover succeeds:
- retire or archive old ad-hoc sync scripts
- keep read-only copies for reference
- update cron jobs to call only new scripts
- document decommissioned paths

---

## 6. Data Reconciliation Priorities

### Priority 1
Last 7 days

### Priority 2
Last 30 days

### Priority 3
Historical archive as needed

Reason: recent correctness matters most operationally.

---

## 7. Migration Risks

### Risk: ambiguous mapping between old records and canonical entries
**Mitigation:** use timestamp + title + photo URL + carbs to score matches

### Risk: duplicate deletion removes correct record
**Mitigation:** bounded-date dry runs first, retain exported snapshots

### Risk: Notion schema mismatch during PATCH
**Mitigation:** add preflight schema validation step

### Risk: cron overlap during cutover
**Mitigation:** disable legacy writer cron before enabling unified writer cron

---

## 8. Rollback Plan

If cutover fails:
1. disable unified cron jobs
2. restore last known-good gallery JSON
3. preserve sync_state and error logs
4. revert to legacy read path only if necessary
5. use repair script after bug fix

---

## 9. Success Conditions

Migration is successful when:
- recent history is reconciled
- new entries stay clean without manual fixes
- audit discrepancies remain near zero
- no duplicate generation occurs after cutover
