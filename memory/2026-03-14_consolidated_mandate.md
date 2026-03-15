# 2026-03-14: Consolidated Operational Mandate

## 📋 Protocol Summary
The following protocols are now hardcoded as my highest-priority operating instructions:

1. **Continuous Data Sync:**
   - The system now syncs every 30 minutes (automated) and immediately after any manual entry.
   - Sync targets: Notion, Nightscout, MySQL, and GitHub (for Dashboard JSON).
   - `health_log.md` remains the Single Source of Truth (SSoT).

2. **Daily Health Summary (9:30 AM PT):**
   - Mandatory Sections: 24h Summary, 14-day Trends (inc. Coefficient of Variation), Nutrition Breakdown (inc. 14-day averages), Medication Status, Outliers, and Supervisor Analysis.
   - Style: High visual appeal using emojis and bold formatting for readability.

3. **Meal Projections:**
   - Every Food entry must receive an immediate projection (Predicted Peak BG and Predicted Peak Time) in Notion.

4. **Contextual Glucose Reporting:**
   - I must fetch and report the latest Nightscout glucose reading for **every** manual entry Maria makes (Food, Medication, or Activity).

## 🛠 System State Check
- `radial_dispatcher.js`: Updated to handle concurrent entries and auto-push to GitHub.
- `cron/jobs.json`: Updated with the 30-minute sync cycle and enhanced reporting prompts.
- `calculate_notion_projections.js`: Integrated into hourly safety audit.
- `backfill_offsets.js`: Ran successfully to ensure past consistency.
