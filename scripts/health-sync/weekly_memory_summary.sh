#!/bin/bash
# weekly_memory_summary.sh — Synthesizes 7 daily memory files into a weekly rollup.
# Uses claude -p (OAuth) instead of OpenClaw LLM cron.
# Sends Telegram summary to Javi after writing.
#
# System cron: 0 23 * * 0 (Sunday 11 PM PT)

set -euo pipefail

WORKSPACE="/Users/javier/.openclaw/workspace"
CLAUDE="/Users/javier/.local/bin/claude"
NODE="/opt/homebrew/bin/node"
MEMORY_DIR="$WORKSPACE/memory"
WEEKLY_DIR="$MEMORY_DIR/weekly"
LOG_FILE="$WORKSPACE/data/cron_health.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [weekly-memory] $*" >> "$LOG_FILE"; }

log "Starting weekly memory summary"

# Calculate week number and date range (ISO week ending today, Sunday)
YEAR=$(date '+%Y')
WEEK=$(date '+%V')
WEEK_LABEL="${YEAR}-W${WEEK}"

# Collect daily memory files for the past 7 days
COMBINED=$(mktemp)
trap 'rm -f "$COMBINED"' EXIT

FILE_COUNT=0
for i in $(seq 0 6); do
  DAY=$(date -v-${i}d '+%Y-%m-%d')
  DAYFILE="$MEMORY_DIR/${DAY}.md"
  if [ -f "$DAYFILE" ]; then
    echo "=== $DAY ===" >> "$COMBINED"
    cat "$DAYFILE" >> "$COMBINED"
    echo "" >> "$COMBINED"
    FILE_COUNT=$((FILE_COUNT + 1))
  fi
done

log "Found $FILE_COUNT daily memory files for $WEEK_LABEL"

if [ "$FILE_COUNT" -eq 0 ]; then
  log "No memory files found, skipping"
  exit 0
fi

# Determine date range
OLDEST=$(date -v-6d '+%b %d')
NEWEST=$(date '+%b %d')

# Generate weekly summary via Claude OAuth
OUTPUT_FILE="$WEEKLY_DIR/${WEEK_LABEL}.md"
mkdir -p "$WEEKLY_DIR"

RESPONSE=$("$CLAUDE" -p --model sonnet \
  "You are synthesizing daily memory files for the HealthGuard system into a weekly rollup.
Write a structured markdown document with these exact sections:

# Weekly Memory Summary — ${WEEK_LABEL} (${OLDEST}–${NEWEST})

> Coverage: date range | Generated: $(date '+%Y-%m-%d')

---

## System Changes
(Scripts added/modified, cron changes, infrastructure updates)

## Rules & Preferences
(Any rules established or reinforced this week)

## Bugs Fixed
(Root cause + fix for each bug)

## Health Patterns
(Glucose trends, medication changes, dietary observations)

## Carry-forwards
(Items that need monitoring or follow-up next week)

---

Be concise but thorough. Extract facts from the daily files — don't invent. If a section has no entries, write 'No notable changes this week.'

Here are the daily memory files:

$(cat "$COMBINED")" 2>/dev/null) || {
  log "ERROR: claude -p failed"
  exit 1
}

# Write the output file
echo "$RESPONSE" > "$OUTPUT_FILE"
log "Wrote weekly summary to $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE" | tr -d ' ') lines)"

# Send Telegram notification with a useful preview (first ~3 bullets per section)
"$NODE" -e "
  const { sendAlert } = require('$WORKSPACE/scripts/health-sync/telegram_alert');
  const fs = require('fs');
  const summary = fs.readFileSync('$OUTPUT_FILE', 'utf8');
  // Extract each section: header + first few bullet points
  const sections = summary.split(/^## /m).slice(1); // skip preamble
  const preview = sections.map(s => {
    const lines = s.trim().split('\n');
    const header = '## ' + lines[0];
    const bullets = lines.slice(1).filter(l => l.match(/^[-*•]/)).slice(0, 3);
    if (bullets.length === 0) return header + '\nNo notable changes this week.';
    return header + '\n' + bullets.join('\n');
  }).join('\n\n');
  // Telegram has a 4096 char limit — truncate if needed
  // Strip markdown formatting that breaks Telegram's parser
  const clean = preview.replace(/\*\*/g, '').replace(/\`/g, '').slice(0, 3500);
  const msg = '📝 Weekly Memory Summary (${WEEK_LABEL})\n\n' + clean;
  sendAlert(msg)
    .then(r => { if (r.ok) console.log('Telegram sent'); else console.error('Send failed:', JSON.stringify(r)); })
    .catch(e => console.error('Error:', e.message));
" 2>/dev/null

log "Weekly memory summary complete"
