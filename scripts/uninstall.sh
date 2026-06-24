#!/bin/bash
set -u

USER_APP="$HOME/Applications/Slick.app"
SYSTEM_APP="/Applications/Slick.app"
SLACK_APP="/Applications/Slack.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUNDLE_ID="dev.slick.byoe.handoff"
FAIL=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }

[ "$(uname -s)" = "Darwin" ] || { echo "error: Slick only supports macOS." >&2; exit 1; }

handler() {
  xcode-select -p >/dev/null 2>&1 || return 1
  BUNDLE_ID="$1" swift - <<'EOF' 2>/dev/null
import CoreServices
import Foundation
let id = ProcessInfo.processInfo.environment["BUNDLE_ID"]!
exit(LSSetDefaultHandlerForURLScheme("slack" as NSString as CFString, id as NSString as CFString) == 0 ? 0 : 1)
EOF
}

remove_path() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  if /bin/rm -rf "$1" 2>/dev/null; then
    printf '    removed %s\n' "$1"
    return 0
  fi
  if [ "$1" = "$SYSTEM_APP" ] && [ -t 0 ]; then
    echo "    Admin access is required to remove $SYSTEM_APP"
    if /usr/bin/sudo /bin/rm -rf "$1"; then
      printf '    removed %s\n' "$1"
      return 0
    fi
  fi
  warn "could not remove $1"
  FAIL=1
}

step "Stopping Slick"
pkill -f '/Slick.app/Contents/' 2>/dev/null || true
for _ in {1..20}; do
  pgrep -f '/Slick.app/Contents/' >/dev/null 2>&1 || break
  sleep 0.25
done
if pgrep -f '/Slick.app/Contents/' >/dev/null 2>&1; then
  warn "some Slick processes are still running"
  FAIL=1
fi

step "Restoring slack:// to official Slack"
if [ -d "$SLACK_APP" ]; then
  "$LSREGISTER" -f "$SLACK_APP" >/dev/null 2>&1 || true
  if handler com.tinyspeck.slackmacgap; then
    echo "    slack:// now opens official Slack"
  else
    warn "could not restore the slack:// handler; run ./install.sh --restore-handler after installing Xcode Command Line Tools"
    FAIL=1
  fi
else
  warn "official Slack is not installed at $SLACK_APP; slack:// could not be reassigned"
fi

step "Unregistering and removing Slick"
for app in "$USER_APP" "$SYSTEM_APP"; do
  if [ -d "$app" ]; then
    "$LSREGISTER" -u "$app" >/dev/null 2>&1 || true
  fi
  remove_path "$app"
done

step "Purging Slick data"
/usr/bin/tccutil reset All "$BUNDLE_ID" >/dev/null 2>&1 || true
/usr/bin/security delete-generic-password -s 'Slick Safe Storage' >/dev/null 2>&1 || true
/usr/bin/security delete-generic-password -s "$BUNDLE_ID Safe Storage" >/dev/null 2>&1 || true
/usr/bin/defaults delete "$BUNDLE_ID" >/dev/null 2>&1 || true
for path in \
  "$HOME/Library/Application Support/Slick" \
  "$HOME/Library/Application Support/Slack/slick" \
  "$HOME/Library/Application Support/Slack/.slick-notif-prompt" \
  "$HOME/Library/Application Scripts/$BUNDLE_ID" \
  "$HOME/Library/Caches/Slick" \
  "$HOME/Library/Caches/$BUNDLE_ID" \
  "$HOME/Library/Containers/$BUNDLE_ID" \
  "$HOME/Library/Cookies/$BUNDLE_ID.binarycookies" \
  "$HOME/Library/Group Containers/$BUNDLE_ID" \
  "$HOME/Library/HTTPStorages/$BUNDLE_ID" \
  "$HOME/Library/HTTPStorages/$BUNDLE_ID.binarycookies" \
  "$HOME/Library/Logs/Slick" \
  "$HOME/Library/Preferences/$BUNDLE_ID.plist" \
  "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState" \
  "$HOME/Library/WebKit/$BUNDLE_ID" \
  "/tmp/slick" \
  "/private/tmp/slick"; do
  remove_path "$path"
done

step "Removing notification sounds"
if [ -d "$SLACK_APP/Contents/Resources" ] && [ -d "$HOME/Library/Sounds" ]; then
  for mp3 in "$SLACK_APP/Contents/Resources/"*.mp3; do
    [ -e "$mp3" ] || continue
    base="$(basename "${mp3%.mp3}")"
    /bin/rm -f "$HOME/Library/Sounds/$base.caf" 2>/dev/null || true
  done
  echo "    removed installed sounds from ~/Library/Sounds"
fi

BYHOST="$HOME/Library/Preferences/ByHost"
if [ -d "$BYHOST" ]; then
  find "$BYHOST" -maxdepth 1 -type f -name "$BUNDLE_ID.*.plist" -exec /bin/rm -f {} + 2>/dev/null || true
fi

DIAGNOSTICS="$HOME/Library/Logs/DiagnosticReports"
if [ -d "$DIAGNOSTICS" ]; then
  find "$DIAGNOSTICS" -maxdepth 2 -type f \
    \( -name 'Slick_*.crash' -o -name 'Slick_*.hang' -o -name 'Slick_*.ips' -o -name 'Slick-*.ips' \) \
    -exec /bin/rm -f {} + 2>/dev/null || true
fi

for temp_root in /tmp /private/tmp "${TMPDIR:-}"; do
  [ -d "$temp_root" ] || continue
  find "$temp_root" -maxdepth 1 -type d -name 'slick-install.*' -exec /bin/rm -rf {} + 2>/dev/null || true
done

if [ "$FAIL" -ne 0 ]; then
  warn "Slick was partially removed, see the warnings above."
  exit 1
fi

printf '\n\033[1;32mSlick has been fully removed.\033[0m\n'
