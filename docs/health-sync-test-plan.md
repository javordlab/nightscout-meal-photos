# Health Sync Test Plan
**Purpose:** verify correctness, idempotency, and recoverability of the unified health sync system.

---

## 1. Test Objectives

Validate that the new system:
- does not create duplicates
- propagates photos correctly
- updates Notion and gallery consistently
- backfills actual outcomes correctly
- survives reruns and partial failures safely

---

## 2. Test Categories

### Unit tests
- parser
- photo extraction
- entry_key generation
- content_hash generation
- outcome calculation
- sync_state read/write behavior

### Integration tests
- Nightscout upsert
- Notion upsert/PATCH
- gallery generation
- end-to-end pipeline

### Recovery tests
- rerun same sync twice
- fail Notion write, then retry
- fail gallery generation, then retry
- repair duplicate cluster

---

## 3. Core Test Cases

## 3.1 Parsing Tests
### Case P1
Input: food row with one photo  
Expected: one photo URL extracted, title stripped cleanly

### Case P2
Input: food row with multiple photos  
Expected: ordered `photo_urls[]`

### Case P3
Input: medication row  
Expected: no photo URLs, no meal-type assumptions

### Case P4
Input: malformed row  
Expected: validation failure or warning as configured

---

## 3.2 Identity Tests
### Case I1
Same logical row parsed twice  
Expected: same `entry_key`

### Case I2
Content edit with same identity  
Expected: same `entry_key`, changed `content_hash`

### Case I3
Two distinct meals same day  
Expected: different `entry_key`

---

## 3.3 Nightscout Tests
### Case N1
New food entry sync  
Expected: one treatment created, ID stored

### Case N2
Rerun same sync  
Expected: no duplicate treatment created

### Case N3
Edited entry sync  
Expected: existing treatment updated or matched deterministically

---

## 3.4 Notion Tests
### Case O1
New food entry with photo  
Expected: page created, Photo property populated

### Case O2
Rerun same sync  
Expected: same page patched or skipped, no duplicate page

### Case O3
Backfill outcomes  
Expected: existing page updated with actual outcome fields

---

## 3.5 Gallery Tests
### Case G1
New food entry with photo  
Expected: appears in gallery JSON once

### Case G2
Rerun sync  
Expected: still one gallery record

### Case G3
Outcome backfill runs  
Expected: delta/peak values appear in gallery JSON

---

## 3.6 End-to-End Tests
### Case E1
Create breakfast with photo  
Expected:
- Nightscout has one entry
- Notion has one page with Photo URL
- gallery shows one photo item

### Case E2
Wait >2h and run backfill  
Expected:
- actual outcomes computed
- Notion updated
- gallery updated

### Case E3
Run unified sync twice  
Expected:
- no duplicates anywhere

---

## 3.7 Failure Tests
### Case F1
Nightscout succeeds, Notion fails  
Expected:
- failure logged
- retry remains possible
- no duplicate on retry

### Case F2
Gallery generation fails  
Expected:
- sync error logged
- downstream state recoverable on rerun

### Case F3
Cron missed one cycle  
Expected:
- next run catches up safely

---

## 4. Historical Validation Set

Use at least these sample real-world entries:
- Mar 19 17:36 strawberries and guava
- Mar 20 09:04 breakfast
- Mar 20 09:14 nuts + goji berries
- Mar 20 13:16 lunch
- Mar 20 16:13 protein ball

These reflect the exact classes of failures already seen.

---

## 5. Acceptance Test Script

### Test Day Procedure
1. log 3 fresh meals with photos
2. run unified sync
3. verify Nightscout, Notion, Gallery
4. rerun unified sync
5. verify no duplicates
6. wait until meals are backfill-eligible
7. run backfill
8. verify actual outcomes appear everywhere
9. run audit
10. verify discrepancy count = 0

---

## 6. Pass/Fail Criteria

### Pass
- zero duplicate records
- 100% photo propagation for test meals
- 100% Notion Photo property fill for test meals
- 100% gallery appearance for test meals
- outcomes populated after backfill window
- audit returns no unresolved discrepancies

### Fail
- any duplicate created by rerun
- any photo-bearing meal missing from gallery
- any Notion page missing Photo property after sync
- any eligible meal missing outcomes after backfill run

---

## 7. Regression Tests

After release, repeat:
- 7-day rolling duplicate test
- recent-photo propagation test
- backfill latency test
- Notion property completeness test

---

## 8. Reporting

Each test run should capture:
- date/time
- test dataset used
- pass/fail by case
- discrepancies found
- links/IDs of affected Nightscout treatments and Notion pages
