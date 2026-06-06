#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets/desktop.png"
OUT="$ROOT/assets/desktop.icns"

[ "$#" -eq 0 ] || { echo "usage: scripts/byoe/render-icon.sh"; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "icon rendering requires macOS"; exit 1; }
[ -f "$SRC" ] || { echo "source not found: $SRC"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "rendering $OUT..."
CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$TMP/clang-module-cache}" \
  swift "$ROOT/scripts/byoe/gen-icon.swift" "$SRC" "$OUT" >/dev/null
echo "rendered $OUT ($(du -h "$OUT" | cut -f1))"
