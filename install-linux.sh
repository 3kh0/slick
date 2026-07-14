#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EDIST="$ROOT/byoe/node_modules/electron/dist"
EBIN="$EDIST/electron"
REPO="3kh0/slick"
SLACK_PATHS=(
  "${SLICK_SLACK_DIR:-}"
  "/usr/lib/slack"
  "/opt/Slack"
  "/opt/slack"
  "$HOME/.local/share/slack"
)
NO_LAUNCH=0
FROM_RELEASE=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

verify_release_artifact() {
  local file="$1"
  if ! command -v gh >/dev/null 2>&1; then
    printf '    (gh CLI not found; skipping provenance check — https://cli.github.com)\n'
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

while [ $# -gt 0 ]; do
  case "$1" in
  --no-launch) NO_LAUNCH=1 ;;
  --from-release) FROM_RELEASE=1 ;;
  --restore-handler)
    command -v xdg-mime >/dev/null 2>&1 || die "xdg-mime not found; can't manage the slack:// handler on this system."
    xdg-mime default slack.desktop x-scheme-handler/slack &&
      {
        echo "slack:// now opens the official Slack again."
        exit 0
      } ||
      die "could not restore handler"
    ;;
  *) die "unknown argument: $1" ;;
  esac
  shift
done

find_slack() {
  local dir
  for dir in "${SLACK_PATHS[@]}"; do
    [ -n "$dir" ] || continue
    [ -f "$dir/resources/app.asar" ] && {
      printf '%s\n' "$dir"
      return 0
    }
  done
  return 1
}

parse_version() {
  grep -Eo '[0-9]+[.][0-9]+[.][0-9]+' | head -1
}

electron_version() {
  "$1" --version 2>/dev/null | parse_version
}

slack_electron_version() {
  local slack_dir="$1"
  if [ -f "$slack_dir/version" ]; then
    parse_version <"$slack_dir/version"
    return 0
  fi
  if [ -x "$slack_dir/slack" ]; then
    "$slack_dir/slack" --version 2>/dev/null | parse_version
    return 0
  fi
}

matching_system_electron() {
  local major="$1"
  local bin version
  for bin in "/usr/lib/electron$major/electron" "/usr/lib/electron/electron"; do
    [ -x "$bin" ] || continue
    version="$(electron_version "$bin" || true)"
    [ "${version%%.*}" = "$major" ] && {
      printf '%s\n' "$bin"
      return 0
    }
  done
  return 1
}

matching_byoe_electron() {
  local major="$1"
  local version=""
  [ -x "$EBIN" ] || return 1
  [ -f "$EDIST/version" ] && version="$(parse_version <"$EDIST/version")"
  version="${version:-$(electron_version "$EBIN" || true)}"
  [ "${version%%.*}" = "$major" ] || return 1
  printf '%s\n' "$version"
}

write_desktop_file() {
  local target="$1"
  cat >"$target/slick.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Slick
Comment=Slack client mod (BYOE)
Exec=${target}/electron %U
Icon=slick
Terminal=false
Categories=Network;InstantMessaging;
MimeType=x-scheme-handler/slack;
StartupWMClass=Slick
EOF
}

step "Checking prerequisites"
[ "$(uname -s)" = "Linux" ] || die "install-linux.sh only supports Linux."

SLACK="$(find_slack)" || die "Slack not found. Install the official Slack .deb from https://slack.com/downloads/linux, then rerun."
echo "    Slack resources: $SLACK/resources"

if [ "$FROM_RELEASE" -eq 1 ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
  x86_64 | amd64) ARCH=x64 ;;
  *) die "prebuilt Linux releases are x86_64-only (this machine is $(uname -m)). Build from source instead." ;;
  esac

  step "Finding the latest release"
  JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" \
    || die "could not reach GitHub, check your internet connection?"
  TAG="$(printf '%s' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  URL="$(printf '%s' "$JSON" | grep -o "https://[^\"]*-linux-$ARCH\.tar\.gz" | head -1 || true)"
  [ -n "$URL" ] || die "the latest release (${TAG:-unknown}) has no linux-$ARCH build."
  echo "    Slick $TAG for linux-$ARCH it is!"

  step "Downloading Slick $TAG"
  TMP="$(mktemp -d /tmp/slick-install.XXXXXX)"
  trap 'rm -rf "$TMP"' EXIT
  curl --fail --location --progress-bar -o "$TMP/Slick.tar.gz" "$URL"

  verify_release_artifact "$TMP/Slick.tar.gz"

  step "Installing $TARGET"
  mkdir -p "$(dirname "$TARGET")"
  rm -rf "$TARGET"
  tar -xzf "$TMP/Slick.tar.gz" -C "$TMP"
  [ -d "$TMP/Slick" ] || die "release tarball did not contain Slick/"
  mv "$TMP/Slick" "$TARGET"
  [ -x "$TARGET/electron" ] || die "release tarball missing $TARGET/electron"
  write_desktop_file "$TARGET"
