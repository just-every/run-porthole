#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in prewarm|shard) ;; *) echo 'Usage: ci-browser.sh prewarm|shard' >&2; exit 2 ;; esac
cache="$HOME/.cache/porthole-playwright-apt"
mkdir -p "$cache"
# Full Chromium also satisfies rer verify's hosted/hydration browser inventory.
# Cache hits do no download; a cache eviction remains recoverable in each shard.
pnpm exec playwright install chromium
if node scripts/ci-browser.mjs; then exit 0; fi

# Cache signed package archives, never /usr/lib or dpkg's installed-state database.
# On a fresh runner these are applied only if its browser launch actually fails.
shopt -s nullglob
packages=("$cache"/*.deb)
if [ "${#packages[@]}" -gt 0 ]; then
  sudo dpkg -i "${packages[@]}"
  node scripts/ci-browser.mjs
  exit 0
fi

# One bounded fallback per job; the prewarm producer shares the downloaded layer.
# Use Ubuntu's signed archive rather than the sometimes-stalled Azure mirror.
sudo sed -i 's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt
config=$(mktemp)
trap 'rm -f "$config"' EXIT
printf 'Dir::Cache::archives "%s";\nAPT::Keep-Downloaded-Packages "true";\nBinary::apt::APT::Keep-Downloaded-Packages "true";\nAcquire::Retries "1";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' "$cache" > "$config"
sudo install -m 644 "$config" /etc/apt/apt.conf.d/99-porthole-playwright-cache
sudo timeout 180s env DEBIAN_FRONTEND=noninteractive APT_CONFIG=/etc/apt/apt.conf.d/99-porthole-playwright-cache "$(command -v pnpm)" exec playwright install-deps chromium
sudo chown -R "$(id -u):$(id -g)" "$cache"
node scripts/ci-browser.mjs
