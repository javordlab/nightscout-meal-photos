#!/bin/bash
# Fully-detached launcher for the post-edit sync chain.
# Usage: dispatch_async.sh
# Called from PostToolUse hook in ~/.claude/settings.json after health_log.md edits.
# The double-fork + nohup + stdin/stdout/stderr redirect ensures the chain
# is fully orphaned and the calling shell can exit immediately.
#
# Chain (sequential):
#   1. radial_dispatcher.js  — stamps row IDs, syncs to NS + Notion
#   2. normalize_health_log.js — regenerates data/health_log.normalized.json
#   3. sync_ssot_to_mysql.js — mirrors SSoT into health_ssot.health_log_entries
#                              so the entries.html viewer reflects new rows
#                              in seconds instead of waiting for the 30-min cron.
nohup bash -c '
  WS=/Users/javier/.openclaw/workspace
  NODE=/opt/homebrew/bin/node
  cd "$WS"
  "$NODE" "$WS/scripts/radial_dispatcher.js" >> /tmp/health_dispatcher.log 2>&1 < /dev/null
  "$NODE" "$WS/scripts/health-sync/normalize_health_log.js" >> /tmp/health_dispatcher.log 2>&1 < /dev/null
  "$NODE" "$WS/scripts/health-sync/sync_ssot_to_mysql.js" >> /tmp/health_dispatcher.log 2>&1 < /dev/null
' < /dev/null > /dev/null 2>&1 &
disown $! 2>/dev/null || true
