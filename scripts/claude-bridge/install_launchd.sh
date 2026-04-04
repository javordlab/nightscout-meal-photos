#!/bin/bash
# install_launchd.sh — Install claude-bridge as a launchd service
# Runs automatically on login, restarts on crash.
# Usage: bash scripts/claude-bridge/install_launchd.sh YOUR_BOT_TOKEN

set -e

WORKSPACE="/Users/javier/.openclaw/workspace"
PLIST="$HOME/Library/LaunchAgents/ai.openclaw.claude-bridge.plist"
TOKEN="${1:-}"

if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <bot_token>"
  echo "Get token from BotFather: https://t.me/BotFather"
  exit 1
fi

# Write config
cat > "$WORKSPACE/scripts/claude-bridge/config.json" <<EOF
{
  "botToken": "$TOKEN"
}
EOF
echo "✅ config.json written"

# Write launchd plist
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.claude-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>$WORKSPACE/scripts/claude-bridge/bridge.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$WORKSPACE</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/javier</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$WORKSPACE/data/claude_bridge.log</string>
    <key>StandardErrorPath</key>
    <string>$WORKSPACE/data/claude_bridge.log</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF
echo "✅ LaunchAgent plist written"

# Load it
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✅ Service loaded"

sleep 2
if launchctl list | grep -q "claude-bridge"; then
  echo "✅ claude-bridge is running"
  echo ""
  echo "Logs: tail -f $WORKSPACE/data/claude_bridge.log"
  echo "Stop: launchctl unload $PLIST"
else
  echo "⚠️  Service may not have started — check logs:"
  echo "    tail -f $WORKSPACE/data/claude_bridge.log"
fi
