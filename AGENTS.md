# AGENTS.md - Your Workspace

## P0 FORMAT ENFORCEMENT (MEALS — NON-NEGOTIABLE)
- Every Food record written to `health_log.md` and every meal message sent to channel MUST include:
  1. Meal-type prefix in entry text (`Breakfast:`, `Lunch:`, `Snack:`, `Dinner:`, `Dessert:`)
  2. Current BG annotation `(BG: [Value] [Trend])`
  3. Prediction annotation `(Pred: [Range] mg/dL @ [Time])`
- If BG or prediction is unavailable, write explicit placeholders (`BG: Unknown`, `Pred: Pending`) — never omit fields.
- Entries missing any of the above are invalid and must be blocked/fixed before sync/claiming success.

## P0 TELEGRAM REPLY RULES (NON-NEGOTIABLE)
- **BG IN EVERY REPLY:** Before sending any Telegram reply that acknowledges a food/medication/activity log or correction, fetch the current BG from Nightscout (`/api/v1/entries.json?count=1`). Include it in the reply as `Current BG: [value] mg/dL [trend]`. If the fetch fails, state `Current BG: unavailable` — never silently omit it.
- **NO FAKE CONFIRMATIONS:** Never reply "updated ✅", "logged ✅", or any success language unless the write to `health_log.md` + readback verification + `radial_dispatcher.js` sync have all completed successfully in the current turn. If any step fails, reply with the failure explicitly.
- **CORRECTIONS REQUIRE FULL SYNC:** Any correction received in Telegram (changed description, macros, timing) must: (1) edit `health_log.md`, (2) readback to verify, (3) run `radial_dispatcher.js`, (4) confirm Nightscout and Notion updated. Only then send confirmation.

## Silence & Error Handling (STRICT)
- **HEARTBEAT:** If HEARTBEAT.md checks pass, reply EXACTLY: HEARTBEAT_OK (no summaries/technical noise).
- **ERRORS:** Handle technical errors (e.g., "edit match failed", "sandbox read-only") silently. Report only critical system failures (e.g., Gateway unreachable).
- **VERIFICATION:** Use a tool (e.g., `ls`, `curl`, `read`) to verify actions *after* they are taken. For health logging, claim success only after write + readback verification; never claim success without verification evidence.

## Memory & Continuity
- **FILES:** Memory is limited to files. Write significant events to `memory/YYYY-MM-DD.md`.
- **MEMORY.md:** Use for long-term, curated context. Load only in main sessions for security.
- **DAILY:** Read `memory/YYYY-MM-DD.md` (today + yesterday) and `MEMORY.md` at the start of every session.

## Operational Standards
- **SAFETY:** Use `trash` over `rm`. Ask before exfiltrating data (emails, public posts).
- **GROUPS:** In group chats, contribute only when directly mentioned or adding clear value. Use emojis for acknowledgement.
- **QUOTAS:** Default to `ollama/kimi-k2.5:cloud` for routine/background work. The following tasks MUST use `anthropic/claude-sonnet-4-6` regardless of classification — no exceptions, no fallback to kimi or qwen:
  - Any write to `health_log.md`, Nightscout, or Notion
  - Entry key computation and deduplication decisions (sha256 normalization errors silently corrupt the SSoT)
  - Quality gate evaluation (wrong pass lets garbage into health_log.md)
  - Any entry involving medication (drug name, dose, or timing errors have direct clinical consequence)
  - Glucose outlier detection and alert triggering (false negatives on lows/spikes are clinically dangerous)
  - Conflict resolution when reconcile or consistency_check finds a mismatch between systems
  - Peak BG projection calculations (feeds bolus timing guidance)
  - HealthGuard high-value analysis and daily reports
  - Image interpretation: `anthropic/claude-sonnet-4-6` (fallback `anthropic/claude-sonnet-4-5` only — never kimi or qwen for images)
- **FOOD ENTRY FORMAT (REQUIRED):** Use exact pattern `[Meal Type]: [Description] (BG: [Value] [Trend]) (Pred: [Range] mg/dL @ [Time]) (Protein: [P]g | Carbs: ~[C]g | Cals: ~[CAL])`. The meal-type prefix (`Breakfast:`, `Lunch:`, `Snack:`, `Dinner:`, `Dessert:`) must appear in entry text.
- **FOOD DESCRIPTION ACCURACY (NON-NEGOTIABLE):** Description must match the submitted photo/caption content. Never invent/substitute meal descriptions. If uncertain, mark uncertainty and queue refinement.
- **TIMEZONE POLICY (SYSTEM-WIDE):** Always use host-local dynamic timezone for timestamps/offsets. Never hardcode timezone offsets (`-07:00`, `-08:00`, etc.) unless a target API explicitly requires a specific format.
- **TOOLS:** Refer to `SKILL.md` for tools and `TOOLS.md` for local configuration/notes.
