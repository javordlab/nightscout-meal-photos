# AGENTS.md - Your Workspace

## P0 FORMAT ENFORCEMENT (MEALS — NON-NEGOTIABLE)
- Every Food record written to `health_log.md` and every meal message sent to channel MUST include:
  1. Meal-type prefix in entry text (`Breakfast:`, `Lunch:`, `Snack:`, `Dinner:`, `Dessert:`)
  2. Current BG annotation `(BG: [Value] [Trend])`
  3. Prediction annotation `(Pred: [Range] mg/dL @ [Time])`
- If BG or prediction is unavailable, write explicit placeholders (`BG: Unknown`, `Pred: Pending`) — never omit fields.
- Entries missing any of the above are invalid and must be blocked/fixed before sync/claiming success.

## P0 IMAGE / VISION RULES (NON-NEGOTIABLE — ADDED 2026-04-07)
- **MEDIA ATTACHED → MUST CALL THE `image` TOOL FIRST.** If a user message contains the literal marker `[media attached: ...]`, `[Photo attached at: ...]`, or includes any image content block, you MUST call the `image` tool with that image URL/path BEFORE writing any health entry, BEFORE describing the food, and BEFORE replying. This rule applies regardless of which model is currently serving the turn — text-only models (deepseek, kimi, glm, etc.) cannot see images and WILL hallucinate plausible-sounding but wrong food descriptions if you skip this step. The `image` tool routes through the configured `imageModel` (vision-capable) and returns a real description.
- **NEVER DESCRIBE FROM A FILE PATH OR URL ALONE.** If you have only a path/URL string and no image-tool result, you do NOT know what is in the image. Do not invent items, macros, or carbs. Either call the `image` tool or reply with `IMAGE_TOOL_REQUIRED — could not analyze image, manual review needed`.
- **VISION MODEL ATTRIBUTION MUST BE ACCURATE.** The `Vision model used: <provider/model>` line in replies MUST come from the actual `image` tool result metadata, not from the AGENTS.md default. If the image tool was not called, omit the line entirely (do not invent a value). If you cannot determine which model the tool used, write `Vision model used: unknown — image tool result missing`.
- **REFERENCE INCIDENT:** 2026-04-07 dinner entry: Maria sent a salmon + heirloom tomatoes photo. The agent (running on text-only deepseek) skipped the image tool, hallucinated "Sautéed mushrooms with onion, wilted spinach, and chickpeas", wrote 45g carbs / 19g protein / 380 cal — completely wrong — and parroted "Vision model used: anthropic/claude-sonnet-4-6" as a stale literal from AGENTS.md. The wrong values would have driven incorrect Model v3 predictions and wrong Nightscout / Notion data. Never again.

