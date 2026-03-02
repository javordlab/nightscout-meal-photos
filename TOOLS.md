# TOOLS.md - Local Notes

## Nightscout & Notion — Auto-Push Protocol (REVISED 2026-02-28)

When Maria Dennis logs **food**, **medication**, **activity**, or **sleep** in the Telegram group, you MUST:

1. **Local:** Log it to `/workspace/health_log.md` (local record).
2. **Nightscout:** Push to Nightscout immediately (eventType: `Meal Bolus`, `Note`, or `Exercise`).
3. **Notion:** Push to the Notion "Maria Health Log" database (ID: `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`).
4. **Pre-Query Verification (IMPORTANT):** Before asking about a missing meal, medication, or activity entry (during heartbeats or automated reminders), ALWAYS perform a thorough search of recent channel history (via `sessions_history`) and local logs (`health_log.md`) to confirm the information wasn't already provided but missed or not yet processed.
5. **Impact Analysis (Notion Only):** For **Food** entries:
   - Identify the glucose level AT the time of the meal (**Pre-Meal BG**).
   - Wait/Schedule a check for the highest glucose level 2 hours after the meal (**2hr Peak BG**).
   - Record the exact time of that peak (**Peak Time**).
   - Calculate and update the **BG Delta**.
   - Calculate and update the **Time to Peak (min)** (minutes between meal start and peak).
6. **Confirm:** Send confirmation to Maria and Javi in the Telegram group. **CRITICAL:** Always include the current glucose reading (value and trend arrow) in this confirmation.

### Photo & Carb Protocol
- **Host:** Upload photos to **freeimage.host (iili.io)**.
- **Link:** Include the link in Nightscout notes with 📷 and in the Notion **Photo** column.
- **Carbs:** Parse estimates into the Nightscout `carbs` field and the Notion **Carbs (est)** column.
- **Titles:** Use the high-fidelity "Items identified" list for the Notion **Entry** title.

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)
