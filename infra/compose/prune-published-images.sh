#!/usr/bin/env bash
# Drops old publish tags and leaves the images this server still needs.
#
# Keeps every image a container is using, the live computer image, and the
# newest rollback tag of each repository (one publish back). Untagged leftovers
# are removed afterwards. This never runs `docker image prune -a`: the computer
# image and the migrate image are not running containers, and that command
# would delete them.
#
# A dry run is the default. Pass --yes to delete.
set -euo pipefail

apply=0
if [[ "${1:-}" == "--yes" ]]; then
  apply=1
elif [[ $# -gt 0 ]]; then
  echo "usage: prune-published-images.sh [--yes]" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker is not available; leaving images untouched" >&2
  exit 1
fi

computer="$(docker exec rakazo-api-1 printenv INCUS_SANDBOX_COMPUTER_IMAGE 2>/dev/null || true)"
if [[ -z "${computer}" ]]; then
  echo "could not read the live computer image; leaving images untouched" >&2
  exit 0
fi

used_file="$(mktemp)"
trap 'rm -f "${used_file}"' EXIT
docker ps -aq | xargs -r docker inspect --format '{{.Image}}' | sort -u >"${used_file}"

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

used() {
  local id="$1"
  [[ -n "${id}" ]] && grep -Fxq "${id}" "${used_file}"
}

computer_id="$(image_id "${computer}")"
local_id="$(image_id rakazo/computer:local)"

declare -A newest_rollback=()
while IFS=$'\t' read -r _created repo tag _id; do
  [[ "${tag}" == rollback* ]] || continue
  newest_rollback["${repo}"]="${repo}:${tag}"
done < <(docker images --format '{{.CreatedAt}}\t{{.Repository}}\t{{.Tag}}\t{{.ID}}' | sort)

remove=()
while IFS=$'\t' read -r _created repo tag _id; do
  [[ "${tag}" == "<none>" ]] && continue
  ref="${repo}:${tag}"
  if [[ "${tag}" != rollback* && "${tag}" != ocsc-* ]]; then
    continue
  fi
  full="$(image_id "${ref}")"
  if used "${full}"; then
    echo "keep ${ref} (in use)"
    continue
  fi
  if [[ "${ref}" == "${computer}" || ( -n "${full}" && "${full}" == "${computer_id}" ) ]]; then
    echo "keep ${ref} (live computer image)"
    continue
  fi
  if [[ -n "${full}" && -n "${local_id}" && "${full}" == "${local_id}" ]]; then
    echo "keep ${ref} (live computer image)"
    continue
  fi
  if [[ "${tag}" == rollback* && "${newest_rollback[${repo}]:-}" == "${ref}" ]]; then
    echo "keep ${ref} (newest rollback)"
    continue
  fi
  echo "remove ${ref}"
  remove+=("${ref}")
done < <(docker images --format '{{.CreatedAt}}\t{{.Repository}}\t{{.Tag}}\t{{.ID}}' | sort)

if [[ "${apply}" -eq 0 ]]; then
  echo "dry run: ${#remove[@]} tag(s) would be removed"
  exit 0
fi

if [[ ${#remove[@]} -gt 0 ]]; then
  for ref in "${remove[@]}"; do
    docker rmi "${ref}" || echo "left ${ref} in place" >&2
  done
fi
docker image prune --force >/dev/null || echo "dangling image prune failed; continuing" >&2
echo "$(date -Is) removed ${#remove[@]} tag(s)" | tee -a /var/log/prune-published-images.log
