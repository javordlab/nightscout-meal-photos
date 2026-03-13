# HEARTBEAT.md
- Reply EXACTLY: HEARTBEAT_OK (if healthy).
- **Checks:**
  1. `openclaw status`: Gateway reachable? Telegram ON?
  2. Auto-Sync: `git add . && git commit -m "chore: heartbeat sync" && git push origin main`.
  3. `git status`: Clean?
- Ignore "0 paired nodes".
