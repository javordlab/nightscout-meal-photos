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
- Maria reports times in **PST** (America/Los_Angeles)
- Nightscout stores everything in **UTC**
- **PST → UTC: Add 8 hours**
- Example: 9:00 AM PST → 17:00 UTC → `2026-02-23T17:00:00Z`
- If Maria doesn't specify a time, use the current time

### Rules
- ALWAYS push to Nightscout. Never skip this step.
- ALWAYS convert times to UTC before pushing.
- If a food photo is sent, identify the food, estimate carbs, and push as `Meal Bolus`.
- Include descriptive notes (food items, medication names+doses, activity type+duration).

---

## Telegram Group
- Group: "Food log" (ID: -5262020908)
- Bot: @Javordclaws_bot
- Members: Javi (8335333215), Maria (8738167445)

---

Add whatever helps you do your job. This is your cheat sheet.
