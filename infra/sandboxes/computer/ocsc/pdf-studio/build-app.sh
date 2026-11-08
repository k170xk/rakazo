#!/bin/sh
# Builds Evolve PDF Studio (the private k170xk/evolve-pdf-studio fork of Open PDF Studio) as its
# hosted web bundle into ./app, which the computer image copies to /opt/pdf-studio/app.
#
#   infra/sandboxes/computer/ocsc/pdf-studio/build-app.sh [checkout]
#
# Uses the given checkout, else EVOLVE_PDF_STUDIO_DIR, else a fresh clone through gh.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
source_dir="${1:-${EVOLVE_PDF_STUDIO_DIR:-}}"
cleanup=""
if [ -z "$source_dir" ]; then
  cleanup="$(mktemp -d)"
  gh repo clone k170xk/evolve-pdf-studio "$cleanup/src" -- --depth 1 --quiet
  source_dir="$cleanup/src"
fi
app_dir="$source_dir/open-pdf-studio"
[ -f "$app_dir/package.json" ] || { echo "not an evolve-pdf-studio checkout: $source_dir" >&2; exit 1; }
(cd "$app_dir" && npm ci --no-audit --no-fund && npm run build:hosted)
rm -rf "$here/app"
cp -R "$app_dir/dist" "$here/app"
git -C "$source_dir" rev-parse --short HEAD > "$here/app/VERSION"
[ -z "$cleanup" ] || rm -rf "$cleanup"
echo "Evolve PDF Studio built into $here/app ($(cat "$here/app/VERSION"))"
