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

# Log rotation settings
MAX_LOG_SIZE=$((50 * 1024 * 1024))  # 50MB — rotate if larger
KEEP_ROTATED=3                       # keep gateway.err.log.1 through .3

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [daily-log-review] $*" >> "$LOG_FILE"; }

# --- Log rotation -----------------------------------------------------------
rotate_if_needed() {
  local f="$1"
  [ -f "$f" ] || return 0
  local size
  size=$(wc -c < "$f" | tr -d ' ')
  if [ "$size" -gt "$MAX_LOG_SIZE" ]; then
    log "Rotating $f (${size} bytes > ${MAX_LOG_SIZE})"
    # Shift existing rotated files
    for i in $(seq $((KEEP_ROTATED - 1)) -1 1); do
      [ -f "${f}.${i}" ] && mv "${f}.${i}" "${f}.$((i + 1))"
    done
    mv "$f" "${f}.1"
    touch "$f"
    # Delete oldest if over limit
    [ -f "${f}.$((KEEP_ROTATED + 1))" ] && rm -f "${f}.$((KEEP_ROTATED + 1))"
  fi
}

rotate_if_needed "$GATEWAY_LOG"
rotate_if_needed "$GATEWAY_ERR"

# --- Extract last 24h of logs -----------------------------------------------
log "Starting daily log review"

# Use awk to filter lines with ISO timestamps within the last 24h.
# Timestamps look like: 2026-04-07T09:04:01.036-07:00
# We compare the date+hour prefix (YYYY-MM-DDTHH) against cutoff.
CUTOFF_ISO=$(date -v-24H '+%Y-%m-%dT%H')
TODAY_DATE=$(date '+%Y-%m-%d')

COMBINED=$(mktemp)
trap 'rm -f "$COMBINED"' EXIT

extract_recent() {
  local src="$1"
  local cutoff="$2"
  [ -f "$src" ] || return 0
  # awk: extract timestamp prefix from start of line, compare lexicographically.
  # Lines without a recognizable timestamp are skipped.
  awk -v cutoff="$cutoff" '
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}/ {
      ts = substr($0, 1, 13)
      if (ts >= cutoff) print
    }
  ' "$src"
}

extract_recent "$GATEWAY_LOG" "$CUTOFF_ISO" > "$COMBINED"

if [ -f "$GATEWAY_ERR" ]; then
  echo "--- gateway.err.log ---" >> "$COMBINED"
  extract_recent "$GATEWAY_ERR" "$CUTOFF_ISO" >> "$COMBINED"
fi

# Truncate if too large (keep last 50KB to stay within context)
if [ $(wc -c < "$COMBINED") -gt 51200 ]; then
  tail -c 51200 "$COMBINED" > "${COMBINED}.tmp" && mv "${COMBINED}.tmp" "$COMBINED"
fi

LINE_COUNT=$(wc -l < "$COMBINED" | tr -d ' ')
log "Collected $LINE_COUNT lines of logs (cutoff: $CUTOFF_ISO)"

if [ "$LINE_COUNT" -lt 5 ]; then
  log "Too few log lines ($LINE_COUNT), skipping review"
  exit 0
fi

PROMPT="You are reviewing OpenClaw gateway logs for the last 24 hours.
Report ONLY actionable items: service down, repeated auth failures, crash loops, security issues.
Be concise. If nothing actionable, respond with exactly: NO_REPLY

IGNORE these known non-issues (they are normal and not actionable):
- 'No API key found for provider anthropic' — OAuth auto-refreshes via refresh token; stale access tokens are expected
- 'refresh_token_reused' for openai-codex — known OAuth token race condition, self-healing
- gh-pages deploy warnings — cosmetic, does not affect data sync
- ChatGPT usage limit / rate_limit fallback decisions — normal model fallback behavior
- 'candidate_failed' / 'candidate_succeeded' model fallback logs — normal failover

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
