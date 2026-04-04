#!/bin/bash
# dump_system_state.sh — Exports live system state to a file Claude Code can read.
# Run this before starting a Claude Code session when you need current cron/job state.
# Usage: bash scripts/dump_system_state.sh

WORKSPACE="/Users/javier/.openclaw/workspace"
OUT="$WORKSPACE/data/system_state.md"
GATEWAY_TOKEN="cf54f0eca340d2156ec36fdd3e820c3faa070afa4a8892a8"
GATEWAY_URL="http://127.0.0.1:18789"

echo "# System State Snapshot" > "$OUT"
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$OUT"
echo "" >> "$OUT"

# --- System Crontab ---
echo "## System Crontab (crontab -l)" >> "$OUT"
echo '```' >> "$OUT"
crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' >> "$OUT"
echo '```' >> "$OUT"
echo "" >> "$OUT"

# --- OpenClaw Cron Jobs ---
echo "## OpenClaw Cron Jobs" >> "$OUT"
openclaw cron list 2>/dev/null >> "$OUT" || echo "(openclaw CLI not available)" >> "$OUT"

# --- Recent Cron Log ---
echo "## Recent Cron Activity (last 20 lines)" >> "$OUT"
echo '```' >> "$OUT"
tail -20 "$WORKSPACE/data/cron_health.log" 2>/dev/null >> "$OUT"
echo '```' >> "$OUT"
echo "" >> "$OUT"

# --- backups.json freshness ---
echo "## Backup Dashboard Freshness" >> "$OUT"
node -e "
const d = require('$WORKSPACE/nightscout-meal-photos/data/backups.json');
const age = Math.round((Date.now() - new Date(d.lastUpdated)) / 60000);
console.log('backups.json last updated: ' + d.lastUpdated + ' (' + age + ' min ago)');
console.log('Status: ' + (age < 70 ? '✅ FRESH' : '⚠️ STALE'));
" >> "$OUT" 2>/dev/null
echo "" >> "$OUT"

# --- Sync state summary ---
echo "## Sync State Summary" >> "$OUT"
node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('$WORKSPACE/data/sync_state.json'));
const entries = Object.keys(s);
const withNotion = entries.filter(k => s[k].notion_page_id).length;
const withNS = entries.filter(k => s[k].nightscout_treatment_id).length;
console.log('Total entries: ' + entries.length);
console.log('With Notion page_id: ' + withNotion);
console.log('With Nightscout treatment_id: ' + withNS);
" >> "$OUT" 2>/dev/null
echo "" >> "$OUT"

echo "✅ State dumped to $OUT"
echo "   Read it in Claude Code: cat data/system_state.md"