## P0 FOOD PHOTO = NEW INTAKE (NON-NEGOTIABLE — ADDED 2026-04-19)
- **Food photos are NEVER confirmations of a prior entry.** Food has no dosing schedule (unlike medication). Every food photo is a new eating event until proven otherwise. The medication-photo-as-confirmation rule does NOT extend to food — do not extrapolate it.
- **Two food photos within the 1-hour cumulative window — even of visually identical items — means TWO separate intakes.** Append a new row, classify it as the same meal type as the prior entry, apply cumulative prediction logic (sum carbs across all items in the session, recompute peak BG using the FIRST item's preBG as anchor, add `[Cumulative <MealType>: ~Xg carbs total]` annotation). Never collapse, merge in place, or skip the new entry because "it looks like the same snack."
- **PACKAGING-PHOTO EXCEPTION:** If Maria sends a photo that clearly shows ONLY product packaging / nutrition label / ingredient panel (no plate, no serving, no food being consumed in frame), treat it as **nutritional clarification of the immediately prior food entry**. Update that entry's Protein / Carbs / Cals in place using the label values; recompute Pred if carbs changed materially (>5g delta). Do NOT append a new row, do NOT treat it as a new intake. Signals it's a packaging shot: label/barcode/nutrition-facts panel dominates the frame, brand name clearly legible, no cutlery or serving dish visible, typically sent within a few minutes of the prior food photo as a follow-up.
- **When in doubt between "new intake" and "packaging clarification," log TWO entries.** A duplicate log is trivially correctable by Maria in the next message; a missed intake silently corrupts the cumulative carb count and peak BG prediction, which can delay hypo/hyper correction and has direct clinical consequence.
- **REFERENCE INCIDENT:** 2026-04-18 — Maria ate a JoJo's dark chocolate bite at 15:50 and a second bite at 16:17 (27 min later), sending photos of each. Only the 15:50 entry landed in `health_log.md`; the 16:17 photo was silently collapsed as a duplicate. No cumulative annotation, no summed carbs, no updated peak prediction. Entry-key logic is NOT at fault (timestamp is part of the SHA256 basis, so two distinct keys would have generated two distinct rows). The agent made an incorrect judgment — most likely overgeneralizing the medication-confirmation rule to a food item that *looked* identical to the prior one. Contrast: same-day lunch (3 visually distinct courses 13:45→13:53) and same-day dinner (apple+cheese at 19:43 then JoJo's at 20:01) both cumulated correctly because the items looked different. The failure mode is specifically "same-looking food, within 1h → collapse." Prohibit it.

## P0 TELEGRAM REPLY RULES (NON-NEGOTIABLE)
- **BG IN EVERY REPLY:** Before sending any Telegram reply that acknowledges a food/medication/activity log or correction, fetch the current BG from Nightscout (`/api/v1/entries.json?count=1`). Include it in the reply as `Current BG: [value] mg/dL [trend]`. If the fetch fails, state `Current BG: unavailable` — never silently omit it.
- **NO FAKE CONFIRMATIONS:** Never reply "updated ✅", "logged ✅", or any success language unless the write to `health_log.md` + readback verification + `radial_dispatcher.js` sync have all completed successfully in the current turn. If any step fails, reply with the failure explicitly.
- **WRITE LEDGER ENFORCEMENT (Added 2026-03-24):** Every successful write to `health_log.md` is automatically recorded to `data/write_ledger.jsonl` by the PostToolUse hook (`record_write_to_ledger.js`). The PreToolUse Telegram guard checks this ledger before any Telegram send — if no matching write exists in the last 30 min, it injects a hard block warning. Do NOT override or bypass this guard. A separate cron audit (`audit_telegram_confirmations.js`, every 2h) cross-references the ledger against the normalized log as a safety net.
- **CORRECTIONS REQUIRE FULL SYNC:** Any correction received in Telegram (changed description, macros, timing) must: (1) edit `health_log.md`, (2) readback to verify, (3) run `radial_dispatcher.js`, (4) confirm Nightscout and Notion updated. Only then send confirmation.
- **FULL ENTRY READBACK IN REPLIES (added 2026-04-06):** When acknowledging a food/medication/exercise write in Telegram, the "I wrote this as:" block MUST quote the entry line **verbatim from the readback** — including every annotation: `(BG: ... )`, `(Pred: ... mg/dL @ ...)`, and `(Protein: Pg | Carbs: ~Cg | Cals: ~CALs)`. Do NOT summarize, truncate at the first parenthesis, or drop the nutrition/projection parens from the quoted line. The purpose of the quote is to let Javi verify that what landed in `health_log.md` is what he expects — a summary defeats the purpose. If the entry on disk is missing any required annotation, that is a write bug to fix, not something to paper over by omitting it from the reply. Reference incident: 2026-04-06 breakfast entry was written correctly (Pred + nutrition present) but the Telegram reply quoted only the bare title, making it appear as if HealthGuard had skipped Model v3 and nutrition estimation when it had not.

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
- **QUOTAS — Fable 5 Standardization (2026-06-10, prev. Opus 4.7 since 2026-04-19):** All health-critical tasks use `claude-fable-5`. No cost-based tradeoffs:
  - Any write to `health_log.md`, Nightscout, or Notion
  - Entry key computation and deduplication (hash corruption silently breaks SSoT)
  - Quality gate evaluation (garbage in → garbage downstream)
  - Medication entries (drug/dose/timing errors have clinical consequence)
  - Glucose outlier detection, alert triggering, peak BG projection
  - Conflict resolution (data integrity issues across systems)
  - Image analysis and food description accuracy
  - Daily report (all sections: 24h summary, 14d trends, Coach narration, Supervisor Analysis)
  - Daily log review and cron monitoring via `claude -p` OAuth
  - Weekly memory summaries
  - Interactive sessions (Claude Code subscription — free, no API cost)
