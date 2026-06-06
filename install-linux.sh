#!/bin/bash
# Slick one-step installer (Linux/Wayland). Safe to re-run.
# ./install-linux.sh                    install/update + launch
# ./install-linux.sh --no-launch        install/update only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$ROOT/byoe/slick-linux"

LINUX_SLACK_PATHS=(
  "/usr/lib/slack"
  "/opt/Slack"
  "/opt/slack"
  "$HOME/.local/share/slack"
)

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
wait_gone() { for _ in {1..20}; do pgrep "$@" >/dev/null 2>&1 || return 0; sleep 0.25; done; }

find_slack() {
  for p in "${LINUX_SLACK_PATHS[@]}"; do
    if [ -f "$p/resources/app.asar" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

get_electron_version() {
  local dir="$1"
  if [ -f "$dir/version" ]; then
    cat "$dir/version"
  else
    local out
    out=$("$dir/slack" --version 2>/dev/null || true)
    echo "$out" | grep -oP '\d+\.\d+\.\d+' | head -1
  fi
}

find_system_electron() {
  local major="$1"
  for dir in /usr/lib/electron${major} /usr/lib/electron; do
    if [ -x "$dir/electron" ]; then
      local ver
      ver=$("$dir/electron" --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || true)
      if [ -n "$ver" ] && [ "${ver%%.*}" = "$major" ]; then
        echo "$dir/electron"
        return 0
      fi
    fi
  done
  return 1
}

NO_LAUNCH=0
for arg in "$@"; do
  [ "$arg" = "--no-launch" ] && NO_LAUNCH=1
done

step "Checking prerequisites"
[ "$(uname -s)" = "Linux" ] || die "This installer is for Linux only. Use install.sh for macOS."
SLACK_DIR="$(find_slack)" || die "Slack not found. Install slack-desktop from AUR first:
  paru -S slack-desktop"
echo "    Slack found at $SLACK_DIR"
node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null \
  || die "Node.js 18+ is required (found: $(node -v 2>/dev/null || echo none))."

SVER="$(get_electron_version "$SLACK_DIR")"
[ -n "$SVER" ] || die "Could not read Slack's Electron version."
SMJOR="${SVER%%.*}"
echo "    Slack ships Electron $SVER"

SYS_EBIN=""
if SYS_EBIN="$(find_system_electron "$SMJOR")"; then
  step "Using system Electron ($SYS_EBIN)"
else
  step "No system Electron $SMJOR.x found. Installing via npm..."
  EDIST="$ROOT/byoe/node_modules/electron/dist"
  EBIN="$EDIST/electron"
  cd "$ROOT/byoe"
  npmi() { npm install --no-save --no-package-lock --no-audit --no-fund "$@"; }
  if command -v bun >/dev/null 2>&1; then
    bun add --exact "electron@$SVER" || bun add "electron@${SMJOR}"
  elif command -v npm >/dev/null 2>&1; then
    npmi "electron@$SVER" || npmi "electron@${SMJOR}"
  else
    die "Need bun or npm to install Electron!"
  fi
  [ -x "$EBIN" ] || node node_modules/electron/install.js || true
  [ -x "$EBIN" ] || die "Electron install failed — $EBIN missing."
  SYS_EBIN="$EBIN"
  echo "    Electron $(cat "$EDIST/version" 2>/dev/null || echo unknown) ready"
  cd "$ROOT"
fi

pkill -f "slick-linux/electron" 2>/dev/null || true
wait_gone -f "slick-linux/electron"

step "Building $TARGET"
node "$ROOT/scripts/byoe/build-handoff-linux.js" --target "$TARGET" --force >/dev/null

step "Installing icon"
ICON_SRC="$ROOT/assets/icon.png"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
if [ -f "$ICON_SRC" ]; then
  mkdir -p "$ICON_DIR"
  cp "$ICON_SRC" "$ICON_DIR/slick.png"
  echo "    Icon installed to $ICON_DIR/slick.png"
else
  echo "    (no icon found at $ICON_SRC, skipping)"
fi

step "Installing desktop file"
DESKTOP_SRC="$TARGET/slick.desktop"
DESKTOP_DIR="$HOME/.local/share/applications"
if [ -f "$DESKTOP_SRC" ]; then
  mkdir -p "$DESKTOP_DIR"
  cp "$DESKTOP_SRC" "$DESKTOP_DIR/dev.slick.byoe.desktop"
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  echo "    Desktop file installed to $DESKTOP_DIR/dev.slick.byoe.desktop"
else
  echo "    (no .desktop file found, skipping)"
fi

step "Registering as slack:// handler"
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default dev.slick.byoe.desktop x-scheme-handler/slack 2>/dev/null || true
  echo "    Registered slack:// handler via xdg-mime"
fi

if [ "$NO_LAUNCH" = "1" ]; then
  printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$TARGET"
  cat <<'EOF'
Launch with: ./scripts/launch-linux.sh
Or find "Slick" in your app launcher.
EOF
  exit 0
fi

step "Launching Slick"
pkill -x slack 2>/dev/null || true
wait_gone -x slack

if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  echo "    Wayland detected ($WAYLAND_DISPLAY)"
else
  echo "    X11 fallback"
fi

"$ROOT/scripts/launch-linux.sh" &
disown

printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$TARGET"
cat <<'EOF'
Here are some things you might want to know:
- First launch shows a sign-in screen (a different code signature can't decrypt Slack's existing session). Sign in once; it persists.
- Configure the client at Preferences -> Slick tab on the left.
- Re-run ./install-linux.sh any time to keep things fresh (e.g. after Slack updates).
- Launch manually: ./scripts/launch-linux.sh
- Debug mode: ./scripts/launch-linux.sh --debug [port]
EOF
