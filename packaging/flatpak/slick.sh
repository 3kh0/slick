#!/bin/sh
export SLICK_HANDOFF_PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/slick"
# Electron's singleton socket must be reachable from the next Flatpak sandbox.
export TMPDIR="${XDG_RUNTIME_DIR:?}/slick"
mkdir -p "$TMPDIR" || exit 1
exec zypak-wrapper /app/lib/slick/electron "$@"
