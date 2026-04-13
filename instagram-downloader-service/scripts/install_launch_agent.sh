#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_SCRIPT="$SCRIPT_DIR/run_worker.sh"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.lifeos.instagram-downloader.plist"
LOG_DIR="${HOME}/Library/Logs/LifeOS"
LABEL="com.lifeos.instagram-downloader"
USER_ID="$(id -u)"

mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${RUNNER_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SERVICE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/instagram-downloader.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/instagram-downloader-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/${USER_ID}" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "$PLIST_PATH"
launchctl enable "gui/${USER_ID}/${LABEL}"
launchctl kickstart -k "gui/${USER_ID}/${LABEL}"

echo "Installed ${LABEL}"
echo "Plist: $PLIST_PATH"
echo "Logs: $LOG_DIR/instagram-downloader.log"
