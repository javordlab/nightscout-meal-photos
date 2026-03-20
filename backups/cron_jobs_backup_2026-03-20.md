# Cron Jobs Backup - 2026-03-20
# Original jobs with hardcoded models before migration to default
# DO NOT DELETE - This is the reference backup

## Job 1: radial-sync-30m
ID: radial-sync-30m
Agent: health-guard
Schedule: */30 * * * * (America/Los_Angeles)
Session Target: isolated
Wake Mode: now
Delivery: none
Original Model: openai-codex/gpt-5.3-codex
Message: |
  1. MEDICATIONS: Run /Users/javier/.openclaw/workspace/scripts/auto_track_meds.js.
  2. PROJECTIONS: Run /Users/javier/.openclaw/workspace/scripts/calculate_notion_projections.js. (CRITICAL: Ensure current meal has peak BG and peak time calculated and written to SSoT).
  3. SYNC: Run /Users/javier/.openclaw/workspace/scripts/radial_dispatcher.js to sync to Notion and Nightscout (MySQL paused).
  4. DASHBOARD: Paused (do not update dashboard assets).
  5. NO_REPLY: Respond with ONLY NO_REPLY after successful run.
Thinking: low

## Job 2: notion-outcome-backfill
ID: b95f6b29-33b3-403e-826e-4d6ebcc49103
Agent: health-guard
Schedule: every 7200000ms (every 2 hours)
Session Target: isolated
Wake Mode: now
Delivery: none
Original Model: ollama/kimi-k2.5:cloud
Timeout: 120s
Message: Run the Notion outcome backfill script to calculate actual glucose outcomes for completed meals. Execute: cd /Users/javier/.openclaw/workspace && node scripts/backfill_notion_impact.js

## Job 3: hourly-notion-impact-update
ID: f021340e-099c-4683-a893-1e77a15eecce
Agent: health-guard
Schedule: 0 * * * * (America/Los_Angeles) - stagger 300000ms
Session Target: isolated
Wake Mode: now
Delivery: none
Channel: telegram
To: 8335333215
Original Model: google-antigravity/gemini-3-flash
Thinking: low
Message: |
  1. Run /Users/javier/.openclaw/workspace/scripts/calculate_notion_projections.js to ensure all meals have initial projections.
  2. Run /Users/javier/.openclaw/workspace/scripts/backfill_notion_impact.js to update glucose impact data in Notion.
  3. Dashboard/Obsidian sync steps are paused. Do not update notion gallery JSON and do not push nightscout-meal-photos.
  4. Do not report status to the channel unless a critical error occurs.

## Job 4: daily-log-review
ID: e4b06f9e-85fa-4799-8534-1e9ee1bff831
Agent: main
Schedule: 15 9 * * * (America/Los_Angeles) - stagger 120000ms
Session Target: isolated
Wake Mode: now
Delivery: none
Channel: telegram
To: 8335333215
Original Model: openai-codex/gpt-5.3-codex
Thinking: low
Timeout: 180s
Message: |
  1. Review OpenClaw logs for the last 24h. Report ONLY actionable items (service down, security breach).
  2. HEALTH RECONCILIATION: Audit the last 24h of /Users/javier/.openclaw/workspace/health_log.md against the Notion "Maria Health Log" (ID: 31685ec7-0668-813e-8b9e-c5b4d5d70fa5). If any entries are in the local log but missing from Notion, add them retroactively using the correct date and nutritional estimates.
  3. Ensure all Notion timestamps use the -08:00 offset.
  4. If everything is in sync and no manual action needed, send: 'No action needed today.'

## Job 5: maria-glucose-summary
ID: 30ffd883-4e5c-488c-a242-d3788da0bcef
Agent: main
Schedule: 30 9 * * * (America/Los_Angeles) - stagger 90000ms
Session Target: isolated
Wake Mode: now
Delivery: announce
Channel: telegram
To: -5262020908
Original Model: openai-codex/gpt-5.3-codex
Thinking: low
Timeout: 900s
Message: |
  Generate Maria's Daily Health Summary (Last 24h) with CONSISTENT DATA:

  STEP 1 - REFRESH DATA:
  Execute: cd /Users/javier/.openclaw/workspace && node scripts/refresh_glucose_data.js
  This fetches fresh glucose data from Nightscout.

  STEP 2 - CALCULATE STATS:
  Execute: cd /Users/javier/.openclaw/workspace && node scripts/calculate_glucose_summary.js
  Capture the EXACT output values for 24h and 14d stats.

  Execute: cd /Users/javier/.openclaw/workspace && node scripts/calculate_14d_stats.js
  Capture the EXACT output values.

  STEP 3 - GENERATE CHARTS:
  Execute these in order:
  - node scripts/generate_daily_glucose_chart.js
  - node scripts/generate_glucose_chart.js
  - node scripts/generate_weekly_calories_chart.js
  - node scripts/generate_weekly_carbs_chart.js

  STEP 4 - BUILD REPORT using ONLY the calculated values from Step 2:

  REQUIRED SECTIONS:
  📊 24-HOUR GLUCOSE SUMMARY (Use calculated values)
  • Average Glucose: [from calculate_glucose_summary.js stats24h.average]
  • Time In Range: [from stats24h.tir]%
  • GMI: [from stats24h.gmi]%
  • Current BG: [most recent from Nightscout]

  📉 14-DAY TRENDS (Use calculated values)
  • Rolling Average: [from stats14d.average]
  • Rolling TIR: [from stats14d.tir]%
  • Rolling GMI: [from stats14d.gmi]%
  • CV (Variability): [from calculate_14d_stats.js cv]%

  🍎 NUTRITION & FOOD DETAILS (from health_log.md)
  • List each meal with: time, description, carbs, calories
  • Include BG at meal time
  • Daily totals vs 14d average

  💊 MEDICATION ADHERENCE
  • Metformin, Lisinopril, Rosuvastatin status
  • Flag any missed doses with ⚠️

  🔍 OUTLIERS
  • Any spikes >250 or lows <70

  📝 SUPERVISOR ANALYSIS
  • Brief professional assessment

  STEP 5 - DELIVERY:
  Send text report to Telegram group -5262020908
  Send these 4 chart images as separate messages:
  - /Users/javier/.openclaw/workspace/tmp/daily_glucose_chart.png
  - /Users/javier/.openclaw/workspace/tmp/glucose_chart.png
  - /Users/javier/.openclaw/workspace/tmp/weekly_calories_chart.png
  - /Users/javier/.openclaw/workspace/tmp/weekly_carbs_chart.png

  Include model name in footer.
  Respond NO_REPLY.
