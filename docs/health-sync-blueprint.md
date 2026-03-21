# Health Sync Blueprint
**Date:** 2026-03-20
**Owner:** Javi + Javordclaw
**Scope:** health_log.md → Nightscout → Notion → Gallery
**Goal:** eliminate daily manual discrepancy fixing by moving to a unified, idempotent, monitored sync pipeline.

---

## 1. Executive Summary

The current system works, but only with frequent manual correction. The issues are not isolated bugs; they are symptoms of one architectural problem:

> We do not have a single stateful sync pipeline with durable record identity and update tracking.

This blueprint converts the RCA into an implementation plan.

It covers:
- what has already been done
- what remains to be built
- implementation phases
- timelines
- success metrics
- operating model after rollout

---

## 2. Desired End State

We want one canonical flow:

```text
health_log.md
  -> normalize entries
  -> validate fields
  -> assign stable entry_key + content_hash
  -> upsert to Nightscout
  -> upsert to Notion
  -> regenerate/update Gallery
  -> persist sync_state
  -> backfill actual outcomes after 2h
  -> patch Notion + Gallery + source state
  -> audit + alert on discrepancies
```

### End-state properties
- No duplicate records
- No missing photo URLs in Notion
- No missing photos in gallery
- Automatic rise/peak backfill
- Automatic Notion outcome updates
- Daily audit catches drift before humans do

---

## 3. What Has Already Been Done

These are the practical corrections and planning steps already completed.

### 3.1 Operational fixes already performed
- Deleted several duplicate and incorrect Nightscout records during troubleshooting
- Re-added missing entries with corrected timestamps and photos where needed
- Fixed at least one Notion entry by adding a proper Photo field URL
- Added the protein ball photo to the gallery JSON and pushed it to GitHub
- Updated recent gallery records with delta/peak values for recent meals
- Restored accidentally archived Notion pages during cleanup

### 3.2 Analysis already produced
- RCA document created: `docs/RCA-Data-Sync-Issues.md`
- Expanded RCA / 5 Whys / recommendations created: `docs/RCA-GPT5.4-Analysis.md`
- Unified strategic approach discussed and agreed in principle

### 3.3 What these completed actions mean
These actions reduced immediate pain, but they are still **manual repairs**, not systemic fixes.

So we should treat them as:
- **stabilization work**
- **evidence gathering**
- **requirements discovery**

—not as the final solution.

---

## 4. What Is Still Broken / Incomplete

### 4.1 Architecture gaps
- No durable `sync_state.json`
- No stable `entry_key` for each health entry
- No unified orchestrator script
- No safe upsert model for Nightscout and Notion
- Gallery still depends on ad-hoc regeneration logic

### 4.2 Data-model gaps
- Photo URLs are still embedded in markdown inside `Entry`
- Canonical source is human-readable but not machine-safe enough
- No structured representation of predicted vs actual outcome fields
- No durable linkage from source entry → Nightscout treatment → Notion page → Gallery item

### 4.3 Automation gaps
- Backfill of actual outcomes is not reliably automatic
- Notion updates after meal aging are not reliable
- Cron jobs are not sufficiently monitored
- No discrepancy scanner / audit pass exists as a first-class workflow

### 4.4 Recovery gaps
- No “repair mode” script that can detect and reconcile drift
- No authoritative log of sync attempts and failures
- No alert if one target diverges from the others

---

## 5. Guiding Principles

All implementation work should follow these principles.

### 5.1 One canonical source
The canonical truth is the normalized health entry model derived from `health_log.md`.

### 5.2 Idempotent writes only
Every create/update operation must be safe to run more than once.

### 5.3 Structured data over text parsing
Photo URLs, carbs, predictions, and outcomes should live in typed fields, not be inferred from free text.

### 5.4 Upsert, don’t recreate
Nightscout and Notion should be updated when records already exist.

### 5.5 Repair should be exceptional
The normal path should be automated. Repair scripts are for drift, migration, and rare exceptions.

### 5.6 Visibility over silence
Every sync run should produce a measurable result.

---

## 6. Proposed Target Components

## 6.1 Canonical normalized data
Create a machine-safe layer, for example:
- `data/health_log.normalized.json`

Each entry should include:
- `entry_key`
- `content_hash`
- timestamp
- category / meal type
- title / notes
- photo_urls[]
- carbs / calories
- predicted outcome fields
- actual outcome fields
- downstream sync identifiers

## 6.2 Sync ledger
Create:
- `data/sync_state.json`

Tracks, per entry:
- Nightscout treatment ID
- Notion page ID
- Gallery item ID
- last sync timestamp
- last content hash synced
- whether outcomes have been backfilled

## 6.3 Unified pipeline script
Create:
- `scripts/unified_health_sync.js`

Responsibilities:
- parse + normalize
- validate
- dedupe
- upsert downstream
- persist state
- log run result

## 6.4 Backfill worker
Create:
- `scripts/backfill_meal_outcomes.js`

