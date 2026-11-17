#!/usr/bin/env bash
set -euo pipefail

tag="${1:?usage: commit-release.sh <tag>}"
if [[ ! "$tag" =~ ^v[1-9][0-9]*$ ]]; then
  echo "release tag must be v<N>" >&2
  exit 1
fi
ref="refs/tags/$tag"
previous="$(git rev-parse "$ref")"
if [[ "$(git rev-parse "$ref^{commit}")" != "$(git rev-parse HEAD)" ]]; then
  echo "checkout does not match $tag; refusing to move it" >&2
  exit 1
fi
if ! git diff --quiet -- CHANGELOG.md packaging/nix/pins.json; then
  releases="$(gh api --paginate "repos/${GITHUB_REPOSITORY:?}/releases" --jq '.[].tag_name')"
  if grep -Fxq "$tag" <<< "$releases"; then
    echo "$tag already has a release; refusing to change its source" >&2
    exit 1
  fi
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git add CHANGELOG.md packaging/nix/pins.json
  git commit -m "chore(release): prepare $tag"
  git tag -fa "$tag" -m "Slick Build ${tag#v}"
  git push --force-with-lease="$ref:$previous" origin "$ref"
fi
printf 'sha=%s\n' "$(git rev-parse HEAD)" >> "${GITHUB_OUTPUT:?}"
