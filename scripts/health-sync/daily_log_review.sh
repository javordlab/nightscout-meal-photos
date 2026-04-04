#!/bin/bash
# daily_log_review.sh — Reviews gateway logs for actionable issues.
# Uses claude -p (OAuth) instead of OpenClaw LLM cron.
# Sends Telegram alert only if something actionable is found.
#
# System cron: 15 9 * * * (9:15 AM PT)

set -euo pipefail

WORKSPACE="/Users/javier/.openclaw/workspace"
CLAUDE="/Users/javier/.local/bin/claude"
NODE="/opt/homebrew/bin/node"
GATEWAY_LOG="/Users/javier/.openclaw/logs/gateway.log"
GATEWAY_ERR="/Users/javier/.openclaw/logs/gateway.err.log"
LOG_FILE="$WORKSPACE/data/cron_health.log"
OLLAMA_URL="http://127.0.0.1:11434"
OLLAMA_MODELS=("deepseek-v3.2:cloud" "gpt-oss:120b-cloud")

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [daily-log-review] $*" >> "$LOG_FILE"; }

log "Starting daily log review"

# Extract last 24h of logs (by timestamp grep or tail fallback)
CUTOFF=$(date -v-24H '+%Y-%m-%d')
COMBINED=$(mktemp)
trap 'rm -f "$COMBINED"' EXIT

# Gateway log: take lines from last 24h (or last 500 lines as fallback)
if [ -f "$GATEWAY_LOG" ]; then
  grep -a "$CUTOFF\|$(date '+%Y-%m-%d')" "$GATEWAY_LOG" 2>/dev/null > "$COMBINED" || tail -500 "$GATEWAY_LOG" > "$COMBINED"
fi

# Gateway error log: append last 24h
if [ -f "$GATEWAY_ERR" ]; then
  echo "--- gateway.err.log ---" >> "$COMBINED"
  grep -a "$CUTOFF\|$(date '+%Y-%m-%d')" "$GATEWAY_ERR" 2>/dev/null >> "$COMBINED" || tail -200 "$GATEWAY_ERR" >> "$COMBINED"
fi

# Truncate if too large (keep last 50KB to stay within context)
if [ $(wc -c < "$COMBINED") -gt 51200 ]; then
  tail -c 51200 "$COMBINED" > "${COMBINED}.tmp" && mv "${COMBINED}.tmp" "$COMBINED"
fi

LINE_COUNT=$(wc -l < "$COMBINED" | tr -d ' ')
log "Collected $LINE_COUNT lines of logs"

if [ "$LINE_COUNT" -lt 5 ]; then
  log "Too few log lines ($LINE_COUNT), skipping review"
  exit 0
fi

PROMPT="You are reviewing OpenClaw gateway logs for the last 24 hours.
Report ONLY actionable items: service down, repeated auth failures, crash loops, security issues.
Be concise. If nothing actionable, respond with exactly: NO_REPLY

Here are the logs:
$(cat "$COMBINED")"

# Primary: Claude via OAuth
RESPONSE=$("$CLAUDE" -p --model haiku "$PROMPT" 2>/dev/null) || true

# Fallback chain: gpt-oss (Codex-equivalent) → DeepSeek V3.2 via Ollama
if [ -z "$RESPONSE" ] || echo "$RESPONSE" | grep -qi "not logged in\|error\|unauthorized"; then
  for OLLAMA_MODEL in "${OLLAMA_MODELS[@]}"; do
    log "Claude unavailable, trying fallback: $OLLAMA_MODEL"
    RESPONSE=$(curl -s --max-time 120 "$OLLAMA_URL/api/chat" \
      -d "$(jq -n --arg model "$OLLAMA_MODEL" --arg content "$PROMPT" \
        '{model: $model, messages: [{role: "user", content: $content}], stream: false}')" \
      | jq -r '.message.content // empty' 2>/dev/null) || true
    if [ -n "$RESPONSE" ] && ! echo "$RESPONSE" | grep -qi "error"; then
      log "Fallback $OLLAMA_MODEL succeeded"
      break
    fi
    log "Fallback $OLLAMA_MODEL failed"
  done
fi

log "LLM response: $(echo "$RESPONSE" | head -1)"

# If actionable, send Telegram alert
if [ -n "$RESPONSE" ] && [ "$RESPONSE" != "NO_REPLY" ] && ! echo "$RESPONSE" | grep -qi "^no.reply"; then
  log "Actionable items found, sending Telegram alert"
  "$NODE" -e "
    const { sendAlert } = require('$WORKSPACE/scripts/health-sync/telegram_alert');
    sendAlert('📋 *Daily Log Review ($(date +%b\ %d))*\n\n' + process.argv[1])
      .then(r => { if (r.ok) console.log('Alert sent'); else console.error('Send failed:', JSON.stringify(r)); })
      .catch(e => console.error('Error:', e.message));
  " "$RESPONSE"
else
  log "No actionable items found"
fi

log "Daily log review complete"
