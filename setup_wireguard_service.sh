#!/usr/bin/env /opt/homebrew/bin/bash
CONF_PATH="/Users/javier/.openclaw/workspace/secrets/wg0.conf"
PLIST_PATH="/Library/LaunchDaemons/com.wireguard.wg0.plist"

cat << 'PLIST' > /tmp/com.wireguard.wg0.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wireguard.wg0</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/wg-quick</string>
        <string>up</string>
        <string>/Users/javier/.openclaw/workspace/secrets/wg0.conf</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/wg0.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/wg0.out</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
PLIST

sudo mv /tmp/com.wireguard.wg0.plist "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"

echo "LaunchDaemon created at $PLIST_PATH"
echo "To activate, run: sudo launchctl load $PLIST_PATH"
