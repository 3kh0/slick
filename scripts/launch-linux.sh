#!/bin/bash
# launch-linux.sh [--debug [port]]
set -u

TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/slick/app"
EBIN="$TARGET/electron"

DEBUG=()

if [ "${1:-}" = "--debug" ]; then
  shift
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    DEBUG=(--remote-debugging-port="$1")
    shift
  else
    DEBUG=(--remote-debugging-port=9223)
  fi
fi

SLICK_LAUNCH_T0="$(date +%s%3N 2>/dev/null || echo '')"
export SLICK_LAUNCH_T0

[ -e "$EBIN" ] || {
  echo "BYOE Electron missing, run ./install-linux.sh"
  exit 1
}

exec "$EBIN" --no-sandbox "${DEBUG[@]}" "$@"
