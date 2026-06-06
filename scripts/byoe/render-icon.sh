#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets/desktop.svg"
OUT="$ROOT/assets/desktop.icns"
ICON="$ROOT/assets/desktop.icon"
CAR="$ROOT/assets/Assets.car"

[ "$#" -eq 0 ] || { echo "usage: scripts/byoe/render-icon.sh"; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "icon rendering requires macOS"; exit 1; }
[ -f "$SRC" ] || { echo "source not found: $SRC"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "rendering $OUT..."
CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$TMP/clang-module-cache}" \
  swift "$ROOT/scripts/byoe/gen-icon.swift" "$SRC" "$OUT" >/dev/null
echo "rendered $OUT ($(du -h "$OUT" | cut -f1))"

if xcrun --find actool >/dev/null 2>&1; then
  echo "compiling $CAR..."
  cp "$SRC" "$ICON/Assets/desktop.svg"
  mkdir -p "$TMP/actool"
  xcrun actool "$ICON" --compile "$TMP/actool" \
    --output-format human-readable-text --notices --warnings --errors \
    --output-partial-info-plist "$TMP/actool/partial.plist" \
    --app-icon desktop --include-all-app-icons \
    --enable-on-demand-resources NO \
    --development-region en \
    --target-device mac \
    --minimum-deployment-target 26.0 \
    --platform macosx >"$TMP/actool/actool.log" \
    || { cat "$TMP/actool/actool.log"; exit 1; }
  cp "$TMP/actool/Assets.car" "$CAR"
  echo "compiled $CAR ($(du -h "$CAR" | cut -f1))"
else
  echo "actool not found (needs full Xcode); skipped $CAR (macOS 26 icon variants)"
fi
