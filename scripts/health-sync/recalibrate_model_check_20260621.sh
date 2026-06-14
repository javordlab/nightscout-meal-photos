#!/bin/bash
# recalibrate_model_check_20260621.sh — ONE-SHOT (launchd 2026-06-21 03:00, self-removing).
# LaunchAgent: ~/Library/LaunchAgents/com.healthguard.v4-recal-20260621.plist
# (launchd chosen over crontab: fires on wake if asleep at 3am, and crontab
# writes are TCC-blocked from Claude Code sessions anyway.)
#
# Re-runs the prediction calibration 9 days after Model v4 shipped (2026-06-12,
# commit a54b48674): compares v4-period predictions vs actuals against (a) the
# holdout expectations and (b) v3 history, then lets an Opus 4.8 agent apply
# BOUNDED tweaks if — and only if — the new data clearly warrants them.
#
# Model note: originally pinned Fable 5, but Fable 5 was disabled worldwide by a
# US export-control order on 2026-06-12 (the health app switched to Opus 4.8 on
# 2026-06-14). This job now pins claude-opus-4-8, the live health-app model.
set -uo pipefail

export USER="${USER:-javier}"
WORKSPACE="/Users/javier/.openclaw/workspace"
CLAUDE="/Users/javier/.local/bin/claude"
NODE="/opt/homebrew/bin/node"
LOG_FILE="$WORKSPACE/data/cron_health.log"
LAUNCHD_LABEL="com.healthguard.v4-recal-20260621"
PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
OUT_V4="$WORKSPACE/data/calibration_v4_period_20260621.txt"
OUT_FULL="$WORKSPACE/data/calibration_full_history_20260621.txt"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [v4-recal] $*" >> "$LOG_FILE"; }
tg() { "$NODE" -e "require('$WORKSPACE/scripts/health-sync/telegram_alert').sendAlert(process.argv[1], undefined, {parseMode: null})" "$1" >/dev/null 2>&1 || true; }

remove_launchd_job() {
  # Delete the plist so it never re-loads (StartCalendarInterval would re-fire
  # annually), then boot the loaded job out AFTER this script exits — bootout
  # of our own label mid-run would kill us. AbandonProcessGroup=true in the
  # plist keeps the detached subshell alive past our exit.
  rm -f "$PLIST"
  log "removed own plist"
  ( sleep 10; launchctl bootout "gui/$(id -u)/${LAUNCHD_LABEL}" 2>/dev/null ) &
  disown 2>/dev/null || true
}

cd "$WORKSPACE" || { tg "v4 recalibration check FAILED: cannot cd to workspace"; exit 1; }
log "starting Model v4 recalibration check"

# 1. Run the calibration analysis. --since=2026-06-13 = first full day on v4
#    (v4 cutover was 2026-06-12 17:43; earlier Jun-12 entries used v3).
if ! "$NODE" scripts/health-sync/analyze_prediction_calibration.js --since=2026-06-13 > "$OUT_V4" 2>&1; then
  log "analysis (v4 period) failed: $(tail -2 "$OUT_V4" | tr '\n' ' ')"
  tg "v4 recalibration check FAILED running analyze_prediction_calibration.js (v4 period). See data/cron_health.log. Job removed — re-run manually."
  remove_launchd_job
  exit 1
fi
"$NODE" scripts/health-sync/analyze_prediction_calibration.js > "$OUT_FULL" 2>&1 || true
log "analysis done: $(sed -n 2p "$OUT_V4")"

