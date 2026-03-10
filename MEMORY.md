# MEMORY.md — Long-Term Memory

_Last updated: 2026-03-09 12:15 PM PST_

## People

### Javier Ordonez (Javi)
- Email: ordonez@gmail.com
- Telegram ID: 8335333215
- GitHub: javordlab (private repo: openclaw-workspace)
- Timezone: America/Los_Angeles
- Technical, asks good questions, catches inconsistencies — be precise and honest

### Maria Dennis (Javi's wife)
- Type 2 Diabetes, FreeStyle Libre 3 CGM
- Telegram ID: 8738167445
- Profile: 73-year-old female, 139 lbs, 5'0" tall.
- Speaks English and Spanish
- Communicates primarily via voice messages in Telegram group
- Medication: 1500mg Metformin HCL (nightly, ~9 PM); 10mg Lisinopril (daily morning); 10mg Rosuvastatin (every other morning).
- **Anchor date for Rosuvastatin cycle:** 2026-03-01 (Sunday) taken; next due dates include 2026-03-03 (Tuesday), 2026-03-05 (Thursday), 2026-03-07 (Saturday), etc.
- **Calorie Logging (DEFINITIVE):** As of 2026-03-06, all food entries must include calories and carbs in the local `health_log.md` using the specific column format: | Date | Time | User | Category | Entry | Carbs | Cals |

## Protocols

### 💓 Heartbeat Status (CRITICAL)
- **Silence Rule:** As of 2026-03-05 9:45 PM, heartbeats must be COMPLETELY silent. 
- **Rule:** If all checks pass, the response must be EXACTLY: HEARTBEAT_OK
- **Auto-Sync:** Heartbeats must automatically run `git add . && git commit -m "chore: heartbeat sync" && git push origin main` to keep the workspace clean.

### 🛡️ Radial Architecture (SSoT)
- **Single Source of Truth (SSoT):** `/workspace/health_log.md` is the **only** definitive source.
- **One-Way Dispatch:** All other platforms (Nightscout, Notion, GitHub Gallery) are strictly downstream mirrors. 
- **Dispatcher:** Use `node scripts/radial_dispatcher.js` to push from the local log to external APIs.
- **Strict Rule:** Never pull data *from* Notion/Nightscout back into the local log. Fix errors in `health_log.md` first.
- **Local-First Enforcement:** No downstream changes are allowed until `health_log.md` is updated first; run `node scripts/consistency_check.js 2` as a gate.

### 📊 Daily Summary Protocol
- **Time:** 9:30 AM PT daily.
- **Priority Order (Javi-confirmed):**
  1. Accuracy first
  2. Escalation Notification: Notify Javi if a task or cron job escalates to a high-tier model (e.g., `gpt-5.3-codex`) due to failure or complexity. State the reason (e.g., "escalating due to gemini-3-flash timeout").
  2. If accurate, send on time
  3. If not accurate by send time, send a delay notice with ETA, then deliver when ready
- **Source:** Use `health_log.md` for all intake (calories/carbs) calculations. Pull glucose data from Nightscout.
- **Charts:** Generate 3 PNG charts using scripts in `workspace/scripts/`:
  1. `generate_glucose_chart.js` -> `tmp/glucose_chart.png`
  2. `generate_weekly_calories_chart.js` -> `tmp/weekly_calories_chart.png`
  3. `generate_weekly_carbs_chart.js` -> `tmp/weekly_carbs_chart.png`
- **Delivery:** Post summary text + 3 images to the "Food log" Telegram group (-5262020908).
- **Delay-Comms Rule:** Never miss silently. If validation is still in progress at 9:30 AM, post a brief “working on data validation” update with a concrete ETA.

## Infrastructure

### Nightscout (CGM Monitoring)
- URL: https://p01--sefi--s66fclg7g2lm.code.run
- API_SECRET: JaviCare2026 (SHA1: b3170e23f45df7738434cd8be9cd79d86a6d0f01)
- Event types: "Meal Bolus" (Food), "Note" (Meds), "Exercise" (Activity)

### Meal Photos Page
- Public URL: https://javordlab.github.io/nightscout-meal-photos/
- Hosting: freeimage.host (iili.io) for all photo uploads.
- **Data Feed:** Moving to a local-log-based generator (Radial Dispatcher).
