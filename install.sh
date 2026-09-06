#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/Slick.app"
SLACK="/Applications/Slack.app"
EDIST="$ROOT/byoe/node_modules/electron/dist"
EBIN="$EDIST/Electron.app/Contents/MacOS/Electron"
REPO="3kh0/slick"
BETA=0
NO_LAUNCH=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

verify_release_artifact() {
  local file="$1"
  if ! command -v gh >/dev/null 2>&1; then
    printf '    (gh CLI not found; skipping provenance check - https://cli.github.com)\n'
    return 0
  fi
  step "Verifying build provenance"
  local out
  if out="$(gh attestation verify "$file" -R "$REPO" 2>&1)"; then
    echo "    attestation OK (signed by $REPO)"
    return 0
  fi
  printf '\n' >&2
  printf '\033[1;31m!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\033[0m\n' >&2
  printf '\033[1;31m  BUILD PROVENANCE VERIFICATION FAILED\033[0m\n' >&2
  printf '\033[1;31m  This download may have been tampered with.\033[0m\n' >&2
  printf '\033[1;31m  Refusing to install.\033[0m\n' >&2
  printf '\033[1;31m!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\033[0m\n' >&2
  printf '\n%s\n\n' "$out" >&2
  die "refusing to install an unattested or mismatched build"
}
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      echo "Usage: bash install.sh [--beta] [--no-launch] [--slack-app PATH] [--restore-handler]"
      echo "Beta requires a source checkout. Reinstall without --beta to return to stable."
      exit 0 ;;
    --no-launch) NO_LAUNCH=1; shift ;;
    --beta) BETA=1; shift ;;
    --slack-app)
      [ "$#" -ge 2 ] || die "--slack-app needs a path"
      SLACK="${2%/}"
      shift 2
      ;;
    --restore-handler)
      handler com.tinyspeck.slackmacgap && echo "slack:// now opens the official Slack again." || die "could not restore handler"
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
done

if [ "$BETA" -eq 1 ] && [ ! -f "$ROOT/scripts/byoe/build-handoff-app.js" ]; then
  die "--beta requires a source checkout on macOS; clone the beta revision and run bash ./install.sh --beta"
fi

step "Checking prerequisites"
[ "$(uname -s)" = "Darwin" ] || die "Slick only supports macOS :("
[ -f "$SLACK/Contents/Resources/app.asar" ] \
  || die "Slack not found at $SLACK, please install it from slack.com first."
SLACK="$(cd "$(dirname "$SLACK")" && pwd)/$(basename "$SLACK")"
SLACK_CONFIG="$HOME/Library/Application Support/Slick/slick/slack-app-path"
mkdir -p "$(dirname "$SLACK_CONFIG")"
printf '%s\n' "$SLACK" > "$SLACK_CONFIG"

if [ -f "$ROOT/scripts/byoe/build-handoff-app.js" ]; then
  node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null \
    || die "Node.js 18+ is required (found: $(node -v 2>/dev/null || echo none)), please install it from nodejs.org first."

  BETA_ARGS=()
  if [ "$BETA" -eq 1 ]; then
    step "Preflighting beta runtime"
    node "$ROOT/scripts/release/beta.js" "$ROOT" --build
    BETA_ARGS=(--beta)
  fi

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

  mkdir -p "$HOME/Applications"
  TMP="$(mktemp -d "$HOME/Applications/.slick-install.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  STAGED_APP="$TMP/Slick.app"

  BUILD=""
  if command -v git >/dev/null 2>&1; then
    BUILD="$(git -C "$ROOT" tag --list 'v[0-9]*' --sort=-v:refname 2>/dev/null \
      | sed -nE 's/^v([1-9][0-9]*)$/\1/p' | head -1 || true)"
  fi
  BUILD="${BUILD:-0}"
  VERSION="1.0.$BUILD"

  step "Building $APP (Build $BUILD)"
  node "$ROOT/scripts/byoe/build-handoff-app.js" --target "$STAGED_APP" \
    --profile "$HOME/Library/Application Support/Slack" \
    --slack-app "$SLACK" --app-version "$VERSION" --build-number "$BUILD" --allow-non-tmp --force ${BETA_ARGS[@]+"${BETA_ARGS[@]}"} >/dev/null

  step "Installing icon"
  "$ROOT/scripts/byoe/set-icon.sh" "$STAGED_APP" --no-register 2>&1 | while IFS= read -r line; do printf '    %s\n' "$line"; done
else
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi

  step "Finding the latest release"
  JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" \
    || die "could not reach the GitHub, check your internet connection?"
  TAG="$(printf '%s' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  URL="$(printf '%s' "$JSON" | grep -o "https://[^\"]*-mac-$ARCH\.zip" | head -1 || true)"
  [ -n "$URL" ] || die "the latest release (${TAG:-unknown}) has no $ARCH build."
  echo "    Slick $TAG for $ARCH it is!"

  step "Downloading Slick $TAG"
  mkdir -p "$HOME/Applications"
  TMP="$(mktemp -d "$HOME/Applications/.slick-install.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  curl --fail --location --progress-bar -o "$TMP/Slick.zip" "$URL"

  verify_release_artifact "$TMP/Slick.zip"

  ditto -x -k "$TMP/Slick.zip" "$TMP/staged"
  STAGED_APP="$TMP/staged/Slick.app"
  [ -x "$STAGED_APP/Contents/MacOS/Electron" ] || die "release zip did not contain Slick.app"
  [ "$BETA" -eq 0 ] || die "--beta is not supported for downloaded macOS apps: modifying the runtime invalidates code signing. Clone the repo and run ./install.sh --beta instead."
  [ ! -e "$STAGED_APP/Contents/Resources/slick/.slick-beta" ] || die "release unexpectedly enables beta; refusing to modify a signed app"

fi

pkill -f "$APP/Contents/MacOS/Electron" 2>/dev/null || true
wait_gone -f "$APP/Contents/MacOS/Electron"
step "Installing $APP"
mkdir -p "$HOME/Applications"
BACKUP="$(mktemp -d "$HOME/Applications/.slick-previous.XXXXXX")"
if [ -e "$APP" ]; then mv "$APP" "$BACKUP/Slick.app"; fi
if ! mv "$STAGED_APP" "$APP"; then
  [ ! -e "$BACKUP/Slick.app" ] || mv "$BACKUP/Slick.app" "$APP"
  die "could not install staged app; previous install restored"
fi
rm -rf "$BACKUP"

if [ -f "$ROOT/scripts/byoe/build-handoff-app.js" ]; then
  if [ "$BETA" -eq 1 ]; then
    touch "$ROOT/.slick-beta"
  else
    rm -f "$ROOT/.slick-beta"
  fi
fi

step "Registering Slick as the slack:// handler"
handler dev.slick.byoe.handoff || echo "    (could not set handler now; Slick claims it on first launch)"

if [ "$NO_LAUNCH" -eq 0 ]; then
  step "Launching Slick"
  osascript -e 'quit app "Slack"' >/dev/null 2>&1 || true
  wait_gone -x Slack
  open -a "$APP"
fi

printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$APP"
cat <<EOF
Here are some things you might want to know:
- First launch shows a sign-in screen (a different code signature can't decrypt Slack's existing session). Sign in once; it persists.
- Configure the client at Preferences -> Slick tab on the left.
- Make slack:// open the official app again: ./install.sh --restore-handler
EOF

if [ "$BETA" -eq 1 ]; then
  echo "Early-injection beta installed. Automatic Slick updates are disabled."
  echo "Update by rerunning this installer with --beta; omit --beta to return to stable."
else
  echo "Stable loader installed."
fi
