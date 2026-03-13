# TOOLS.md - Local Configuration

## Nightscout & Notion Protocol
1. **SSoT:** Log/correct in `/workspace/health_log.md` first.
2. **GATE:** Run `node scripts/consistency_check.js 2` before/after sync.
3. **NIGHTSCOUT:** Use `eventType` (Meal Bolus, Note, Exercise). Never leave null.
4. **NOTION:** Sync to DB `31685ec7-0668-813e-8b9e-c5b4d5d70fa5`. Confirm success.
5. **TIMEZONE:** Use PST/PDT offsets (e.g., `-08:00`). No raw UTC.
6. **SYNC GUARD:** Audit `health_log.md` daily (9:45 AM) and run Sync Guard every 4h.
7. **IMPACT:** For food, calculate Pre-Meal BG, Predicted Peak (+90-120m), 2hr Peak, and Delta.
8. **PHOTOS:** Upload to `freeimage.host` (Key: `6d207e02198a847aa98d0a2a901485a5`). Use calibration object (card).

## Formatting
- **Discord/WhatsApp:** Bullet lists only (no tables).
- **Discord:** Wrap links in `<>` to suppress embeds.
- **WhatsApp:** Use **bold** or CAPS for emphasis (no headers).

## Telegram Group
- **ID:** -5262020908 ("Food log")
- **Bot:** @Javordclaws_bot
- **Members:** Javi (8335333215), Maria (8738167445)
