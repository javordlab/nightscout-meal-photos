# TOOLS.md - Local Configuration

## Logging Protocol
1. **SSoT:** Log/correct in `/workspace/health_log.md` first.
2. **BG DATA:** Whenever logging a new Food, Snack, Activity, or Medication entry, fetch the latest glucose value from Nightscout and include it in the response and the log note.
   - **IMPORTANT:** Use SHA1 hash of password for API calls: `b3170e23f45df7738434cd8be9cd79d86a6d0f01`
3. **GATE:** Run `node scripts/consistency_check.js 2` before/after sync.
4. **NIGHTSCOUT:** Use `eventType` (Meal Bolus, Note, Exercise). Never leave null.
5. **NOTION:** Sync to DB `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`. Confirm success.
6. **TIMEZONE:** Use PST/PDT offsets (e.g., `-08:00`). No raw UTC.
7. **SYNC GUARD:** Audit `health_log.md` daily (9:45 AM) and run Sync Guard every 4h.
8. **IMPACT:** For food, calculate Pre-Meal BG, Predicted Peak (+90-120m), 2hr Peak, and Delta.
9. **REPORTS:** Every daily health report must explicitly state the model name used to generate it.
10. **PHOTOS:** Upload to `freeimage.host` (Key: `6d207e02198a847aa98d0a2a901485a5`). Use calibration object (card).
11. **GALLERY PUBLISH:** If a missing photo is detected in gallery, run sync and then always `git add/commit/push` `nightscout-meal-photos/data/notion_meals.json` (and related gallery data files) to `main`.
12. **WRITE-THEN-CONFIRM (STRICT):** Never say "logged", "updated", or "done" unless an `edit`/`write` tool call to `/workspace/health_log.md` succeeded in the current turn.
13. **POST-WRITE READBACK (STRICT):** After every successful log write, immediately `read` `health_log.md` and verify the exact new/updated row exists. Only then send success confirmation.
14. **FAIL-CLOSED CONFIRMATION:** If write OR readback verification fails, explicitly report "not logged yet" and do not claim completion.
15. **POST-WRITE SYNC (STRICT):** After every successful log write + readback, immediately run `cd /Users/javier/.openclaw/workspace && node scripts/radial_dispatcher.js` to push the entry to Nightscout, Notion, and MySQL. Do not wait for the cron cycle.
16. **IMAGE MODEL ENFORCEMENT (STRICT):** Every image interpretation task (meal photos, OCR from images, screenshot interpretation) must be executed with `openai-codex/gpt-5.3-codex`. Do not use Google Gemini models for image interpretation.
17. **PHOTO RESPONSE ATTRIBUTION (STRICT):** Every response that includes photo-derived nutrition must include `Vision model: openai-codex/gpt-5.3-codex` before any logging confirmation.

## Formatting
- **Discord/WhatsApp:** Bullet lists only (no tables).
- **Discord:** Wrap links in `<>` to suppress embeds.
- **WhatsApp:** Use **bold** or CAPS for emphasis (no headers).

## Telegram Group
- **ID:** -5262020908 ("Food log")
- **Bot:** @Javordclaws_bot
- **Members:** Javi (8335333215), Maria (8738167445)
