# OTLP intake and compatibility

Use an installation-local **ingest** credential issued by a native owner/admin
in Settings after a fresh proof. Give it only the required signals, teams,
services and environments. Send it in `Authorization: Bearer <credential>`.
Resource attributes `service.name`, `deployment.environment.name` and `team.name`
select that scope; absent attributes may inherit a single explicit credential
grant. A credential never grants reads, and an endpoint never widens its scope.
Revocation and custody changes take effect on the next request, on both transports.

## HTTP

Stock OTLP exporters use these installation-origin endpoints:

| Signal | Endpoint | Wire schema | Maturity |
| --- | --- | --- | --- |
| Traces | `POST /v1/traces` | `collector.trace.v1.ExportTraceServiceRequest` | Stable |
| Metrics | `POST /v1/metrics` | `collector.metrics.v1.ExportMetricsServiceRequest` | Stable |
| Logs | `POST /v1/logs` | `collector.logs.v1.ExportLogsServiceRequest` | Stable |
| Profiles | `POST /v1/profiles` | `collector.profiles.v1development.ExportProfilesServiceRequest` | Development; explicitly versioned |

Schemas are from [opentelemetry-proto v1.9.0](https://github.com/open-telemetry/opentelemetry-proto/tree/v1.9.0).
Use `application/x-protobuf` or OTLP JSON (`application/json`), optionally gzip.
Profiles use that release's shared `dictionary` and `resourceProfiles` format;
other development-profile schema versions are not qualified. JSON uses OTLP
camelCase field names, hexadecimal IDs and decimal strings for 64-bit values.
Profile timestamps, durations, sample values, per-sample timestamps, trace/span
links, stack/location/function/mapping and attribute tables remain intact.
Invalid table references, malformed sample cardinality, out-of-range sample
times, invalid IDs and malformed wire data refuse the whole envelope.

A complete accepted request returns an empty OTLP ExportResponse after durable
storage, with `X-Porthole-Batch`, `X-Porthole-Accepted` and
`X-Porthole-Duplicate` receipt headers. Counts mean spans, metric data points,
log records or whole profile messages respectively; profile sample values are
not misrepresented as profile counts. The processor indexes retained records
and their inactive-archive copies atomically. `/app/ingest` and
`/api/porthole/v1/ingest/status` show accepted/rejected/pending/queryable counts.
Unknown source loss and rejection remain explicit; acceptance alone is not
queryability or a capacity guarantee.

The compressed body and decompressed body each have a 1 MiB bound; a batch has
at most 5,000 records and a bounded normalized representation. A profile
dictionary projection travels with each retained profile, so large expansions may exceed
the normalized limit and refuse before acknowledgement. Empty ExportRequests
are valid. Unknown protobuf fields remain in the original stored wire envelope.

Identical wire bytes and scope headers identify a retry for the same credential
and signal. `X-Porthole-Batch-ID` optionally supplies a stable explicit identity;
it must keep identical bytes. Reusing it with changed compression or contents
returns 409, rather than guessing that two source envelopes are duplicates.
HTTP failures return a protocol Status message: 401 unauthenticated, 403 wrong
scope, 400 malformed, 413 too large, 429 quota/backpressure (with Retry-After),
409 identity conflict and 503 unavailable. No refused body is acknowledged.

## gRPC receiver

Cloudflare's HTTP listener does not terminate stock OTLP gRPC. Run the edition's
receiver on explicitly owner-authorized compute connected to the installation:

```sh
PORTHOLE_OTLP_UPSTREAM=https://your-installation.example \
PORTHOLE_OTLP_LISTEN=127.0.0.1:4317 \
node scripts/porthole/otlp-grpc.mjs
```

This is a product receiver, using `@grpc/grpc-js` 1.14.6, not a Collector config
rewrite. It exposes the stock `TraceService`, `MetricsService`, `LogsService`
(v1) and `ProfilesService` (v1development) `Export` RPCs with their unchanged
protobuf messages. Point a stock SDK/Collector exporter at its address and send
the ingest credential in its authorization metadata. gRPC compression/framing
is handled by grpc-js; original uncompressed protobuf bytes go to the same
Worker intake. Every request forwards only the authorization and documented
scope/identity metadata. There is no gateway-wide ingest credential, session,
SQL access or substitute telemetry store.

For a non-loopback listener, supply `PORTHOLE_OTLP_TLS_CERT` and
`PORTHOLE_OTLP_TLS_KEY` as private certificate/key **paths**; both are required.
Keep those files out of the checkout. The receiver refuses a public insecure
listener, upstream credentials in a URL, non-origin URLs and non-HTTPS upstreams
except loopback. It never follows redirects. Supervise this process and keep its
TLS chain current. Stop only its own PID with SIGTERM/SIGINT; it drains requests
and forces its own shutdown after ten seconds.

Unary exports are limited to 1 MiB decoded messages, 100 concurrent streams per
connection and at most 30 seconds or the caller's earlier deadline. Cancellation
aborts the upstream request. An interrupted acknowledgement can follow a durable
write, so retry the same envelope. Failures map to gRPC UNAUTHENTICATED,
PERMISSION_DENIED, INVALID_ARGUMENT, RESOURCE_EXHAUSTED, ALREADY_EXISTS,
UNIMPLEMENTED or UNAVAILABLE; deadline/cancellation stays explicit. The receiver
returns success only after the installation acknowledges durable acceptance.
A TLS receiver deployment, stock-profiler interoperability and the complete
six-language/four-signal estate are still unqualified.

## Query and custody

Choose **profiles** in `/app/explore`, or use the versioned query API with
`signal: "profiles"`. The scoped records API is
`GET /api/porthole/v1/ingest/records?signal=profiles`. A separate read credential
needs an explicit profiles grant. All existing team/service/environment fences,
read quotas, current custody and snapshot/replay rules apply. Only the dictionary entries transitively referenced by the authorized profile
are returned. Indices are rebased without changing sample/stack meaning; strings
and links belonging to other profiles never travel with its query result.
The owner-only durable envelope retains the exact original wire bytes.
The supported profile unit is a whole profile, not a flame-graph/search engine
or PORT-015 profiling qualification.

Whole-installation archives retain profile envelopes, dictionaries, originals,
query snapshots and inert copies; restore keeps collection paused and carries
no credential, session or approval authority. Separate analytical workers also
accept profiles after their additive schema migration. No capacity result is
inferred from that functional kernel.

## Qualification still required

`tests/porthole/ingest.mjs` `ingestJourney` covers existing official-schema HTTP
traces/metrics/logs. `otlpProtocolJourney` adds stock Node SDK 0.300.0 HTTP/gRPC trace, metric
and correlated log exports from a real local HTTP request, four-signal schema
edges, gzip, profile fidelity, signal auth/refusal/revocation, restart, counts and
query replay. `tests/porthole/archive.mjs` `profileArchiveJourney` proves an
independently owned inactive restore. `ingestBrowserJourney` exercises delivery
and profile Explore/results/error/empty states at 1440 and 390. These are
functional protocol proofs, not generated evidence of application profiling or
capacity. PORT-001 remains PARTIAL until official SDK/exporters in all six named
languages and a stock Collector send the required correlated signals, and every
signal is queryable within ten seconds during the complete PORT-057 workload.
That workload requires dedicated owner-authorized infrastructure and an approved
USD ceiling. No spend, deployment or capacity claim is authorized by this guide.
