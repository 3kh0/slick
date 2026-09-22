#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/Slick.app"
SLACK="/Applications/Slack.app"
REPO="3kh0/slick"
NO_LAUNCH=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Per-OS integration differs too much to share, so each OS has its own script.
# Dispatched before argument parsing so the target script sees every argument.
case "$(uname -s)" in
Darwin) ;;
Linux)
  [ -f "$ROOT/install-linux.sh" ] || die "install-linux.sh is missing next to install.sh"
  step "Linux detected; handing over to install-linux.sh"
  exec bash "$ROOT/install-linux.sh" "$@"
  ;;
CYGWIN* | MINGW* | MSYS*)
  die "On Windows, run install.ps1 from PowerShell instead:
    powershell -ExecutionPolicy Bypass -File .\\install.ps1"
  ;;
*)
  die "Unsupported platform: $(uname -s). Slick supports macOS, Linux and Windows."
  ;;
esac

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
      echo "Usage: bash install.sh [--no-launch] [--slack-app PATH] [--restore-handler]"
      exit 0 ;;
    --no-launch) NO_LAUNCH=1; shift ;;
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

step "Checking prerequisites"
[ -f "$SLACK/Contents/Resources/app.asar" ] \
  || die "Slack not found at $SLACK, please install it from slack.com first."
SLACK="$(cd "$(dirname "$SLACK")" && pwd)/$(basename "$SLACK")"
SLACK_CONFIG="$HOME/Library/Application Support/Slick/slick/slack-app-path"
mkdir -p "$(dirname "$SLACK_CONFIG")"
printf '%s\n' "$SLACK" > "$SLACK_CONFIG"

# From a checkout, build; piped from curl, download the latest release.
if [ -f "$ROOT/src/desktop/main.ts" ]; then
  node -e 'process.exit(parseInt(process.versions.node, 10) >= 22 ? 0 : 1)' 2>/dev/null \
    || die "Node.js 22+ is required to build Slick v2 (found: $(node -v 2>/dev/null || echo none))."

  if [ ! -d "$ROOT/node_modules/electron-builder" ]; then
    step "Installing build dependencies"
    if command -v bun >/dev/null 2>&1; then
      (cd "$ROOT" && bun install --frozen-lockfile) || die "dependency install failed"
    elif command -v npm >/dev/null 2>&1; then
      (cd "$ROOT" && npm install --no-audit --no-fund) || die "dependency install failed"
    else
      die "npm or bun is required to install build dependencies."
    fi
  fi

  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi
  # electron-builder names the arm64 directory mac-arm64 and the x64 one mac.
  [ "$ARCH" = "arm64" ] && OUTDIR="mac-arm64" || OUTDIR="mac"

  step "Building Slick v2 (this bundles Electron; give it a minute)"
  ( cd "$ROOT" && node scripts/build.ts package --arch "$ARCH" ) >/dev/null \
    || die "build failed; run 'node scripts/build.ts package --arch $ARCH' to see why"

  BUILT="$ROOT/dist/release/$OUTDIR/Slick.app"
  [ -d "$BUILT" ] || die "electron-builder produced no app at $BUILT"

  mkdir -p "$HOME/Applications"
  TMP="$(mktemp -d "$HOME/Applications/.slick-install.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  STAGED_APP="$TMP/Slick.app"
  # Copied rather than moved, so a failed install does not destroy the build.
  ditto "$BUILT" "$STAGED_APP"

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
  # Older releases name the binary Electron; electron-builder names it Slick.
  [ -x "$STAGED_APP/Contents/MacOS/Slick" ] || [ -x "$STAGED_APP/Contents/MacOS/Electron" ] \
    || die "release zip did not contain Slick.app"

fi

for BIN in Slick Electron; do pkill -f "$APP/Contents/MacOS/$BIN" 2>/dev/null || true; done
for BIN in Slick Electron; do wait_gone -f "$APP/Contents/MacOS/$BIN"; done
step "Installing $APP"
mkdir -p "$HOME/Applications"
BACKUP="$(mktemp -d "$HOME/Applications/.slick-previous.XXXXXX")"
if [ -e "$APP" ]; then mv "$APP" "$BACKUP/Slick.app"; fi
if ! mv "$STAGED_APP" "$APP"; then
  [ ! -e "$BACKUP/Slick.app" ] || mv "$BACKUP/Slick.app" "$APP"
  die "could not install staged app; previous install restored"
fi
rm -rf "$BACKUP"

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
- A new install starts at Slack's sign-in screen (Slick keeps its own session, separate from the official app). Sign in once; it persists, including across updates from v1.
- Configure the client at Preferences -> Slick tab on the left.
- Make slack:// open the official app again: ./install.sh --restore-handler
EOF

