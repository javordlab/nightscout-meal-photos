# MEMORY.md — Long-Term Memory

_Last updated: 2026-02-26 06:45 PM PST_

## People

### Javier Ordonez (Javi)
- Email: ordonez@gmail.com
- Telegram ID: 8335333215
- GitHub: javordlab (private repo: openclaw-workspace)
- Timezone: America/Los_Angeles
- Technical, asks good questions, catches inconsistencies — be precise and honest

### Maria Dennis (Javi's wife)
- Type 2 Diabetes, FreeStyle Libre 3 CGM
- Telegram ID: 8738167445
- Speaks English and Spanish
- Communicates primarily via voice messages in Telegram group
- Medication: 1500mg Metformin HCL (nightly, ~9 PM); 10mg Lisinopril (daily morning); 10mg Rosuvastatin (every other morning).
- Recurring med logging protocol (confirmed 2026-02-26): log Lisinopril daily + Rosuvastatin every other day without requiring daily Telegram posts. Anchor date for Rosuvastatin cycle: 2026-02-26 taken; next due dates include 2026-02-28, 2026-03-02, ...
- Timing rule: log both at breakfast entry time when present; if no breakfast entry by 11:00 AM PT, log meds at 11:00 AM PT.
- Patient ID: 446dcd1b-c6f2-11ee-9e32-4e8e6fd5ce94
- LibreLinkUp follower account: librelinkup@javierordonez.com

## Infrastructure

### Nightscout (CGM Monitoring)
- URL: https://p01--sefi--s66fclg7g2lm.code.run
- Hosted on Northflank (free tier), service name: "sefi"
- API_SECRET: JaviCare2026 (SHA1: b3170e23f45df7738434cd8be9cd79d86a6d0f01)
- Bridge: "sefi2" (timoschlueter/nightscout-librelink-up:latest v3.2.0)
- Bridge env: LINK_UP_REGION=US (uppercase!), NIGHTSCOUT_URL without https:// prefix
- Treatment push: POST /api/v1/treatments.json with api-secret header (SHA1 hash)
- Event types: "Meal Bolus" for food, "Note" for meds, "Exercise" for activity
- MongoDB: mongodb://...@mongo-0.mongo--s66fclg7g2lm.addon.code.run:27017/...
- **CORS:** Enabled via `ENABLE=cors ...` in Northflank env vars.

### Meal Photos Page
- Public URL: https://javordlab.github.io/nightscout-meal-photos/
- GitHub Repo: https://github.com/javordlab/nightscout-meal-photos (public)
- Function: Pulls "Meal Bolus" treatments from Nightscout and displays embedded photo links.
- **PHOTO PROTOCOL (Revised 2026-02-26):** Use `freeimage.host` (iili.io) for all photo uploads. GitHub pushes for image storage are DEPRECATED. The gallery site reads `iili.io` links directly from Nightscout notes.

### Telegram Group ("Food log")
- Group ID: -5262020908
- Bot: @Javordclaws_bot (token: 8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0)
- Privacy mode disabled, bot is admin, processes messages without @mention
- dmPolicy: pairing, groupPolicy: allowlist, allowFrom: [8335333215, 8738167445]
- dmScope: per-channel-peer

### GitHub
- Repo: https://github.com/javordlab/openclaw-workspace.git (private)
- .gitignore excludes: secrets/, .openclaw/, tmp/, input/, *.MOV, *.HEIC, *.mp4
- Heartbeat-based auto-sync enabled

### Cron Jobs
- Daily glucose summary: ID 30ffd883-4e5c-488c-a242-d3788da0bcef (9:30 AM PT)
- Daily log review: ID e4b06f9e-85fa-4799-8534-1e9ee1bff831 (9:45 AM PT, to Javi)
- Both have had "cron announce delivery failed" errors — needs investigation

## Models & Auth
- Primary: google-antigravity/gemini-3-flash (1M context, best for this use case)
- Fallbacks: gemini-3-flash → ollama/qwen2.5-coder:14b → ollama/qwen2.5-coder:7b → openai-codex/gpt-5.3-codex
- Sandbox: Active (Docker-based) for all model runs.

## Clinical
- GMI formula: GMI(%) = 3.31 + 0.02392 × [mean glucose mg/dL] — needs ≥14 days
- Glucose target range: 70–180 mg/dL (standard)
- Report tone: honest, grounded, positive reinforcement without being overly optimistic

## Unresolved
- Siri Shortcut for Maria's voice logging — Telegram not appearing in Shortcuts (Siri permissions issue)
- Exercise treatment icons may not display on Nightscout graph by default
- Cron delivery errors (gateway timeout) — needs debugging
- AUTH_DEFAULT_ROLES should be changed from admin to readable on Nightscout (security)
