#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Applications/Slick.app"
PL="$APP/Contents/Info.plist"
SRC="$ROOT/assets/desktop.png"

[ "$#" -eq 0 ] || { echo "usage: scripts/byoe/set-icon.sh"; exit 2; }
[ -d "$APP" ] || { echo "Slick.app not found at $APP; run ./install.sh first."; exit 1; }
[ -f "$SRC" ] || { echo "source not found: $SRC"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ICNS="$TMP/slick.icns"

echo "rendering icon (compiling renderer)..."
CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$TMP/clang-module-cache}" \
  swift "$ROOT/scripts/byoe/gen-icon.swift" "$SRC" "$ICNS" >/dev/null

ICONKEY="$(/usr/bin/plutil -extract CFBundleIconFile raw -o - "$PL" 2>/dev/null || echo electron.icns)"
case "$ICONKEY" in *.icns) ;; *) ICONKEY="$ICONKEY.icns" ;; esac
cp "$ICNS" "$APP/Contents/Resources/$ICONKEY"

echo "signing app bundle (slow on a fresh build, hang tight)..."
/usr/bin/codesign --force --deep --sign - "$APP"
touch "$APP"
echo "registering with Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
killall Dock 2>/dev/null || true
echo "installed icon -> $APP/Contents/Resources/$ICONKEY ($(du -h "$APP/Contents/Resources/$ICONKEY" | cut -f1))"
