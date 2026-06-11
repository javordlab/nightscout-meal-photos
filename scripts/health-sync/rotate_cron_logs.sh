#!/bin/bash
# rotate_cron_logs.sh — keep the cron log files bounded.
# data/cron_health.log reached 668 MB (2026-06-10) with no rotation ever.
# Policy: when a log exceeds MAX_BYTES, gzip it to <name>.1.gz (overwriting the
# previous generation) and start a fresh file. One compressed generation is
# enough history for debugging; anything older was never looked at anyway.
set -u
WORKSPACE="/Users/javier/.openclaw/workspace"
MAX_BYTES=$((50 * 1024 * 1024)) # 50 MB

for LOG in "$WORKSPACE/data/cron_health.log" "$WORKSPACE/data/cron_watchdog.log"; do
  [ -f "$LOG" ] || continue
  SIZE=$(stat -f%z "$LOG" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt "$MAX_BYTES" ]; then
    rm -f "$LOG.1.gz"
    # mv+recreate (not copytruncate): appenders with O_APPEND fds keep writing
    # to the rotated inode until their next open — fine for short-lived cron
    # scripts, which reopen on every run.
    mv "$LOG" "$LOG.1"
    : > "$LOG"
    gzip "$LOG.1"
    echo "$(date '+%Y-%m-%d %H:%M:%S') rotated $(basename "$LOG") ($SIZE bytes) -> $(basename "$LOG").1.gz"
  fi
done

# Bridge logs (data/claude_bridge*.log): the bridge daemons are LONG-LIVED and
# launchd holds an O_APPEND fd on these files — mv+recreate would strand all
# future writes on the rotated inode until the next daemon restart. Use
# copy-then-truncate instead: a small window of lines written between cp and
# truncate may be lost, which is acceptable for a debug log.
for LOG in "$WORKSPACE"/data/claude_bridge*.log; do
  [ -f "$LOG" ] || continue
  SIZE=$(stat -f%z "$LOG" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt "$MAX_BYTES" ]; then
    cp "$LOG" "$LOG.1" && gzip -f "$LOG.1" && : > "$LOG"
    echo "$(date '+%Y-%m-%d %H:%M:%S') rotated $(basename "$LOG") ($SIZE bytes) -> $(basename "$LOG").1.gz (copy-truncate)"
  fi
done
