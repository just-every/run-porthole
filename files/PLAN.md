# sx-porthole-f462fix1 plan

Scope: only blocking B in PORT-003 on 843cefdeab89ace4ed4543f1ffdb55d0e22b3495: transient fleet reporting must not shut down collection.

1. Full-history clone and named branch at the supplied head. Merge current main; retain main's contract and generated views, combine independent archive/test additions without losing assertions, renumber fleet migration above main, regenerate source lock last.
2. Reproduce HTTP 503, HTTP 429 and request timeout through the installer CLI against a local TLS fake fleet endpoint, without a Docker engine. A command-boundary fixture supplies only container lifecycle/inspection responses. Record the actual pre-fix exit and stop behavior.
3. Retry transient report/transport failures indefinitely with bounded exponential delays and jitter, honoring Retry-After on 429/503. Distinguish permanent HTTP/configuration errors with a sanitized explicit message. Abort retries promptly on an operator stop. Keep the independent Collector active and its telemetry queue bounded.
4. Fold one table-driven recovery regression assertion into the existing collector-install test file and existing fleet journey. No assertions are removed or weakened. Exercise CLI recovery, permanent errors and cancellation.
5. With the official host OpenTelemetry Collector binary (no Docker), hold the fake endpoint unavailable, submit telemetry during the outage, then recover and reconcile delivery. Preserve actual before/after receipts separately from product source.
6. Run the touched regression and typecheck, contract generator write/check for PORT-003, restore generated views from main, and regenerate/check source lock last. Commit with fleet identity/hooks and publish only cloud/sx-porthole-f462fix1. No publication scan, UI work, Services journey, Docker or contract judgment changes.
7. Use REST within the ten-call budget to discover/poll exact-SHA Verify (at most once per 300 seconds). Publish explicit non-secret evidence files to evidence/sx-porthole-f462fix1. Report custody, counts, unchanged clause judgments, existing claim, limits and lane POST lines.
