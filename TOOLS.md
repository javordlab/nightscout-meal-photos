# TOOLS.md - Local Notes

## Nightscout — Auto-Push Protocol (MANDATORY)

When Maria Dennis logs **food**, **medication**, **activity**, or **sleep** in the Telegram group, you MUST:

1. Log it to `/Users/javier/.openclaw/workspace/health_log.md` (local record)
2. **Push it to Nightscout immediately** using the command below
3. Confirm to Maria that it was logged

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
- Include descriptive notes (food items, medication names+doses, activity type+duration).

### Food Photo → Nightscout with Image Link
When Maria sends a **food photo** in the Telegram group:
1. Save the photo locally: use exec to download from Telegram file API
2. Upload to Catbox.moe for permanent hosting:
```bash
curl -s -F "reqtype=fileupload" -F "fileToUpload=@/path/to/photo.jpg" https://catbox.moe/user/api.php
```
   Returns a URL like: `https://files.catbox.moe/abc123.jpg`
3. Include the URL in the Nightscout treatment notes:
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "api-secret: b3170e23f45df7738434cd8be9cd79d86a6d0f01" \
  -d '{"enteredBy":"Javordclaws","eventType":"Meal Bolus","notes":"Lunch: [food description]\n📷 https://files.catbox.moe/abc123.jpg","created_at":"UTC_TIMESTAMP"}' \
  https://p01--sefi--s66fclg7g2lm.code.run/api/v1/treatments.json
```
4. The photo link will be visible when clicking/hovering on the treatment icon in Nightscout.

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)

---

Add whatever helps you do your job. This is your cheat sheet.
