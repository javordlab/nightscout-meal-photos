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
- **WRITE LEDGER ENFORCEMENT (Added 2026-03-24):** Every successful write to `health_log.md` is automatically recorded to `data/write_ledger.jsonl` by the PostToolUse hook (`record_write_to_ledger.js`). The PreToolUse Telegram guard checks this ledger before any Telegram send — if no matching write exists in the last 30 min, it injects a hard block warning. Do NOT override or bypass this guard. A separate cron audit (`audit_telegram_confirmations.js`, every 2h) cross-references the ledger against the normalized log as a safety net.
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
- **PEAK BG PREDICTION FORMULA v3 (CALIBRATED 2026-04-02, n=57):** Four-layer model. Apply all layers:
  - **Layer 1 — Carb factor (preBG-anchored, Metformin-adjusted):**
    - 0–15g:  `preBG + carbs × 2.0`
    - 16–30g: `preBG + carbs × 1.3`
    - 31–50g: `preBG + carbs × 1.2`
    - 51+g:   `preBG + carbs × 0.8`
    - Never use flat 120 as baseline. Cap final result at 300 mg/dL.
  - **Layer 2 — Meal-type intercept (additive, apply after carb calc):**
    - Breakfast: +31 mg/dL (dawn phenomenon / morning cortisol — mandatory, largest signal)
    - Lunch:     −12 mg/dL (Metformin fully active midday)
    - Dinner:     −2 mg/dL
    - Snack:      +4 mg/dL
    - Dessert:   −14 mg/dL (typically follows a meal, partially blunted)
  - **Layer 3 — preBG dampener (apply after intercept):**
    - preBG ≥ 140: subtract 15 mg/dL
    - preBG ≥ 130: subtract 8 mg/dL
    - preBG < 130: no adjustment
  - **Layer 4 — Cumulative meal preBG anchor (data quality fix):**
    - If this is a cumulative item (added to an ongoing meal within 2 hours of the first item), use the **FIRST item's preBG** as the anchor — NOT the current live BG (which is mid-digestion and artificially elevated). Failure to do this causes ~47–56 mg/dL underestimate errors on cumulative items.
- **TIME-TO-PEAK DEFAULTS (median observed):** Breakfast: +87 min | Dinner: +76 min | Lunch: +113 min | Snack: +126 min | Dessert: +102 min. Do NOT use flat +90 min for all meal types.
- **CUMULATIVE MEAL PREDICTION (NON-NEGOTIABLE):** When a new food entry shares the same meal type (e.g., a second Breakfast item) and was logged within 2 hours of the first, the peak BG prediction MUST be based on the **sum of all carbs for that meal**, not the new item's carbs alone. Adding food to a meal always increases (or holds) the predicted peak — never decreases it. Annotate with `[Cumulative [MealType]: Xg carbs total]` when applicable.
- **FOOD DESCRIPTION ACCURACY (NON-NEGOTIABLE):** Description must match the submitted photo/caption content. Never invent/substitute meal descriptions. If uncertain, mark uncertainty and queue refinement.
- **TIMEZONE POLICY (SYSTEM-WIDE):** Always use host-local dynamic timezone for timestamps/offsets. Never hardcode timezone offsets (`-07:00`, `-08:00`, etc.) unless a target API explicitly requires a specific format.
- **MEDICATION FORMAT (REQUIRED):** Every Medication entry must follow: `Medication: [Med Name] [Dose] ([Time Context]) (BG: [Value] [Trend])`. Example: `Medication: Metformin 500mg (breakfast) (BG: 124 mg/dL Flat)`.
- **SILENT LOGGING:** Food, Medication, and Exercise entries are auto-logged immediately without asking for confirmation. Photos are optional — log the entry either way.
- **DATA INTEGRITY:** All dashboard data and visual charts must be pushed to GitHub at the end of every sync cycle.
- **TOOLS:** Refer to `SKILL.md` for tools and `TOOLS.md` for local configuration/notes.

## Radial Architecture & Sync
- **SSoT:** `health_log.md` is the only source of truth. All syncs (Notion, Nightscout, MySQL) trigger every 30 minutes and after any manual log update. Downstream systems are overwritten — never edit them directly.
- **PROJECTIONS & OUTCOMES:** Every Food entry MUST have `Predicted Peak BG` and `Predicted Peak Time` calculated immediately upon logging. After ~3 hours, automatically backfill actual outcomes (Pre-Meal BG, 2hr Peak BG, Peak Time, BG Delta, etc.). Backfill runs every 2 hours via cron.

## Reporting (Daily 9:30 AM PT)
- Must include: 24-hour summary (Avg, TIR, GMI), 14-day trends (GMI, Avg, TIR, CV), Nutrition (24h full + 14d avg), Medication status, Outliers, and Supervisor Analysis.
- **Accuracy (NON-NEGOTIABLE):** Metrics must use exact script-calculated math from the correct LA timeframe. No stale windows, no approximations.
- **Tone:** Keep "Extended Supervisor Analysis" as a single combined, casual/friendly grouping — do not split into sub-sections.
- **Delivery:** Primary 09:30 report sent by `send_daily_health_report_telegram.js` (system crontab), which validates target date/timeframe and fails closed. 09:37 chart cron is fallback-only and idempotent.
- **Model name:** Every daily report must explicitly state the model name used to generate it.

## Strict Data Rule — NEVER EYEBALL (NON-NEGOTIABLE)
When reporting any numerical values (glucose, carbs, calories, TIR, GMI, etc.):
1. Execute the calculation scripts (`calculate_glucose_summary.js`, `calculate_14d_stats.js`)
2. Use the EXACT output values in reports
3. Do not round or approximate unless the script already does
4. Never invent numbers — if data is missing, state "Data unavailable" instead of guessing

## Model Escalation Policy
| Trigger | Escalate To |
|---------|-------------|
| Routine sync / dashboards / CRUD | Keep `ollama/kimi-k2.5:cloud` |
| Cross-system mismatch after first fix | `google-gemini-cli/gemini-3-flash-preview` |
| Persistent high-risk bug (idempotency, dedupe, data integrity) | `openai-codex/gpt-5.3-codex` |