# 2. Hand to an Opus 4.8 agent with bounded-tweak authority.
PROMPT=$(cat <<'EOF'
You are running an unattended scheduled task in /Users/javier/.openclaw/workspace (a health pipeline for Maria, a 73-year-old T2D patient — prediction errors have clinical consequence; be conservative).

CONTEXT: Prediction Model v4 shipped 2026-06-12 (commit a54b48674; full rationale in docs/model_v4_calibration_2026-06-12.md and docs/CHANGELOG.md Issue 37). Expected v4 accuracy from holdout validation: MAE ~15-16 mg/dL, ~63-68% within ±20, ~90% within ±30, bias ≈ 0 to +4. Old v3 measured baseline: MAE 20.6, 57% within ±20, bias −6.4.

INPUTS (read all three):
- data/calibration_v4_period_20260621.txt — predictions made BY MODEL v4 (meals since 2026-06-13) vs actual outcomes. This is the verdict on v4.
- data/calibration_full_history_20260621.txt — full history for reference (dominated by v3-era predictions).
- docs/model_v4_calibration_2026-06-12.md — methodology, the five-copy parity contract, and v4's parameter table.

TASK 1 — EVALUATE: Compare the v4-period CLEAN-meal stats against the holdout expectations above and against the v3 baseline. State plainly whether v4 is performing as predicted, better, or worse, and in which segments (meal type, hour, carbs, preBG).

TASK 2 — TWEAK ONLY IF CLEARLY WARRANTED. Hard rules:
- If the v4-period CLEAN n < 12: make NO changes. Report only, and say the next sensible re-check date (~2 more weeks of data).
- Tweak a meal-type intercept only if that type has n ≥ 8 clean meals AND |meanErr| > 8; change by at most ±8 mg/dL, rounded to integer.
- Tweak a time-to-peak only if that type has n ≥ 8 AND |median delta| > 15 min; change by at most ±20 min.
- Tweak a carb factor only if that bracket has n ≥ 15 AND the implied median differs from current by > 0.15; change by at most ±0.15.
- NEVER touch: the preBG damping slope/center (−0.35 / 115), the 300 cap, the ±10 output band, the cumulative-anchor rule, or anything in config.foodlog.json. Do NOT restart any bridge or service.
- A handful of large misses is NOT a systematic signal — look at medians and segment-level bias, and check the worst-misses list for explainable outliers (fat-heavy desserts, stacking) before blaming coefficients.

IF YOU CHANGE PARAMETERS — the formula is a FIVE-copy parity contract; update ALL of these identically and bump the calibration note (e.g. "v4.1, re-tuned 2026-06-21"):
1. foodlog-cwd/CLAUDE.md (Step 4 tables + worked example if affected)
2. scripts/calculate_notion_projections.js (CARB_FACTORS / MEAL_INTERCEPTS / TTP_DEFAULTS_MIN + header comment) — then run: /opt/homebrew/bin/node --check scripts/calculate_notion_projections.js
3. AGENTS.md (PEAK BG PREDICTION FORMULA section)
4. CLAUDE.md (Prediction Model section)
5. WORKFLOW_AUTO.md (Food Projections summary)
Then append a dated entry to docs/CHANGELOG.md, and commit ONLY the files you edited by name (NEVER git add -A) with message "feat: Model v4.1 — re-tuned <params> from 2026-06-21 recalibration", and push. If the pre-commit hook or push fails, do not retry destructively — note it in the report.

TASK 3 — REPORT via Telegram (plain text, NO Markdown — file names contain underscores). Send with:
/opt/homebrew/bin/node -e "require('./scripts/health-sync/telegram_alert').sendAlert(process.argv[1], undefined, {parseMode: null})" "<your report>"
The report must include: v4-period clean n, MAE / ±20 / ±30 / bias vs the expected numbers and vs v3 history, per-meal-type one-liners, what you tweaked (old → new) or why you didn't, and commit hash if you pushed. Keep it under 3500 chars.

Work autonomously; do not ask questions. If anything fails, still send the Telegram report describing the failure.
EOF
)

log "invoking claude (opus-4-8) for evaluation"
# 45-min absolute ceiling — kill a hung agent rather than block cron forever.
"$CLAUDE" -p --model claude-opus-4-8 --dangerously-skip-permissions "$PROMPT" > "$WORKSPACE/data/v4_recal_agent_output_20260621.txt" 2>&1 &
CLAUDE_PID=$!
( sleep 2700; kill "$CLAUDE_PID" 2>/dev/null ) &
KILLER_PID=$!
wait "$CLAUDE_PID"; CLAUDE_RC=$?
kill "$KILLER_PID" 2>/dev/null; wait "$KILLER_PID" 2>/dev/null

if [ "$CLAUDE_RC" -ne 0 ]; then
  log "claude agent exited rc=$CLAUDE_RC"
  tg "v4 recalibration agent exited with code $CLAUDE_RC (timeout or error). Analysis outputs are in data/calibration_v4_period_20260621.txt — review manually. Agent log: data/v4_recal_agent_output_20260621.txt"
else
  log "claude agent completed ok"
fi

# 3. Self-remove (StartCalendarInterval would re-fire annually).
remove_launchd_job
log "done"
