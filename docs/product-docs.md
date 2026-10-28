# Porthole product documentation

These guides describe implemented Porthole doors and their current limits.
Use your own installation origin for authenticated examples. Public
documentation and the downloadable schema require no installation session.
Telemetry, credentials and live API responses remain private to the installation.

## Start with a working request

1. Follow [OTLP intake](/docs/v1/otlp) to send a synthetic log with an ingest
   credential, then find it using a separate read credential.
2. Use the [query reference](/docs/v1/query-reference) to select a signal,
   scope and time window, paginate results and replay a saved snapshot.
3. Use [programmatic access](/docs/v1/programmatic-access) for definition
   reads, conditional writes, the CLI and read-only MCP tools.
4. Consult [API errors](/docs/v1/api-errors) when a request is refused or
   accepted telemetry has not become queryable.

## Reference and versioning

The guides above use the explicit `/docs/v1/` documentation namespace. Their
unversioned aliases, such as [current query reference](/docs/query-reference),
open the current documentation version. An explicit version identifies the
API generation; it does not freeze current authorization or guarantee that a
future installation supports undocumented operations.

Download the public [v1 OpenAPI schema](/openapi/porthole-v1.json) for the
implemented HTTP intake, query and configuration APIs. The live schema endpoint
`/api/porthole/v1/openapi.json` requires a signed-in native member. Neither
schema access nor a documentation link grants telemetry access.

The [OTLP log payload](/docs/examples/otlp-logs-v1.json) and
[query payload](/docs/examples/query-logs-v1.json) are synthetic public examples.
They contain no credential. Keep real secrets in private inputs and send them
in headers, as the walkthrough shows.

## Other product guides

- [Access and scope](/docs/v1/access)
- [Instrumentation](/docs/v1/instrumentation)
- [Dashboards](/docs/v1/dashboards)
- [Operations](/docs/v1/operations)
- [Signal exports](/docs/v1/signal-exports)
- [Retention and erasure](/docs/v1/retention-erasure)
- [Recovery](/docs/v1/recovery)

A small functional example establishes its own request and returned records.
It does not establish production capacity, complete source migration,
all-language instrumentation coverage or access to unsupported configuration
domains. Each guide calls out the limits relevant to its door.
