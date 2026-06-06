#!/bin/bash
# launch-linux.sh [--debug [port]] — launch Slick on Linux (Wayland/X11)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EBIN="$TARGET/electron"
WRAPPER_ASAR="$TARGET/resources/app.asar"
SLACK_ASAR="$TARGET/resources/slack.asar"

DEBUG=()
OZONE=()
[ "${1:-}" = "--debug" ] && DEBUG=(--remote-debugging-port="${2:-9223}")

# Detect Wayland session, prefer ozone=wayland
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=wayland)
elif [ -n "${DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=x11)
fi

[ -f "$EBIN" ] || { echo "BYOE Electron missing, run ./install-linux.sh"; exit 1; }
[ -f "$WRAPPER_ASAR" ] || { echo "Wrapper ASAR missing, run ./install-linux.sh"; exit 1; }
[ -f "$SLACK_ASAR" ] || { echo "Slack ASAR missing, run ./install-linux.sh"; exit 1; }

# Check ABI match: compare Slack's Electron version vs the binary we're using
SVER_FILE="$TARGET/resources/.electron-version"
SVER=$(cat "$SVER_FILE" 2>/dev/null || true)
# Get the actual binary version (resolve symlink first)
REAL_EBIN=$(readlink -f "$EBIN" 2>/dev/null || echo "$EBIN")
BVER=$("$REAL_EBIN" --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || true)
if [ -n "$SVER" ] && [ -n "$BVER" ] && [ "${SVER%%.*}" != "${BVER%%.*}" ] && [ "${SLICK_FORCE:-}" != "1" ]; then
  echo "REFUSING: Slack Electron major $SVER != BYO Electron $BVER — native modules would ABI-crash."
  echo "  Re-run ./install-linux.sh to match, or set SLICK_FORCE=1 to try anyway."
  exit 1
fi

# Kill any stale Slick processes from previous manual runs (not from .desktop)
if [ $# -eq 0 ]; then
  pkill -f "slick-linux/electron" 2>/dev/null || true
  for _ in {1..20}; do pgrep -f "slick-linux/electron" >/dev/null 2>&1 || break; sleep 0.25; done
fi

exec "$EBIN" "${OZONE[@]}" "${DEBUG[@]+"${DEBUG[@]}"}" --no-sandbox --require "$ROOT/scripts/byoe/inject.js" "$WRAPPER_ASAR" "$@"
