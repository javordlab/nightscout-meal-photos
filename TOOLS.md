# TOOLS.md - Local Notes

## Nightscout — Auto-Push Protocol (MANDATORY)

When Maria Dennis logs **food**, **medication**, **activity**, or **sleep** in the Telegram group, you MUST:

1. Log it to `/workspace/health_log.md` (local record - mapped to host)
2. **Push it to Nightscout immediately** using the command below
3. Confirm to Maria that it was logged
4. For food photos: **upload/host the image + identify items immediately in the same processing turn**

### Push Command
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "api-secret: b3170e23f45df7738434cd8be9cd79d86a6d0f01" \
  -d '{"enteredBy":"Javordclaws","eventType":"EVENT_TYPE","notes":"DESCRIPTION","created_at":"UTC_TIMESTAMP"}' \
  https://p01--sefi--s66fclg7g2lm.code.run/api/v1/treatments.json
```

### Event Types
| Category | eventType | Example |
|----------|-----------|---------|
| Food/Meals | `Meal Bolus` | Breakfast, lunch, dinner, snacks |
| Medication | `Note` | Metformin, Rosuvastatin, Sudafed, etc. |
| Exercise/Activity | `Exercise` | Gardening, walking, gym (include `"duration": MINUTES`) |
| Sleep | `Note` | Sleep periods |
| Other notes | `Note` | Any other health observation |

### Time Conversion (CRITICAL)
- ALWAYS use the Telegram message arrival time for the record, unless Maria specifies a different time in her message.
- Maria reports times in **PST** (America/Los_Angeles)
- Nightscout stores everything in **UTC**
- **PST → UTC: Add 8 hours**
- Example: 9:00 AM PST → 17:00 UTC → `2026-02-23T17:00:00Z`
- DO NOT use the current system time if it differs from the message timestamp.

### Rules
- ALWAYS push to Nightscout. Never skip this step.
- ALWAYS convert times to UTC before pushing.
- If a food photo is sent, identify the food, estimate carbs, and push as `Meal Bolus`.
- **Session Consolidation:** If multiple photos or food descriptions are sent within a **30-minute window**, consider them part of the SAME meal event (e.g., Breakfast, Lunch). Consolidate the carb estimates and item lists before confirming or providing advice.
- Include descriptive notes (food items, medication names+doses, activity type+duration).

### 📷 Food Photo Protocol (REVISED 2026-02-26)
Standardized for Sandbox compatibility and reliability:
1. **Host:** Upload every photo to **freeimage.host (iili.io)**.
   - API Key: `6d207e02198a847aa98d0a2a901485a5`
   - Use `curl -s -F "source=@/path/to/photo.jpg" -F "action=upload" -F "key=KEY" https://freeimage.host/api/1/upload | jq -r '.image.url'`
2. **Link:** Include the resulting `iili.io` URL in the Nightscout treatment notes with a 📷 emoji prefix.
3. **No Local Sync:** Do NOT attempt to push photos to the GitHub repository or move them to local `uploads/` folders. The visual log site [javordlab.github.io/nightscout-meal-photos/](https://javordlab.github.io/nightscout-meal-photos/) is updated to read these links directly from Nightscout.

### Food Recognition Message Format
For food photos, always include a clear food-item list in the Telegram confirmation and in Nightscout notes.

Format:
- Meal label + carb estimate
- `Items identified:` bullet list

Example:
- `Dinner (~42g carbs)`
- `Items identified: grapes, grilled chicken, mixed salad, olive oil dressing`

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)
