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

check_metadata_paths() {
  while IFS= read -r file; do
    case "$file" in
      CHANGELOG.md|packaging/nix/pins.json|'') ;;
      *) echo "release preparation changed unexpected path: $file" >&2; return 1 ;;
    esac
  done <<< "$1"
}
check_metadata_paths "$(git diff --name-only HEAD)"
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
main="$(git rev-parse refs/remotes/origin/main)"
if ! git diff --quiet HEAD -- CHANGELOG.md packaging/nix/pins.json; then
  if [[ "$(git rev-parse HEAD)" != "$main" ]]; then
    echo "main advanced after this tag was requested; release from its latest commit" >&2
    exit 1
  fi
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
fi

if git merge-base --is-ancestor HEAD "$main"; then
  if [[ "$(git rev-parse HEAD)" != "$main" ]]; then
    printf 'sha=%s\n' "$(git rev-parse HEAD)" >> "${GITHUB_OUTPUT:?}"
    exit 0
  fi
else
  if ! git merge-base --is-ancestor "$main" HEAD; then
    echo "release commit diverges from main; refusing to overwrite it" >&2
    exit 1
  fi
  check_metadata_paths "$(git diff --name-only "$main" HEAD)"
fi

git push --atomic --force-with-lease="$ref:$previous" origin HEAD:refs/heads/main "$ref"
printf 'sha=%s\n' "$(git rev-parse HEAD)" >> "${GITHUB_OUTPUT:?}"