Responsibilities:
- find meals older than threshold
- fetch glucose window from Nightscout
- compute pre-meal, peak, delta, time-to-peak
- patch normalized data
- patch Notion
- patch gallery

## 6.5 Audit / repair tool
Create:
- `scripts/audit_health_sync.js`
- `scripts/repair_health_sync.js`

Responsibilities:
- detect duplicates
- detect missing photo URLs
- detect missing gallery items
- detect missing outcomes
- produce a discrepancy report
- optionally auto-repair with explicit flag

## 6.6 Monitoring + run logs
Create:
- `data/sync_runs.jsonl`
- `data/sync_errors.jsonl`
- `data/cron_health.json`

---

## 7. Phased Implementation Plan

## Phase 0 — Stabilization and Freeze
**Window:** Day 0 to Day 1
**Goal:** Stop creating new inconsistency while architecture work starts.

### Tasks
- Freeze blind create behavior wherever possible
- Require pre-check before Nightscout POST
- Require pre-check before Notion create
- Stop adding photo URLs only in Notion title text for new fixes
- Stop manual gallery edits unless explicitly needed for recovery

### Deliverables
- Temporary guardrails on current scripts
- Known current discrepancy list captured

### Exit criteria
- No new duplicate records generated during the implementation window

---

## Phase 1 — Identity and Sync State Foundation
**Window:** Day 1 to Day 2
**Goal:** Give every entry durable identity and sync tracking.

### Tasks
- Define `entry_key` generation strategy
- Define `content_hash` generation strategy
- Implement `data/sync_state.json`
- Build utility functions for read/write/update of sync ledger
- Add unit-safe lookup helpers: by timestamp, by title, by photo, by hash

### Deliverables
- `sync_state.json` schema
- sync-state helper module
- stable entry identity model

### Exit criteria
- Every normalized entry can be mapped deterministically across systems

---

## Phase 2 — Structured Data Normalization
**Window:** Day 2 to Day 3
**Goal:** Stop relying on markdown parsing as the source integration contract.

### Tasks
- Build parser from `health_log.md` → normalized JSON
- Extract photo URLs into structured `photo_urls[]`
- Separate `title` from `notes`
- Preserve predictions as typed fields
- Add support for actual outcomes as typed fields

### Deliverables
- `data/health_log.normalized.json`
- parser/normalizer module

### Exit criteria
- Photo, carbs, calories, predictions, and outcomes can be read without regexing human prose

---

## Phase 3 — Unified Sync Orchestrator
**Window:** Day 3 to Day 5
**Goal:** Replace fragmented sync behavior with one idempotent pipeline.

### Tasks
- Implement `scripts/unified_health_sync.js`
- Nightscout upsert logic:
  - create if absent
  - update if record exists
  - store Nightscout treatment ID
- Notion upsert logic:
  - create if absent
  - patch existing page if present
  - store Notion page ID
- Gallery regeneration/update logic from normalized source
- Persist results to `sync_state.json`
- Add per-run logs to `sync_runs.jsonl`

### Deliverables
- One production sync command
- Upsert capability for all three downstream systems

### Exit criteria
- A full sync run produces no duplicates and no missing gallery/Notion photo linkage for new entries

---

## Phase 4 — Automated Outcome Backfill
**Window:** Day 5 to Day 6
**Goal:** Remove manual rise/peak and delayed Notion fixes.

### Tasks
- Build glucose-window fetcher from Nightscout entries API
- Define outcome rules:
  - pre-meal BG
  - peak BG
  - peak time
  - BG delta
  - time to peak
  - 2hr peak BG
  - optional prediction deltas
- Implement `scripts/backfill_meal_outcomes.js`
- Patch normalized state, Notion, and gallery with actual outcomes

### Deliverables
- Automatic backfill pipeline
- Typed actual outcome fields populated downstream

### Exit criteria
- Meals older than threshold auto-populate outcomes without manual intervention

---

## Phase 5 — Audit, Repair, and Monitoring
**Window:** Day 6 to Day 7
**Goal:** Detect and resolve drift before it becomes daily cleanup.

### Tasks
- Build `scripts/audit_health_sync.js`
- Build `scripts/repair_health_sync.js`
- Add cron health heartbeat
- Add discrepancy report output
- Alert when:
  - sync hasn’t succeeded recently
  - duplicates detected
  - pending backfill count too high
  - Notion/Gallery diverge from source

### Deliverables
- Daily audit report
- Repair command
- Monitoring artifacts

### Exit criteria
- We can detect divergence automatically and repair safely

---

## 8. Detailed Work Breakdown

## 8.1 Schema work
### To define
- normalized entry schema
- sync_state schema
- outcome fields schema
- gallery JSON schema

### Decision needed
Choose one of:
1. keep `health_log.md` as human-first source + normalized JSON as machine layer
2. migrate primary machine use to JSON/CSV and keep markdown as view

**Recommendation:** option 1 for now.

---

## 8.2 Nightscout work
### Needed
- Upsert strategy
- treatment ID persistence
- duplicate detection strategy
- optional embedded `entry_key` marker in notes for robust lookup

