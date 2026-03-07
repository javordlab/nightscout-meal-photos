# HEARTBEAT.md

### MANDATORY RESPONSE RULE
- If all checks below pass, reply with EXACTLY: HEARTBEAT_OK
- NO summaries, NO emojis, NO bullet points allowed unless a CRITICAL failure is found.

### Checks
1. Gateway: run `openclaw status` and verify "reachable".
2. Telegram: run `openclaw status` and verify "ON".
3. Auto-Sync: ALWAYS run `git add . && git commit -m "chore: heartbeat sync" && git push origin main`.
4. Final Verification: run `git status` and verify "clean".
5. IGNORE "0 paired nodes".
