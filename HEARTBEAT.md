# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.

- [ ] At/after 5:00 PM PT: remind Javi of deferred action items from morning shutdown (embeddings quota, API rate limits, Telegram poll conflict, gateway re-pair, browser relay fix)
- [ ] After reboot: bring up sleep proxy in screen (`screen -dmS sleep-proxy node /Users/javier/.openclaw/workspace/webhook-proxy.js`) and verify automation prerequisites
- [ ] Before morning cron window (9:20 AM PT): quick preflight — verify gateway paired, single Telegram poller, and no relay reconnect storm in logs
- [ ] Sync workspace to GitHub (git add . && git commit -m "chore: automated heartbeat sync" && git push origin main)
