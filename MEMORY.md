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

## Core Operational Protocols
- **Radial Architecture:** `health_log.md` is the only SSoT. All syncs (Notion, Nightscout, MySQL) must trigger every 30 minutes and after any manual log update.
- **Reporting (9:30 AM PT Daily):** Must include 24-hour summary (Avg, TIR, GMI), 14-day trends (GMI, Avg, TIR, CV), Nutrition (24h full + 14d avg), Medication status, Outliers, and Supervisor Analysis. Use emojis/bolding.
- **Projections & Outcomes:** Every Food entry MUST have `Predicted Peak BG` and `Predicted Peak Time` calculated immediately upon logging. After meal completion (~3 hours), automatically backfill actual outcomes: `Pre-Meal BG`, `2hr Peak BG`, `Peak Time`, `BG Delta`, `Time to Peak (min)`, `Peak BG Delta`, and `Peak Time Delta (min)`. Automated backfill runs every 2 hours via cron.
- **Silent Logging:** Food, Medication, and Exercise entries are auto-logged immediately without confirmation. Photos are optional — log the entry either way.
- **Real-time Context:** Every manual log entry (Food, Medication, Activity) MUST include the most recent glucose value from Nightscout in the response and the log note.
- **Data Integrity:** All dashboard data and visual charts must be pushed to GitHub at the end of every sync cycle.

## Infrastructure
- **Nightscout:** https://p01--sefi--s66fclg7g2lm.code.run (Secret: JaviCare2026)
- **Photos:** https://javordlab.github.io/nightscout-meal-photos/

## Model Usage Reference (OpenAI shared traffic)
- OpenAI shared free daily token tiers:
  - **250K/day**: gpt-5.4, gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5, gpt-5-codex, gpt-5-chat-latest, gpt-4.1, gpt-4o, o1, o3.
  - **2.5M/day**: gpt-5.1-codex-mini, gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, o1-mini, o3-mini, o4-mini, codex-mini-latest.
- Important correction from Javi: this second tier is **2.5M** (not 2M).
