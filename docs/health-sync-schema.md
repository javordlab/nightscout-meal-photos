# Health Sync Schema
**Purpose:** define the canonical data model, sync ledger model, and downstream projection contracts.

---

## 1. Canonical Entry Model

Each health log row normalizes into one canonical entry object.

```json
{
  "entry_key": "sha256:...",
  "content_hash": "sha256:...",
  "source": {
    "file": "health_log.md",
    "line": 12,
    "raw_row": "| 2026-03-20 | 16:13 -07:00 | ..."
  },
  "timestamp": "2026-03-20T16:13:00-07:00",
  "date": "2026-03-20",
  "time": "16:13:00-07:00",
  "user": "Maria Dennis",
  "category": "Food",
  "meal_type": "Snack",
  "title": "Protein ball/hazelnut chocolate truffle",
  "notes": "BG: Unknown; Pred: 145-165 mg/dL @ 6:00 PM",
  "photo_urls": ["https://iili.io/qe1AVUl.jpg"],
  "carbs_est": 25,
  "calories_est": 200,
  "predicted": {
    "pre_meal_bg": null,
    "peak_bg": 155,
    "peak_bg_range": [145, 165],
    "peak_time": "2026-03-20T18:00:00-07:00"
  },
  "actual": {
    "pre_meal_bg": null,
    "peak_bg": null,
    "peak_time": null,
    "bg_delta": null,
    "time_to_peak_min": null,
    "peak_bg_delta": null,
    "peak_time_delta_min": null,
    "two_hour_peak_bg": null
  },
  "sync": {
    "nightscout": "pending",
    "notion": "pending",
    "gallery": "pending",
    "outcomes_backfilled": false
  }
}
```

---

## 2. Identity Rules

### 2.1 entry_key
Stable identity for a logical record.

Recommended derivation:
```text
sha256(timestamp + user + category + meal_type + normalized_title)
```

### 2.2 content_hash
Detects whether the content changed and downstream patches are needed.

Recommended derivation:
```text
sha256(canonical JSON without sync metadata)
```

---

## 3. Allowed Category Values

- `Food`
- `Medication`
- `Activity`
- `Note`

## 4. Allowed Meal Type Values

- `Breakfast`
- `Lunch`
- `Dinner`
- `Snack`
- `Dessert`
- `-`

---

## 5. Parsing Rules from health_log.md

### Source columns today
```text
Date | Time | User | Category | Meal Type | Entry | Carbs | Cals
```

### Normalization rules
- `Date + Time` -> ISO timestamp with PST/PDT offset preserved
- `Entry` -> split into:
  - `title`
  - `notes`
  - `photo_urls[]`
- `Carbs` -> `carbs_est`
- `Cals` -> `calories_est`

### Photo extraction
Extract all markdown photo links from Entry:
```markdown
[📷](https://...)
```
Store as ordered array in `photo_urls[]`.

### Title extraction
Remove markdown photo links from the human title text.

---

## 6. Sync Ledger Schema

File:
- `data/sync_state.json`

```json
{
  "version": 1,
  "entries": {
    "sha256:abc123": {
      "content_hash": "sha256:def456",
      "timestamp": "2026-03-20T16:13:00-07:00",
      "nightscout": {
        "treatment_id": "69bde76a911a8ea261e673da",
        "last_synced_at": "2026-03-21T03:10:00Z"
      },
      "notion": {
        "page_id": "32a85ec7-0668-812d-8d6e-c666a6a5231a",
        "last_synced_at": "2026-03-21T03:10:10Z"
      },
      "gallery": {
        "gallery_id": "manual-2026-03-20-16:13-07:00",
        "last_synced_at": "2026-03-21T03:10:12Z"
      },
      "outcomes_backfilled": false,
      "last_audited_at": null
    }
  }
}
```

---

## 7. Nightscout Projection Schema

### Event types
- Food -> `Meal Bolus`
- Medication -> `Note`
- Activity -> `Exercise`

### Required fields
- `enteredBy`
- `eventType`
- `created_at`
- `notes`

### Recommended fields
- `carbs`
- internal `entry_key` marker in notes when possible

### Notes format recommendation
Human-readable first, machine marker last:
```text
Snack: Strawberries and guava (BG: 85 mg/dL Flat) (~18g carbs, ~90 kcal) 📷 https://iili.io/qexq4LB.jpg [entry_key:sha256:abc123]
```

---

## 8. Notion Projection Schema

### Required properties
- `Entry` (title)
- `Date` (date)
- `User` (select)
- `Category` (select)
- `Meal Type` (select)
- `Carbs (est)` (number)
- `Calories (est)` (number)
- `Photo` (url)

### Outcome properties
- `Pre-Meal BG`
- `Predicted Peak BG`
- `Predicted Peak Time`
- `2hr Peak BG`
- `Peak Time`
- `BG Delta`
- `Time to Peak (min)`
- `Peak BG Delta`
- `Peak Time Delta (min)`

### Notion rules
- Title should stay human-readable
- Photo URL goes in `Photo`, not only in title text
- PATCH existing page when `page_id` exists

---

## 9. Gallery Projection Schema

File:
- `nightscout-meal-photos/data/notion_meals.json`

```json
{
  "id": "manual-2026-03-20-16:13-07:00",
  "entry_key": "sha256:abc123",
  "title": "Snack: Protein ball/hazelnut chocolate truffle",
  "type": "Snack",
  "date": "2026-03-20T16:13:00.000-07:00",
  "photo": "https://iili.io/qe1AVUl.jpg",
  "carbs": 25,
  "cals": 200,
  "preMeal": 130,
  "delta": 26,
  "peak": 156
}
```

### Gallery rules
- derived from canonical normalized entries only
- `photo` = first photo URL
- no manual edits in normal operation

---

## 10. Validation Rules

### Hard validation failures
- missing timestamp
- invalid timezone offset
- unknown category
- malformed photo URL
- non-numeric carbs/cals where numeric expected

### Soft validation warnings
- food entry without carbs estimate
- food entry with photo link but empty photo_urls after parse
- actual outcomes missing for entry older than threshold

---

## 11. Recommended Future Source Columns

If health_log.md is expanded, preferred source columns are:

```text
Date | Time | User | Category | Meal Type | Title | Notes | Photo_URL | Carbs | Cals | Pred Peak BG | Pred Peak Time | Pre-Meal BG | Actual Peak BG | Actual Peak Time | BG Delta | Time to Peak
```

Until then, normalization from current markdown format remains acceptable.