### Recommendation
Include a hidden/internal sync marker in notes or metadata where feasible so future reconciliation is deterministic.

---

## 8.3 Notion work
### Needed
- Use `Photo` property as canonical URL field
- Stop encoding photo URLs only in `Entry` title
- Persist page IDs for PATCH updates
- Patch all outcome fields after backfill

### Specific fields to standardize
- Entry
- Date
- User
- Category
- Meal Type
- Carbs (est)
- Calories (est)
- Photo
- Pre-Meal BG
- Predicted Peak BG
- Predicted Peak Time
- 2hr Peak BG
- Peak Time
- BG Delta
- Time to Peak (min)
- Peak BG Delta
- Peak Time Delta (min)

---

## 8.4 Gallery work
### Needed
- Generate from canonical normalized data
- Never hand-edit as normal flow
- Use one photo selection rule for multi-image meals
- Pull actual outcomes from canonical source after backfill

### Recommendation
Gallery should be treated as a **rendered projection**, not as a semi-independent data store.

---

## 8.5 Cron and operations work
### Needed
- schedule unified sync
- schedule outcome backfill
- schedule audit
- write heartbeat/health file

### Suggested schedule
- Unified sync: every 15 minutes
- Outcome backfill: every 30 minutes
- Audit: daily in morning + optional evening pass
- Drift alert if no successful run in > 60 minutes

---

## 9. Suggested Timeline

## Week 1 Plan
### Day 1
- Phase 0 complete
- start Phase 1
- finalize schemas for `entry_key`, `content_hash`, `sync_state`

### Day 2
- finish Phase 1
- build normalizer for `health_log.md`

### Day 3
- finish normalized JSON generation
- begin unified orchestrator

### Day 4
- Nightscout upsert + Notion upsert working
- state persistence working

### Day 5
- gallery generation integrated into orchestrator
- end-to-end sync test with fresh entries

### Day 6
- automated outcome backfill implemented
- Notion + gallery patches working

### Day 7
- audit + repair scripts
- discrepancy report
- cron health checks
- full validation

---

## 10. Acceptance Criteria by Phase

### Phase 1 accepted when:
- every entry has stable key and stored downstream IDs

### Phase 2 accepted when:
- photo URLs and outcome fields are machine-readable without parsing title text

### Phase 3 accepted when:
- one sync run updates Nightscout, Notion, and Gallery without duplicate creation

### Phase 4 accepted when:
- meals older than threshold automatically gain actual outcome data

### Phase 5 accepted when:
- discrepancies are detected automatically and surfaced before manual inspection is needed

---

## 11. Success Metrics

### Operational metrics
- 0 duplicate entries for 7 consecutive days
- 100% of photo-bearing meals appear in gallery
- 100% of photo-bearing Notion meal entries have Photo URL populated
- 100% of eligible meals older than 2h have outcomes filled
- 0 manual fixes required over 7 consecutive days

### Reliability metrics
- unified sync success rate >= 99%
- backfill success rate >= 99%
- audit discrepancy count trends toward 0

---

## 12. Risks and Mitigations

### Risk: Legacy bad data causes noisy migration
**Mitigation:** use audit + repair scripts on a bounded date range first

### Risk: Notion schema mismatch
**Mitigation:** validate schema before first rollout; add a schema assertion step

### Risk: Nightscout search ambiguity
**Mitigation:** embed deterministic entry key into sync mapping and treatment notes where appropriate

### Risk: Markdown parser edge cases
**Mitigation:** normalize into JSON early and test against historical rows

### Risk: Silent cron failures continue
**Mitigation:** heartbeat + alert threshold + sync run logs

---

## 13. Immediate Next Actions

### Decision: approved
User has approved creating the holistic blueprint and moving toward implementation.

### Next concrete execution steps
1. Create `sync_state.json` schema and helper module
2. Create normalized entry schema and parser
3. Refactor sync flow into one orchestrator
4. Add Notion PATCH / Nightscout upsert behavior
5. Integrate gallery generation into orchestrator
6. Add automated outcomes backfill
7. Add discrepancy audit and cron monitoring

---

## 14. Recommendation

Implement this as a **1-week structured remediation project**, not as another series of one-off fixes.

This is the minimum work needed to turn the current system from:
- reactive
- manual
- fragile
- duplication-prone

into one that is:
- stateful
- idempotent
- monitored
- maintainable

---

## 15. Status Snapshot

### Completed
- RCA complete
- architecture direction agreed
- blueprint created

### In progress
- transition from manual repair model to pipeline model

### Not started
- sync ledger
- unified orchestrator
- structured normalization
- outcome backfill worker
- automated audit/repair tooling
- monitoring layer

---

## 16. Proposed Follow-up Documents

After this blueprint, the next practical documents should be:
1. `docs/health-sync-schema.md`
2. `docs/health-sync-runbook.md`
3. `docs/health-sync-migration-plan.md`
4. `docs/health-sync-test-plan.md`

These will turn strategy into implementation.
