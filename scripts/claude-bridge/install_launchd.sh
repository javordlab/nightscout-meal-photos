#!/bin/bash
# install_launchd.sh — Install one claude-bridge instance as a launchd service.
#
# Usage:
#   bash scripts/claude-bridge/install_launchd.sh                  # default cc_mini sonnet bridge (legacy)
#   bash scripts/claude-bridge/install_launchd.sh haiku            # cc_minihaikubot
#   bash scripts/claude-bridge/install_launchd.sh opus             # cc_miniopusbot
#   bash scripts/claude-bridge/install_launchd.sh codex            # codex_minibot via openclaw codex-bridge agent
#
# For instance=<name>, expects scripts/claude-bridge/config.<name>.json to exist.
# For no arg, uses scripts/claude-bridge/config.json (the original cc_mini bridge).
#
# Each instance gets its own:
#   - launchd label: ai.openclaw.claude-bridge[.<instance>]
#   - state file:    data/claude_bridge_state[_<instance>].json
#   - log file:      data/claude_bridge[_<instance>].log
# So multiple instances can run side by side without clobbering each other.

set -e

WORKSPACE="/Users/javier/.openclaw/workspace"
INSTANCE="${1:-}"

if [ -n "$INSTANCE" ]; then
  CONFIG="$WORKSPACE/scripts/claude-bridge/config.${INSTANCE}.json"
  LABEL="ai.openclaw.claude-bridge.${INSTANCE}"
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  LOGFILE="$WORKSPACE/data/claude_bridge_${INSTANCE}.log"
else
  CONFIG="$WORKSPACE/scripts/claude-bridge/config.json"
  LABEL="ai.openclaw.claude-bridge"
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  LOGFILE="$WORKSPACE/data/claude_bridge.log"
fi

if [ ! -f "$CONFIG" ]; then
  echo "❌ Config file not found: $CONFIG"
  echo "   Create it first (see config.json.example or other config.<instance>.json)."
  exit 1
fi

# Sanity: make sure the bot token in the config is valid before installing.
TOKEN=$(/opt/homebrew/bin/node -e "console.log(require('$CONFIG').botToken || '')")
if [ -z "$TOKEN" ]; then
  echo "❌ No botToken in $CONFIG"
  exit 1
fi
echo "→ Verifying bot token via Telegram getMe..."
GETME=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe")
if ! echo "$GETME" | grep -q '"ok":true'; then
  echo "❌ Bot token rejected by Telegram: $GETME"
  exit 1
fi
USERNAME=$(echo "$GETME" | /opt/homebrew/bin/node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.result.username);});")
echo "  ✅ @${USERNAME}"

# Write launchd plist
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>${WORKSPACE}/scripts/claude-bridge/bridge.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${WORKSPACE}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/javier</string>
        <key>PATH</key>
        <string>/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>BRIDGE_CONFIG</key>
        <string>${CONFIG}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOGFILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOGFILE}</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF
echo "  ✅ Plist written: $PLIST"

# Load it (unload first if already loaded)
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "  ✅ Service loaded as $LABEL"

sleep 2
if launchctl list | grep -q "$LABEL"; then
  echo "  ✅ ${LABEL} is running"
  echo ""
  echo "  Logs:    tail -f $LOGFILE"
  echo "  Stop:    launchctl unload $PLIST"
  echo "  Restart: launchctl unload $PLIST && launchctl load $PLIST"
else
  echo "  ⚠️  Service may not have started — check logs:"
  echo "    tail -f $LOGFILE"
fi
