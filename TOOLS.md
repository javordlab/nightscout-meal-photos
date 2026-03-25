# TOOLS.md - Local Configuration & Credentials

All operational rules (food format, timezone, write-confirm, readback) are in `AGENTS.md` — do not duplicate here.

## Logging Protocol
1. **SSoT:** Log/correct in `/workspace/health_log.md` first. (See AGENTS.md "Radial Architecture & Sync")
2. **BG DATA:** Fetch latest glucose from Nightscout for every Food/Snack/Activity/Medication entry. (See AGENTS.md "P0 TELEGRAM REPLY RULES")
   - **IMPORTANT:** Use SHA1 hash of password for API calls: `b3170e23f45df7738434cd8be9cd79d86a6d0f01`
3. **GATE:** Run `node scripts/consistency_check.js 2` before/after sync.
4. **NIGHTSCOUT:** Use `eventType` (Meal Bolus, Note, Exercise). Never leave null.
5. **NOTION:** Sync to DB `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`. Confirm success.
6. **TIMEZONE:** (See AGENTS.md "TIMEZONE POLICY")
7. **SYNC GUARD:** Audit `health_log.md` daily (9:45 AM) and run Sync Guard every 4h.
8. **IMPACT:** For food, calculate Pre-Meal BG, Predicted Peak (+90-120m), 2hr Peak, and Delta.
9. **REPORTS:** (See AGENTS.md "Reporting" and "Strict Data Rule")
10. **PHOTOS:** Upload to `freeimage.host` (Key: `6d207e02198a847aa98d0a2a901485a5`). Use calibration object (card).
11. **GALLERY PUBLISH:** If a missing photo is detected in gallery, run sync and then always `git add/commit/push` `nightscout-meal-photos/data/notion_meals.json` to `main`.
12. **WRITE-THEN-CONFIRM / READBACK / FAIL-CLOSED:** (See AGENTS.md "P0 TELEGRAM REPLY RULES" and "WRITE LEDGER ENFORCEMENT")
13. **POST-WRITE SYNC:** After every successful log write + readback, immediately run `cd /Users/javier/.openclaw/workspace && node scripts/radial_dispatcher.js`.
14. **IMAGE PROCESSING MODE:** Perform image analysis best-effort in the active model context.
15. **PHOTO RESPONSE ATTRIBUTION:** Every response with photo-derived nutrition must include `Vision model used: <provider/model>` before any logging confirmation.

## Formatting
- **Discord/WhatsApp:** Bullet lists only (no tables).
- **Discord:** Wrap links in `<>` to suppress embeds.
- **WhatsApp:** Use **bold** or CAPS for emphasis (no headers).

## Telegram Group
- **ID:** -5262020908 ("Food log")
- **Bot:** @Javordclaws_bot
- **Members:** Javi (8335333215), Maria (8738167445)
