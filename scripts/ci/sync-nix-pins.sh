#!/usr/bin/env bash
set -euo pipefail

build="${1:?usage: sync-nix-pins.sh <build>}"
if [[ ! "$build" =~ ^[1-9][0-9]*$ ]]; then
  echo "build must be a positive integer" >&2
  exit 1
fi
pins=packaging/nix/pins.json
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
jq --argjson b "$build" '.build = $b' "$pins" > "$scratch/pins.json"
mv "$scratch/pins.json" "$pins"

slack="$(NIXPKGS_ALLOW_UNFREE=1 nix build --impure --no-link --print-out-paths \
  --expr '(builtins.getFlake (toString ./.)).inputs.nixpkgs.legacyPackages.x86_64-linux.slack')"
major="$(sed 's/^v//; s/\..*//' "$slack/lib/slack/version")"
if [[ ! "$major" =~ ^[1-9][0-9]*$ ]]; then
  echo "could not read Slack's Electron major from $slack/lib/slack/version" >&2
  exit 1
fi
jq --argjson e "$major" '.electron = $e' "$pins" > "$scratch/pins.json"
mv "$scratch/pins.json" "$pins"

if ! nix build .#slick.nodeModules --no-link -L > "$scratch/build.log" 2>&1; then
  cat "$scratch/build.log"
  got="$(sed -n 's/.*got:[[:space:]]*\(sha256-[^[:space:]]*\).*/\1/p' "$scratch/build.log")"
  if [[ ! "$got" =~ ^sha256-[A-Za-z0-9+/]+=*$ ]]; then
    echo "node_modules failed for a reason other than a stale hash" >&2
    exit 1
  fi
  jq --arg h "$got" '.nodeModulesHash = $h' "$pins" > "$scratch/pins.json"
  mv "$scratch/pins.json" "$pins"
fi
nix build .#slick --no-link -L
