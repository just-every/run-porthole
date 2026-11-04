#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
ca_file="${PORTHOLE_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"
if [ ! -f "$ca_file" ]; then echo 'Set PORTHOLE_CA_FILE to the trusted CA bundle for dependency downloads.' >&2; exit 1; fi
languages=("$@")
if [ "${#languages[@]}" -eq 0 ]; then languages=(python java go dotnet ruby php); fi
for language in "${languages[@]}"; do
 docker build --secret "id=proxy_ca,src=$ca_file" --target "$language" -f instrumentation/polyglot/Dockerfile -t "porthole-c7-$language" instrumentation/polyglot
done
