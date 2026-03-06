# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.

- [ ] After reboot: bring up sleep proxy in screen (`screen -dmS sleep-proxy node /Users/javier/.openclaw/workspace/webhook-proxy.js`) and verify automation prerequisites
- [ ] Before morning cron window (9:20 AM PT): quick preflight — verify gateway running, single Telegram poller active, and no relay reconnect storm in logs (ignore "0 paired nodes")
- [ ] Track only NEW or recurring unresolved issues from this point forward (clear slate applied; do not keep repeating historical resolved items)
- [ ] Sync workspace to GitHub (git add . && git commit -m "chore: automated heartbeat sync" && git push origin main)
- [ ] If all checks pass and no NEW manual action is needed, respond with ONLY: HEARTBEAT_OK
