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
- **Timestamps:** EVERY entry must include the explicit PST/PDT offset.
  - Example: `2026-03-14 | 09:00 -07:00`
- **Real-time Context:** Manual entries (Food, Activity, Medication) MUST fetch the most recent glucose value from Nightscout and include it in the log note: `(BG: 145 mg/dL Rising)`.
- **Food Projections:** Every Food entry MUST have a `Predicted Peak BG` and `Predicted Peak Time`.
  - Formula: `Peak = 120 + (carbs * 3.5)`, capped at 300.
  - Time: `Meal Time + 105 minutes`.

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