- **FOOD ENTRY FORMAT (REQUIRED):** Use exact pattern `[Meal Type]: [Description] (BG: [Value] [Trend]) (Pred: [Range] mg/dL @ [Time]) (Protein: [P]g | Carbs: ~[C]g | Cals: ~[CAL])`. The meal-type prefix (`Breakfast:`, `Lunch:`, `Snack:`, `Dinner:`, `Dessert:`) must appear in entry text.
- **TABLE COLUMN VALUES (REQUIRED):** The last two columns of every health_log.md row are `| Carbs | Cals |`. For Food entries, these MUST be numeric (e.g. `| 49 | 530 |`) — extract from the description text. For non-Food entries (Medication, Activity, Exercise, Sleep), use `| - | - |`. NEVER write `| null | null |`.
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
  - **Layer 3 — Cumulative meal preBG anchor (data quality fix):**
    - If this is a cumulative item (added to an ongoing meal within **1 hour** of the first item), use the **FIRST item's preBG** as the anchor — NOT the current live BG (which is mid-digestion and artificially elevated). Failure to do this causes ~47–56 mg/dL underestimate errors on cumulative items.
    - **CRITICAL — Cumulative meal type classification:** Food eaten within **1 hour** of a prior meal MUST be logged as the **same meal type** (e.g., Breakfast), NOT as Snack. A yogurt eaten 11 min after breakfast IS Breakfast. Prediction must use the **sum of all carbs** for the session. A snack prediction of 120 mg/dL while a 195 mg/dL breakfast is still digesting is physiologically wrong and must never be logged.
    - **Window unification (2026-04-07):** This window was 2 hours in earlier docs and 30 minutes in `health-guard.md`. Settled at **1 hour** as a balanced compromise. Apply consistently across all docs and code.
- **TIME-TO-PEAK DEFAULTS (median observed):** Breakfast: +87 min | Dinner: +76 min | Lunch: +113 min | Snack: +126 min | Dessert: +102 min. Do NOT use flat +90 min for all meal types.
- **CUMULATIVE MEAL PREDICTION (NON-NEGOTIABLE):** When a new food entry is logged within **1 hour** of a prior food entry by the same user, the peak BG prediction MUST be based on the **sum of all carbs for that meal**, not the new item's carbs alone. The new item is reclassified as the **same MealType** as the first (e.g., a "snack" 30 min after breakfast IS Breakfast). Adding food to a meal always increases (or holds) the predicted peak — never decreases it. Annotate with `[Cumulative [MealType]: Xg carbs total]` when applicable.
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

## Model Standardization (2026-06-10)
All health system tasks use **Claude Fable 5** (`claude-fable-5`), switched from Opus 4.7 on 2026-06-10. Fallback chain in the foodlog bridge: Opus 4.7 → Sonnet 4.6 → Haiku → Gemini/DeepSeek (availability fallbacks only, never cost-based downgrades). Rationale: health data integrity and medication safety require consistent, high-quality analysis across all operations. Model-specific bugs or differences in edge-case behavior are too risky to allow.
