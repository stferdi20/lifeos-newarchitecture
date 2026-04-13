#!/bin/zsh
set -euo pipefail

PLIST_PATH="${HOME}/Library/LaunchAgents/com.lifeos.instagram-downloader.plist"
LABEL="com.lifeos.instagram-downloader"
USER_ID="$(id -u)"

launchctl bootout "gui/${USER_ID}" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl disable "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Removed ${LABEL}"
echo "Deleted plist: $PLIST_PATH"
