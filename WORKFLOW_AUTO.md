# WORKFLOW_AUTO.md - Radial Architecture & Health Guard Protocols

## Single Source of Truth (SSoT)
- **Primary Log:** `/Users/javier/.openclaw/workspace/health_log.md` is the absolute SSoT.
- **Sync Direction:** Log Updates -> `radial_dispatcher.js` -> (Notion + MySQL + Nightscout).
- **Manual Overrides:** Any manual changes to Notion or MySQL are considered ephemeral and will be overwritten by the next Radial Sync.

## Synchronization Protocol
- **Frequency:** Every 30 minutes (0, 30 * * * *) via cron `radial-sync-30m`.
- **Atomic Execution:** Trigger `node scripts/radial_dispatcher.js` after any manual entry.
- **Verification:** Every sync must verify Notion and MySQL status; if failure occurs, retry once then alert.

## Data Entry Standards
- **Timestamps:** EVERY entry must include the explicit host timezone offset (auto-detected at runtime, never hardcoded).
  - Example: `2026-03-14 | 09:00 -07:00` (offset derived from host, not hardcoded)
- **Real-time Context:** Manual entries (Food, Activity, Medication) MUST fetch the most recent glucose value from Nightscout and include it in the log note: `(BG: 145 mg/dL Rising)`.
- **Food Projections:** Every Food entry MUST have a `Predicted Peak BG` and `Predicted Peak Time`. **Use Model v5 (calibrated 2026-07-23 on prospective post-v4 data). Do NOT use old coefficients.** Full formula and tables in `AGENTS.md` under "PEAK BG PREDICTION FORMULA v5" — do not duplicate here. Summary:
  - **Layer 1 — Carb factor (Metformin-adjusted, monotonically declining):** 0–15g→×2.0, 16–30g→×1.2, 31–50g→×0.9, 51+g→×0.8
  - **Layer 2 — Meal-type intercept:** Breakfast +20, Lunch 0, Dinner 0, Snack 0, Dessert −10
  - **Layer 2.4 — Protein term (NEW in v5):** `+ 0.3 × max(0, protein_g − 20)` (protein-heavy meals run hotter)
  - **Layer 2.5 — preBG damping:** `− 0.35 × (preBG − 115)` (high baselines regress down, low up)
  - **Layer 3 — Cumulative anchor:** if a prior food entry was logged within **1 hour**, sum carbs and use the FIRST item's preBG (not the current live BG)
  - **Layer 4 — Time-to-peak (n-weighted blend):** Breakfast +75 min | Lunch +70 | Dinner +65 | Snack +55 | Dessert +105
  - Formula: `Peak = preBG + (carbs × factor) + intercept + 0.3 × max(0, protein − 20) − 0.35 × (preBG − 115)`, capped at 300 mg/dL.
  - **Stale formula warning:** This file previously listed `Peak = 120 + (carbs * 3.5)` and a flat `+105 min` (superseded 2026-04-02 by Model v3), v3's coefficients (superseded 2026-06-12 by Model v4), and v4's (superseded 2026-07-23 by Model v5 — v4 under-predicted 51+g and protein-heavy meals by ~14). **Do not resurrect old coefficients.**

## Reporting Schedule (Daily 9:30 AM PT)
- **Mandatory Metrics:** 24h Avg, TIR (70-180), GMI/A1C, CV (Coefficient of Variation), and Outlier Analysis.
- **14-Day Trends:** Rolling 14-day TIR and GMI must be included to show trajectory.
- **Formatting:** Emojis for status (✅/⚠️/🚨), bold headers, and bullet points. 
- **Model Attribution:** Every report must explicitly state which AI model generated it.

## Dashboard Maintenance
- **GitHub Sync:** The `nightscout-meal-photos` repository must be updated with fresh `backups.json` on every MySQL sync.
- **Visuals:** Glucose trend graphs and calorie/carb weekly charts must be regenerated during the daily report window.

---
*This file is managed by Javordclaw-SSoT. Protocols are enforced by automation.*
