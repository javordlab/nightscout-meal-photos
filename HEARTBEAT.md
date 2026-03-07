# HEARTBEAT.md

# If everything is healthy, respond with ONLY: HEARTBEAT_OK
# This will suppress the notification.

### Response Rule
- If all checks pass and no manual intervention is needed, reply with EXACTLY: HEARTBEAT_OK
- DO NOT provide a status report or use emojis unless a CRITICAL error is found.
- The single word HEARTBEAT_OK is mandatory for silence.

### Checks
- Gateway: verify `openclaw status` shows reachable.
- Telegram: verify poller active.
- Sync: run `git add . && git commit -m "chore: automated heartbeat sync" && git push origin main` if dirty, then verify `git status` clean.
- **IGNORE "0 paired nodes"**. Do not check `nodes status`.
