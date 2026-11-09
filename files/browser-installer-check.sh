#!/usr/bin/env bash
set -euo pipefail
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/home"
cat > "$fixture/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$PROBE_LOG"
STUB
cat > "$fixture/bin/node" <<'STUB'
#!/usr/bin/env bash
n=0
if [ -f "$PROBE_COUNT" ]; then n=$(cat "$PROBE_COUNT"); fi
n=$((n+1))
printf '%s' "$n" > "$PROBE_COUNT"
printf 'probe %s\n' "$n" >> "$PROBE_LOG"
if [ "$PROBE_MODE" = pass ] || { [ "$PROBE_MODE" = recover ] && [ "$n" -gt 1 ]; }; then exit 0; fi
exit 1
STUB
cat > "$fixture/bin/sudo" <<'STUB'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "$PROBE_LOG"
STUB
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" HOME="$fixture/home" PROBE_LOG="$fixture/log" PROBE_COUNT="$fixture/count"
export PROBE_MODE=pass
bash /workspace/run-porthole/scripts/ci-browser.sh shard
if grep -q sudo "$PROBE_LOG"; then echo 'fast path unexpectedly touched system packages'; exit 1; fi
printf 'PASS: healthy launch performs no apt/dpkg/sudo work.\n'
rm -f "$PROBE_LOG" "$PROBE_COUNT"
export PROBE_MODE=recover
bash /workspace/run-porthole/scripts/ci-browser.sh prewarm
[ "$(grep -c 'sudo timeout 180s.*playwright install-deps chromium' "$PROBE_LOG")" = 1 ]
[ "$(cat "$PROBE_COUNT")" = 2 ]
printf 'PASS: cold failure invokes one bounded dependency installer and reprobes.\n'
rm -f "$PROBE_LOG" "$PROBE_COUNT"
printf 'fixture' > "$HOME/.cache/porthole-playwright-apt/library.deb"
bash /workspace/run-porthole/scripts/ci-browser.sh shard
[ "$(grep -c 'sudo dpkg -i' "$PROBE_LOG")" = 1 ]
if grep -q 'sudo timeout\|sudo sed' "$PROBE_LOG"; then echo 'cache path unexpectedly used apt network work'; exit 1; fi
[ "$(cat "$PROBE_COUNT")" = 2 ]
printf 'PASS: cached packages are applied once and checked without apt network work.\n'
rm -f "$PROBE_LOG" "$PROBE_COUNT"
export PROBE_MODE=fail
if bash /workspace/run-porthole/scripts/ci-browser.sh shard; then echo 'unhealthy browser was accepted'; exit 1; fi
[ "$(cat "$PROBE_COUNT")" = 2 ]
printf 'PASS: a browser still failing after cached library installation fails the job.\n'
