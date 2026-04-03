# MEMORY.md — Long-Term Memory (Facts Only)

Operational rules live in `AGENTS.md` (canonical). Historical fixes live in `docs/CHANGELOG.md`.

## People
### Javier Ordonez (Javi)
- **Timezone:** America/Los_Angeles
- **Contact:** ordonez@gmail.com | Telegram: 8335333215
- **Notes:** Technical, precise, prefers honesty and directness.

### Maria Dennis
- **Details:** 73yo, 139 lbs, 5'0". Type 2 Diabetes (FreeStyle Libre 3).
- **Meds:** Metformin (500mg breakfast, 500mg lunch, 1000mg dinner), Lisinopril (10mg daily morning), Rosuvastatin (10mg every other morning).
- **Rosuvastatin Cycle:** Anchor date 2026-03-01 (taken).

## Photo Recovery
When a meal entry is logged but missing a photo URL (e.g., after an API timeout mid-session), **never ask Javi to resubmit**. Instead:
1. Check `/Users/javier/.openclaw/media/inbound/` — all Telegram photo attachments are saved there with timestamps.
2. Match the most recent file to the entry timestamp to identify the correct image.
3. Upload it to freeimage.host (Key: `6d207e02198a847aa98d0a2a901485a5`) and attach the URL to the Notion entry + health_log.md.

## Communication Channels
- **Email (AgentMail):** `javordclaw@agentmail.to`
  - **API Key:** Stored in `~/.openclaw/secrets/agentmail_api_key`.
  - **Protocol:** Use this account for automated notifications and to send information to Javi (ordonez@gmail.com) upon request.
  - **Skills:** `agentmail` skill (Python SDK in `.venv_agentmail`, scripts in `skills/agentmail/scripts/`).
- **Web Search (Brave Search):**
  - **API Key:** `BSAS4Bs1x3W5uCLR6tQMLq3NAXxRi6o` (from `openclaw.json`).
  - **Protocol:** Use `curl` to call `https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header for real-time web information.

## Infrastructure
- **Nightscout:** https://p01--sefi--s66fclg7g2lm.code.run (Secret: JaviCare2026)
  - **API Secret (SHA1 hash):** `b3170e23f45df7738434cd8be9cd79d86a6d0f01` (Use this for API calls)
- **Photos:** https://javordlab.github.io/nightscout-meal-photos/

## Model Configuration (Updated 2026-03-21)

### Default Runtime Chain (OpenClaw)
| Priority | Model |
|----------|-------|
| Primary | `ollama/kimi-k2.5:cloud` |
| Fallback #1 | `google-gemini-cli/gemini-3-flash-preview` |
| Fallback #2 | `ollama/qwen2.5-coder:7b` |

### Verification Rule (Mandatory)
- Never mark incidents as fixed without live verification against target systems (Notion UI/API, Nightscout API, deployed dashboard JSON/HTML).

## Model Usage Reference (OpenAI shared traffic)
- OpenAI shared free daily token tiers:
  - **250K/day**: gpt-5.4, gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5, gpt-5-codex, gpt-5-chat-latest, gpt-4.1, gpt-4o, o1, o3.
  - **2.5M/day**: gpt-5.1-codex-mini, gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, o1-mini, o3-mini, o4-mini, codex-mini-latest.
- Important correction from Javi: this second tier is **2.5M** (not 2M).

## CI/CD Pipeline
- Pre-commit hooks validate sync state (0 duplicates allowed)
- Unit tests for entry key generation
- Integration tests with mock APIs
- All changes must pass validation before production deploy

## GitHub Backup (2026-03-22)
All of `~/.openclaw/` and related projects are now versioned on GitHub under `javordlab` (all private). Global git config: `Javier Ordonez <ordonez@gmail.com>`. 27 repos total.

Historical fixes: see `docs/CHANGELOG.md` (Issues 1–24).
