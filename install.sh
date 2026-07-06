#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/Slick.app"
SLACK="/Applications/Slack.app"
EDIST="$ROOT/byoe/node_modules/electron/dist"
EBIN="$EDIST/Electron.app/Contents/MacOS/Electron"

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
wait_gone() { for _ in {1..20}; do pgrep "$@" >/dev/null 2>&1 || return 0; sleep 0.25; done; }
handler() { # handler <bundle-id> — make that app the slack:// URL handler
  xcode-select -p >/dev/null 2>&1 || return 1
  BUNDLE_ID="$1" swift - <<'EOF' 2>/dev/null
import CoreServices
import Foundation
let id = ProcessInfo.processInfo.environment["BUNDLE_ID"]!
exit(LSSetDefaultHandlerForURLScheme("slack" as NSString as CFString, id as NSString as CFString) == 0 ? 0 : 1)
EOF
}

if [ "${1:-}" = "--restore-handler" ]; then
  handler com.tinyspeck.slackmacgap && echo "slack:// now opens the official Slack again." || die "could not restore handler"
  exit 0
fi

step "Checking prerequisites"
[ "$(uname -s)" = "Darwin" ] || die "Slick only supports macOS :("
[ -f "$SLACK/Contents/Resources/app.asar" ] \
  || die "Slack not found at $SLACK, please install it from slack.com first."

if [ -f "$ROOT/scripts/byoe/build-handoff-app.js" ]; then
  node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null \
    || die "Node.js 18+ is required (found: $(node -v 2>/dev/null || echo none)), please install it from nodejs.org first."

  EVER="$(/usr/bin/plutil -extract CFBundleVersion raw -o - \
    "$SLACK/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist")"
  [ -n "$EVER" ] || die "Could not read Slack's Electron version."
  echo "    Slack ships Electron $EVER"

  HAVE="$(cat "$EDIST/version" 2>/dev/null || true)"
  if [ -x "$EBIN" ] && [ "${HAVE%%.*}" = "${EVER%%.*}" ]; then
    step "Electron $HAVE already installed (major matches Slack)"
  else
    step "Installing Electron $EVER into byoe/ (~100MB download)"
    cd "$ROOT/byoe"
    npmi() { npm install --no-save --no-package-lock --no-audit --no-fund "$@"; }
    if command -v bun >/dev/null 2>&1; then bun add --exact "electron@$EVER" || bun add "electron@${EVER%%.*}"
    elif command -v npm >/dev/null 2>&1; then npmi "electron@$EVER" || npmi "electron@${EVER%%.*}"
    else die "Need bun or npm to install Electron!"
    fi
    [ -x "$EBIN" ] || node node_modules/electron/install.js || true
    if [ ! -x "$EBIN" ]; then
      ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v$EVER-darwin-*.zip" 2>/dev/null | head -1)"
      [ -n "$ZIP" ] || die "Electron install failed: no Electron.app and no cached zip."
      step "Extracting $(basename "$ZIP") manually"
      mkdir -p "$EDIST" && ditto -x -k "$ZIP" "$EDIST"
    fi
    [ -x "$EBIN" ] || die "Electron install failed — $EBIN missing."
    echo "    Electron $(cat "$EDIST/version") ready"
    cd "$ROOT"
  fi

  pkill -f "$APP/Contents/MacOS/Electron" 2>/dev/null || true
  wait_gone -f "$APP/Contents/MacOS/Electron"

  BUILD=""
  if command -v git >/dev/null 2>&1; then
    BUILD="$(git -C "$ROOT" tag --list 'v[0-9]*' --sort=-v:refname 2>/dev/null \
      | sed -nE 's/^v([1-9][0-9]*)$/\1/p' | head -1 || true)"
  fi
  BUILD="${BUILD:-0}"
  VERSION="1.0.$BUILD"

  step "Building $APP (Build $BUILD)"
  node "$ROOT/scripts/byoe/build-handoff-app.js" --target "$APP" \
    --profile "$HOME/Library/Application Support/Slack" \
    --app-version "$VERSION" --build-number "$BUILD" --allow-non-tmp --force >/dev/null

  step "Installing icon"
  "$ROOT/scripts/byoe/set-icon.sh" 2>&1 | while IFS= read -r line; do printf '    %s\n' "$line"; done
else
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi

  step "Finding the latest release"
  JSON="$(curl -fsSL "https://api.github.com/repos/3kh0/slick/releases/latest")" \
    || die "could not reach the GitHub, check your internet connection?"
  TAG="$(printf '%s' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  URL="$(printf '%s' "$JSON" | grep -o "https://[^\"]*-mac-$ARCH\.zip" | head -1 || true)"
  [ -n "$URL" ] || die "the latest release (${TAG:-unknown}) has no $ARCH build."
  echo "    Slick $TAG for $ARCH it is!"

  step "Downloading Slick $TAG"
  TMP="$(mktemp -d /tmp/slick-install.XXXXXX)"
  trap 'rm -rf "$TMP"' EXIT
  curl --fail --location --progress-bar -o "$TMP/Slick.zip" "$URL"

  pkill -f "$APP/Contents/MacOS/Electron" 2>/dev/null || true
  wait_gone -f "$APP/Contents/MacOS/Electron"

  step "Installing $APP"
  mkdir -p "$HOME/Applications"
  rm -rf "$APP"
  ditto -x -k "$TMP/Slick.zip" "$HOME/Applications"
  [ -d "$APP" ] || die "release zip did not contain Slick.app"

fi

step "Registering Slick as the slack:// handler"
handler dev.slick.byoe.handoff || echo "    (could not set handler now; Slick claims it on first launch)"

step "Launching Slick"
osascript -e 'quit app "Slack"' >/dev/null 2>&1 || true
wait_gone -x Slack
open -a "$APP"

printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$APP"
cat <<EOF
Here are some things you might want to know:
- First launch shows a sign-in screen (a different code signature can't decrypt Slack's existing session). Sign in once; it persists.
- Configure the client at Preferences -> Slick tab on the left.
- Make slack:// open the official app again: ./install.sh --restore-handler
EOF
