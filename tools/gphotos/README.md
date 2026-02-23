# Google Photos local API helper (experimental)

This gives you a local CLI workflow for Google Photos API auth + album creation experiments.

## Reality check (important)

Google Photos API access has tightened over time. Depending on your project/scopes, you may **not** be able to freely manipulate all existing library items the same way the web app can.

So this tool is useful for testing API feasibility quickly, but final bulk curation may still require web flow.

## Setup

1. In Google Cloud Console, create OAuth Desktop credentials.
2. Enable Google Photos Library API.
3. Save credentials JSON locally (example):
   - `/Users/javier/.openclaw/workspace/secrets/google-photos-client.json`

## Commands

Use workspace venv:

```bash
source /Users/javier/.openclaw/workspace/.venv/bin/activate
python /Users/javier/.openclaw/workspace/tools/gphotos/gphotos_cli.py auth-check \
  --client-secrets /Users/javier/.openclaw/workspace/secrets/google-photos-client.json
```

Create album:

```bash
python /Users/javier/.openclaw/workspace/tools/gphotos/gphotos_cli.py create-album \
  --client-secrets /Users/javier/.openclaw/workspace/secrets/google-photos-client.json \
  --title "Fukuoka"
```

List app-visible albums:

```bash
python /Users/javier/.openclaw/workspace/tools/gphotos/gphotos_cli.py list-albums \
  --client-secrets /Users/javier/.openclaw/workspace/secrets/google-photos-client.json
```

## Notes

- OAuth token is cached at `tools/gphotos/token.json`.
- Scope used: `https://www.googleapis.com/auth/photoslibrary`.
- This is intentionally minimal so we can validate access before building city/date/radius automation.
