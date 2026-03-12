# TOOLS.md - Local Notes

## Nightscout & Notion — Auto-Push Protocol (REVISED 2026-03-06)

When Maria Dennis logs **food**, **medication**, **activity**, or **sleep** in the Telegram group, you MUST:

1. **Local First (SSoT):** Log/correct it in `/workspace/health_log.md` first. Do **not** modify Nightscout/Notion until `health_log.md` reflects final values.
2. **Consistency Gate (MANDATORY):** Run `node scripts/consistency_check.js 2` before and after external sync. If it fails, fix `health_log.md` first, then dispatch outward.
3. **Nightscout:** Push to Nightscout immediately after local is correct. **STRICT REQUIREMENT:** ALWAYS include `eventType`. Use `Meal Bolus` for food, `Note` for meds, or `Exercise` for activity. NEVER leave eventType as null or empty, as the photo gallery relies on `Meal Bolus`.
4. **Notion:** Push to the Notion "Maria Health Log" database (ID: `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`). **Verification:** After pushing, confirm the Notion page was created successfully.
5. **Timezone Standard (CRITICAL):** ALWAYS use PST/PDT offsets (e.g., `-08:00`) for all Notion and Nightscout timestamps. Never use raw UTC strings as they cause date-shifts.
6. **Reconciliation & Sync Guard:** 
   - Once a day (during the 9:45 AM log review), audit the last 24h of `health_log.md` against Nightscout and Notion.
   - **NEW:** Every 4 hours, run a "Sync Guard" check: query Nightscout for recent entries and ensure all food items have `eventType: Meal Bolus`. If any are null, fix them immediately.
7. **Pre-Query Verification (IMPORTANT):** Before asking about a missing meal, medication, or activity entry (during heartbeats or automated reminders), ALWAYS perform a thorough search of recent channel history (via `sessions_history`) and local logs (`health_log.md`) to confirm the information wasn't already provided but missed or not yet processed.
8. **Impact Analysis (Notion Only):** For **Food** entries:
   - Identify the glucose level AT the time of the meal (**Pre-Meal BG**).
   - Wait/Schedule a check for the highest glucose level 2 hours after the meal (**2hr Peak BG**).
   - Record the exact time of that peak (**Peak Time**).
   - Calculate and update the **BG Delta**.
   - Calculate and update the **Time to Peak (min)** (minutes between meal start and peak).
   - **Adaptive Projections:** If Maria logs additional food within 2 hours of a previous meal (e.g., a snack shortly after lunch), you MUST update the existing projection. Explicitly state how the new intake changes the predicted peak and time (e.g., "The additional apple adds ~12g carbs; adjusting projected peak from 197 to 215 mg/dL"). If the impact is negligible, state that as well.
9. **Confirm:** Send confirmation to Maria and Javi in the Telegram group. 
   - **Current Status:** Always include the current glucose reading (value and trend arrow).
   - **Glucose Impact Projection:** Based on Maria's historical data for similar meals or carb loads, provide a projection of the likely glucose increase (Delta) and the predicted absolute peak value and time (e.g., "Predicted rise: +80 mg/dL to ~197 mg/dL by 11:45 AM").
   - **Clinical Accuracy:** Always use PST/PDT for predicted times.

- **Photo & Carb/Calorie Protocol**
- **Host:** Upload photos to **freeimage.host (iili.io)**.
- **Key:** `6d207e02198a847aa98d0a2a901485a5`
- **Calibration Object (NEW):** When Maria logs a meal with a photo, she should place a standard card (credit card, ID, or loyalty card) face-down flat on the table next to the plate. This acts as a universal scale for precise portion estimation.
- **Link:** Include the link in Nightscout notes with 📷 and in the Notion **Photo** column.
- **Carbs/Calories:** Parse estimates into the Nightscout `carbs` field (carbs only) and include the calorie estimate in the Nightscout `notes` field (e.g., "Lunch: ... (~45g carbs, ~500 kcal)"). For Notion, use the **Carbs (est)** and **Calories (est)** columns.
- **Titles:** Use the high-fidelity "Items identified" list for the Notion **Entry** title. Always prefix the Entry title with the meal type (e.g., "Breakfast: Scallion pancake...") and populate the **Meal Type** column (Breakfast, Lunch, Dinner, Snack).

## Ingredient Reference
- **Flour Tortilla:** 130 kcal (per Javi, 2026-03-12)

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)
