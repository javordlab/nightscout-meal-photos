# TOOLS.md - Local Notes

## Nightscout & Notion — Auto-Push Protocol (REVISED 2026-03-06)

When Maria Dennis logs **food**, **medication**, **activity**, or **sleep** in the Telegram group, you MUST:

1. **Local:** Log it to `/workspace/health_log.md` (local record).
2. **Nightscout:** Push to Nightscout immediately. **STRICT REQUIREMENT:** ALWAYS include `eventType`. Use `Meal Bolus` for food, `Note` for meds, or `Exercise` for activity. NEVER leave eventType as null or empty, as the photo gallery relies on `Meal Bolus`.
3. **Notion:** Push to the Notion "Maria Health Log" database (ID: `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`). **Verification:** After pushing, confirm the Notion page was created successfully.
4. **Timezone Standard (CRITICAL):** ALWAYS use PST/PDT offsets (e.g., `-08:00`) for all Notion and Nightscout timestamps. Never use raw UTC strings as they cause date-shifts.
5. **Reconciliation & Sync Guard:** 
   - Once a day (during the 9:45 AM log review), audit the last 24h of `health_log.md` against Nightscout and Notion.
   - **NEW:** Every 4 hours, run a "Sync Guard" check: query Nightscout for recent entries and ensure all food items have `eventType: Meal Bolus`. If any are null, fix them immediately.
6. **Pre-Query Verification (IMPORTANT):** Before asking about a missing meal, medication, or activity entry (during heartbeats or automated reminders), ALWAYS perform a thorough search of recent channel history (via `sessions_history`) and local logs (`health_log.md`) to confirm the information wasn't already provided but missed or not yet processed.
7. **Impact Analysis (Notion Only):** For **Food** entries:
   - Identify the glucose level AT the time of the meal (**Pre-Meal BG**).
   - Wait/Schedule a check for the highest glucose level 2 hours after the meal (**2hr Peak BG**).
   - Record the exact time of that peak (**Peak Time**).
   - Calculate and update the **BG Delta**.
   - Calculate and update the **Time to Peak (min)** (minutes between meal start and peak).
   - **Feedback Loop:** Compare the actual peak and delta with the "Glucose Impact Projection" provided during logging to refine future estimates.
8. **Confirm:** Send confirmation to Maria and Javi in the Telegram group. 
   - **Current Status:** Always include the current glucose reading (value and trend arrow).
   - **Glucose Impact Projection:** Based on Maria's historical data for similar meals or carb loads, provide a projection of the likely glucose increase (Delta) and the predicted absolute peak value and time (e.g., "Predicted rise: +80 mg/dL to ~197 mg/dL by 11:45 AM").
   - **Clinical Accuracy:** Always use PST/PDT for predicted times.

- **Photo & Carb/Calorie Protocol**
- **Host:** Upload photos to **freeimage.host (iili.io)**.
- **Key:** `6d207e02198a847aa98d0a2a901485a5`
- **Link:** Include the link in Nightscout notes with 📷 and in the Notion **Photo** column.
- **Carbs/Calories:** Parse estimates into the Nightscout `carbs` field (carbs only) and include the calorie estimate in the Nightscout `notes` field (e.g., "Lunch: ... (~45g carbs, ~500 kcal)"). For Notion, use the **Carbs (est)** and **Calories (est)** columns.
- **Titles:** Use the high-fidelity "Items identified" list for the Notion **Entry** title.

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)
