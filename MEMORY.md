# MEMORY.md — Long-Term Memory

## People
### Javier Ordonez (Javi)
- **Timezone:** America/Los_Angeles
- **Contact:** ordonez@gmail.com | Telegram: 8335333215
- **Notes:** Technical, precise, prefers honesty and directness.

### Maria Dennis
- **Details:** 73yo, 139 lbs, 5'0". Type 2 Diabetes (FreeStyle Libre 3).
- **Meds:** Metformin (1500mg nightly, ~9 PM), Lisinopril (10mg daily morning), Rosuvastatin (10mg every other morning).
- **Rosuvastatin Cycle:** Anchor date 2026-03-01 (taken).

## Operational Memory
- **Radial Architecture:** `health_log.md` is the only SSoT. One-way dispatch to external APIs.
- **Daily Summary (9:30 AM PT):** Pull glucose from Nightscout, intake from `health_log.md`. Generate 3 charts (glucose, calories, carbs). Post to "Food log" Telegram.
- **Reports:** Must include 24-hour GMI/A1C estimate, Outliers, and Supervisor Analysis.

## Infrastructure
- **Nightscout:** https://p01--sefi--s66fclg7g2lm.code.run (Secret: JaviCare2026)
- **Photos:** https://javordlab.github.io/nightscout-meal-photos/
