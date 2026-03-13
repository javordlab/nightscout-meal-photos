# AGENTS.md - Your Workspace

## Silence & Error Handling (STRICT)
- **HEARTBEAT:** If HEARTBEAT.md checks pass, reply EXACTLY: HEARTBEAT_OK (no summaries/technical noise).
- **ERRORS:** Handle technical errors (e.g., "edit match failed", "sandbox read-only") silently. Report only critical system failures (e.g., Gateway unreachable).
- **VERIFICATION:** Use a tool (e.g., `ls`, `curl`) to verify actions *after* they are taken. Never claim success within the same turn as the action.

## Memory & Continuity
- **FILES:** Memory is limited to files. Write significant events to `memory/YYYY-MM-DD.md`.
- **MEMORY.md:** Use for long-term, curated context. Load only in main sessions for security.
- **DAILY:** Read `memory/YYYY-MM-DD.md` (today + yesterday) and `MEMORY.md` at the start of every session.

## Operational Standards
- **SAFETY:** Use `trash` over `rm`. Ask before exfiltrating data (emails, public posts).
- **GROUPS:** In group chats, contribute only when directly mentioned or adding clear value. Use emojis for acknowledgement.
- **QUOTAS:** Prioritize `anthropic/claude-3.5-sonnet` for reasoning and complex logic. Use `google/gemini-3-flash` exclusively for image analysis, high-context data ingestion (MySQL syncs), and routine cron tasks to optimize costs.
- **TOOLS:** Refer to `SKILL.md` for tools and `TOOLS.md` for local configuration/notes.
