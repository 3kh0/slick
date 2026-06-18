#!/bin/bash
# launch-byoe.sh [--debug [port]] (dport is for checks only)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EBIN="$ROOT/byoe/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ASAR="/Applications/Slack.app/Contents/Resources/app.asar"

DEBUG=()
[ "${1:-}" = "--debug" ] && DEBUG=(--remote-debugging-port="${2:-9223}")

SLICK_LAUNCH_T0=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000' 2>/dev/null || echo '')
export SLICK_LAUNCH_T0

[ -f "$EBIN" ] || { echo "BYO Electron missing, run ./install.sh"; exit 1; }
[ -f "$ASAR" ] || { echo "Slack not found at /Applications/Slack.app"; exit 1; }

# block for ABI mismatch
# override: SLICK_FORCE=1
SVER=$(/usr/bin/plutil -extract CFBundleVersion raw -o - \
  "/Applications/Slack.app/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist" 2>/dev/null)
BVER=$(cat "$ROOT/byoe/node_modules/electron/dist/version" 2>/dev/null)
if [ -n "$SVER" ] && [ "${SVER%%.*}" != "${BVER%%.*}" ] && [ "${SLICK_FORCE:-}" != "1" ]; then
  echo "REFUSING: Slack Electron major $SVER != BYO Electron $BVER — native modules would ABI-crash."
  echo "  Re-run ./install.sh to match, or set SLICK_FORCE=1 to try anyway."
  exit 1
fi

osascript -e 'quit app "Slack"' >/dev/null 2>&1 || true
for _ in {1..20}; do pgrep -x Slack >/dev/null 2>&1 || break; sleep 0.25; done

exec "$EBIN" ${DEBUG[@]+"${DEBUG[@]}"} --require "$ROOT/scripts/byoe/inject.js" "$ASAR"
