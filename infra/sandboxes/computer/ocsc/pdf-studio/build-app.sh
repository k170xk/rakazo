#!/bin/sh
# Builds Evolve PDF Studio (the private k170xk/evolve-pdf-studio fork of Open PDF Studio) as its
# hosted web bundle twice: into ./app, which the computer image copies to /opt/pdf-studio/app, and
# under /pdf-studio/ into apps/web/public/pdf-studio, which the PDF studio in the web app frames.
#
#   infra/sandboxes/computer/ocsc/pdf-studio/build-app.sh [checkout]
#
# Uses the given checkout, else EVOLVE_PDF_STUDIO_DIR, else a fresh clone through gh.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
web_public="$(cd "$here/../../../../../apps/web/public" && pwd)"
source_dir="${1:-${EVOLVE_PDF_STUDIO_DIR:-}}"
cleanup=""
if [ -z "$source_dir" ]; then
  cleanup="$(mktemp -d)"
  gh repo clone k170xk/evolve-pdf-studio "$cleanup/src" -- --depth 1 --quiet
  source_dir="$cleanup/src"
fi
app_dir="$source_dir/open-pdf-studio"
[ -f "$app_dir/package.json" ] || { echo "not an evolve-pdf-studio checkout: $source_dir" >&2; exit 1; }
version="$(git -C "$source_dir" rev-parse --short HEAD)"
(cd "$app_dir" && npm ci --no-audit --no-fund && npm run build:hosted)
rm -rf "$here/app"
cp -R "$app_dir/dist" "$here/app"
echo "$version" > "$here/app/VERSION"
(cd "$app_dir" && npx vite build --mode hosted --base /pdf-studio/ --outDir dist-web --emptyOutDir)
rm -rf "$web_public/pdf-studio"
cp -R "$app_dir/dist-web" "$web_public/pdf-studio"
rm -rf "$app_dir/dist-web" "$web_public/pdf-studio/_redirects"
echo "$version" > "$web_public/pdf-studio/VERSION"
[ -z "$cleanup" ] || rm -rf "$cleanup"
echo "Evolve PDF Studio $version built into $here/app and $web_public/pdf-studio"
