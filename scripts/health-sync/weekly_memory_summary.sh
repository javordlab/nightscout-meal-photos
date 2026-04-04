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
OLLAMA_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="deepseek-v3.2:cloud"

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

PROMPT="You are synthesizing daily memory files for the HealthGuard system into a weekly rollup.
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

$(cat "$COMBINED")"

# Primary: Claude via OAuth
RESPONSE=$("$CLAUDE" -p --model sonnet "$PROMPT" 2>/dev/null) || true

# Fallback: Ollama cloud (DeepSeek V3.2) if Claude failed or returned empty
if [ -z "$RESPONSE" ] || echo "$RESPONSE" | grep -qi "not logged in\|error\|unauthorized"; then
  log "Claude unavailable, falling back to Ollama cloud ($OLLAMA_MODEL)"
  RESPONSE=$(curl -s --max-time 300 "$OLLAMA_URL/api/chat" \
    -d "$(jq -n --arg model "$OLLAMA_MODEL" --arg content "$PROMPT" \
      '{model: $model, messages: [{role: "user", content: $content}], stream: false}')" \
    | jq -r '.message.content // empty' 2>/dev/null) || true
  [ -n "$RESPONSE" ] && log "Ollama fallback succeeded" || { log "ERROR: both Claude and Ollama failed"; exit 1; }
fi

# Write the output file
echo "$RESPONSE" > "$OUTPUT_FILE"
log "Wrote weekly summary to $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE" | tr -d ' ') lines)"

# Send full content to Telegram (split into multiple messages if >4096 chars)
"$NODE" -e "
  const https = require('https');
  const fs = require('fs');
  const { getBridgeBotToken, JAVI_CHAT_ID } = require('$WORKSPACE/scripts/health-sync/telegram_alert');
  const raw = fs.readFileSync('$OUTPUT_FILE', 'utf8');
  const clean = raw + '\n---\nFile: $OUTPUT_FILE';
  // Split at 4096 char limit
  const chunks = [];
  for (let i = 0; i < clean.length; i += 4000) chunks.push(clean.slice(i, i + 4000));
  // Send as plain text (no parse_mode) to avoid Markdown parsing issues
  function sendPlain(text) {
    const token = getBridgeBotToken();
    const body = JSON.stringify({ chat_id: JAVI_CHAT_ID, text });
    return new Promise(resolve => {
      const req = https.request({
        hostname: 'api.telegram.org', path: '/bot' + token + '/sendMessage',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
      req.on('error', ()=>resolve({ok:false}));
      req.write(body); req.end();
    });
  }
  (async () => {
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? '(' + (i+1) + '/' + chunks.length + ') ' : '';
      const r = await sendPlain(prefix + chunks[i]);
      if (!r.ok) console.error('Send failed:', JSON.stringify(r));
      else console.log('Telegram sent' + (chunks.length > 1 ? ' part ' + (i+1) : ''));
    }
  })();
" 2>/dev/null

log "Weekly memory summary complete"