else
  command -v node >/dev/null 2>&1 || die "Node.js 18+ is required."
  node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null ||
    die "Node.js 18+ is required (found: $(node -v 2>/dev/null || echo none))."

  EVER="$(slack_electron_version "$SLACK" || true)"
  [ -n "$EVER" ] || die "Could not read Slack's Electron version from $SLACK."
  EMAJOR="${EVER%%.*}"
  echo "    Slack ships Electron $EVER"

  if SYS_EBIN="$(matching_system_electron "$EMAJOR")"; then
    step "Found matching system Electron at $SYS_EBIN"
  elif HAVE="$(matching_byoe_electron "$EMAJOR")"; then
    step "Electron $HAVE already installed in byoe/"
  else
    step "Installing Electron $EVER into byoe/ (~100MB download)"
    cd "$ROOT/byoe"
    npmi() { npm install --no-save --no-package-lock --no-audit --no-fund "$@"; }
    if command -v bun >/dev/null 2>&1; then
      bun add --exact "electron@$EVER" || bun add "electron@$EMAJOR"
    elif command -v npm >/dev/null 2>&1; then
      npmi "electron@$EVER" || npmi "electron@$EMAJOR"
    else
      die "Need bun or npm to install Electron."
    fi
    [ -x "$EBIN" ] || node node_modules/electron/install.js || true
    if [ ! -x "$EBIN" ]; then
      command -v unzip >/dev/null 2>&1 || die "Electron install failed and unzip is missing to recover from cache."
      ARCH="$(uname -m)"
      case "$ARCH" in
      aarch64) ARCH=arm64 ;;
      *) ARCH=x64 ;;
      esac
      CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/electron"
      ZIP="$(find "$CACHE" -maxdepth 1 -name "electron-v$EVER-linux-$ARCH.zip" 2>/dev/null | head -1)"
      [ -n "$ZIP" ] || ZIP="$(find "$CACHE" -maxdepth 1 -name "electron-v$EMAJOR.*-linux-$ARCH.zip" 2>/dev/null | sort -V | tail -1)"
      [ -n "$ZIP" ] || die "Electron install failed: no electron binary and no cached zip to extract."
      step "Extracting $(basename "$ZIP") manually"
      mkdir -p "$EDIST" && unzip -oq "$ZIP" -d "$EDIST"
    fi
    matching_byoe_electron "$EMAJOR" >/dev/null || die "Electron install failed or did not match major $EMAJOR."
    cd "$ROOT"
  fi

  BUILD=""
  if command -v git >/dev/null 2>&1; then
    BUILD="$(git -C "$ROOT" tag --list 'v[0-9]*' --sort=-v:refname 2>/dev/null |
      sed -nE 's/^v([1-9][0-9]*)$/\1/p' | head -1 || true)"
  fi
  BUILD="${BUILD:-0}"
  VERSION="1.0.$BUILD"

  step "Building $TARGET (Build $BUILD)"
  node "$ROOT/scripts/byoe/build-handoff-linux.js" --target "$TARGET" \
    --app-version "$VERSION" --build-number "$BUILD" --force >/dev/null
fi

step "Installing desktop integration"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.local/share/applications"
if [ -f "$ROOT/assets/icon.png" ]; then
  cp "$ROOT/assets/icon.png" "$HOME/.local/share/icons/hicolor/256x256/apps/slick.png"
elif [ ! -f "$HOME/.local/share/icons/hicolor/256x256/apps/slick.png" ]; then
  echo "    note: no assets/icon.png; desktop icon may be missing."
fi
[ -f "$TARGET/slick.desktop" ] || write_desktop_file "$TARGET"
cp "$TARGET/slick.desktop" "$HOME/.local/share/applications/dev.slick.byoe.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default dev.slick.byoe.desktop x-scheme-handler/slack || true
else
  echo "    xdg-mime not found; could not register slack:// automatically."
fi

if [ "$NO_LAUNCH" -eq 0 ]; then
  step "Launching Slick"
  "$ROOT/scripts/launch-linux.sh"
fi

printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$TARGET"
cat <<EOF
Things to know:
- First launch shows a sign-in screen (separate profile from official Slack). Sign in once; it persists.
- Configure at Preferences -> Slick.
- Manual launch: ./scripts/launch-linux.sh
- Prebuilt install: ./install-linux.sh --from-release
- Make slack:// open the official Slack again: ./install-linux.sh --restore-handler
EOF
