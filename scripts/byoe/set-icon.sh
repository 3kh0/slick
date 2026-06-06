#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Applications/Slick.app"
PL="$APP/Contents/Info.plist"
ICNS="$ROOT/assets/desktop.icns"

[ "$#" -eq 0 ] || { echo "usage: scripts/byoe/set-icon.sh"; exit 2; }
[ -d "$APP" ] || { echo "Slick.app not found at $APP; run ./install.sh first."; exit 1; }
[ -f "$ICNS" ] || { echo "icon not found: $ICNS"; exit 1; }

ICONKEY="$(/usr/bin/plutil -extract CFBundleIconFile raw -o - "$PL" 2>/dev/null || echo electron.icns)"
case "$ICONKEY" in *.icns) ;; *) ICONKEY="$ICONKEY.icns" ;; esac
echo "installing pre-rendered icon..."
cp "$ICNS" "$APP/Contents/Resources/$ICONKEY"

CAR="$ROOT/assets/Assets.car"
if [ -f "$CAR" ]; then
  echo "installing macOS 26 icon variants..."
  cp "$CAR" "$APP/Contents/Resources/Assets.car"
  /usr/bin/plutil -replace CFBundleIconName -string desktop "$PL"
fi

echo "signing app bundle (slow on a fresh build, hang tight)..."
/usr/bin/codesign --force --deep --sign - "$APP"
touch "$APP"
echo "registering with Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
killall Dock 2>/dev/null || true
echo "installed icon -> $APP/Contents/Resources/$ICONKEY ($(du -h "$APP/Contents/Resources/$ICONKEY" | cut -f1))"
