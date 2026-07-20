#!/bin/sh
export SLICK_HANDOFF_PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/slick"
exec zypak-wrapper /app/lib/slick/electron "$@"
