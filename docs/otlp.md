# OTLP intake and compatibility

Use an installation-local **ingest** credential issued by a native owner or admin
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
Profile timestamps, durations, sample values, per-sample timestamps, trace and span
links, stack, location, function, mapping and attribute tables remain intact.
Invalid table references, malformed sample cardinality, out-of-range sample
times, invalid IDs and malformed wire data refuse the whole envelope.

A complete accepted request returns an empty OTLP ExportResponse after durable
storage, with `X-Porthole-Batch`, `X-Porthole-Accepted` and
`X-Porthole-Duplicate` receipt headers. Counts mean spans, metric data points,
log records or whole profile messages respectively; profile sample values are
not misrepresented as profile counts. The processor indexes retained records
and their inactive-archive copies atomically. `/app/ingest` and
`/api/porthole/v1/ingest/status` show accepted, rejected, pending and queryable counts.
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
scope, 400 malformed, 413 too large, 429 quota or backpressure (with Retry-After),
409 identity conflict and 503 unavailable. No refused body is acknowledged.

## gRPC receiver

Cloudflare's HTTP listener does not terminate stock OTLP gRPC. Run the edition's
receiver on explicitly owner-authorized compute connected to the installation:

```sh
PORTHOLE_OTLP_UPSTREAM=https://your-installation.example \
PORTHOLE_OTLP_LISTEN=127.0.0.1:4317 \
node ./scripts/porthole/otlp-grpc.mjs
```

This is a product receiver, using `@grpc/grpc-js` 1.14.6, not a Collector config
rewrite. It exposes the stock `TraceService`, `MetricsService`, `LogsService`
(v1) and `ProfilesService` (v1development) `Export` RPCs with their unchanged
protobuf messages. Point a stock SDK or Collector exporter at its address and send
the ingest credential in its authorization metadata. gRPC compression and framing
is handled by grpc-js; original uncompressed protobuf bytes go to the same
Worker intake. Every request forwards only the authorization and documented
scope and identity metadata. There is no gateway-wide ingest credential, session,
SQL access or substitute telemetry store.

For a non-loopback listener, supply `PORTHOLE_OTLP_TLS_CERT` and
`PORTHOLE_OTLP_TLS_KEY` as private certificate and key **paths**; both are required.
Keep those files out of the checkout. The receiver refuses a public insecure
listener, upstream credentials in a URL, non-origin URLs and non-HTTPS upstreams
except loopback. It never follows redirects. Supervise this process and keep its
TLS chain current. Stop only its own PID with SIGTERM or SIGINT; it drains requests
and forces its own shutdown after ten seconds.

Unary exports are limited to 1 MiB decoded messages, 100 concurrent streams per
connection and at most 30 seconds or the caller's earlier deadline. Cancellation
aborts the upstream request. An interrupted acknowledgement can follow a durable
write, so retry the same envelope. Failures map to gRPC UNAUTHENTICATED,
PERMISSION_DENIED, INVALID_ARGUMENT, RESOURCE_EXHAUSTED, ALREADY_EXISTS,
UNIMPLEMENTED or UNAVAILABLE; deadline and cancellation stays explicit. The receiver
returns success only after the installation acknowledges durable acceptance.
A TLS receiver deployment, stock-profiler interoperability and the complete
six-language, four-signal estate are still unqualified.

## Query and custody

Choose **profiles** in `/app/explore`, or use the versioned query API with
`signal: "profiles"`. The scoped records API is
`GET /api/porthole/v1/ingest/records?signal=profiles`. A separate read credential
needs an explicit profiles grant. All existing team, service and environment fences,
read quotas, current custody and snapshot and replay rules apply. Only the dictionary entries transitively referenced by the authorized profile
are returned. Indices are rebased without changing sample and stack meaning; strings
and links belonging to other profiles never travel with its query result.
The owner-only durable envelope retains the exact original wire bytes.
The supported profile unit is a whole profile, not a flame graph or search engine
or PORT-015 profiling qualification.

Whole-installation archives retain profile envelopes, dictionaries, originals,
query snapshots and inert copies; restore keeps collection paused and carries
no credential, session or approval authority. Separate analytical workers also
accept profiles after their additive schema migration. No capacity result is
inferred from that functional kernel.

## Send one log and find it

Use Bash for these commands. `read -r -s` reads a secret without echoing it;
these flags are Bash-specific, not portable POSIX `read` flags. Run without shell
tracing. Secrets travel through curl's standard-input configuration, never a URL
or command argument. Replace only the origin with your installation origin.
The files are included in the checkout and also available as
[OTLP JSON](/docs/examples/otlp-logs-v1.json) and
[query JSON](/docs/examples/query-logs-v1.json).

Have an owner or admin create two credentials at `/app/settings/credentials`
after verifying their identity: an ingest credential with `telemetry.write`
and a read credential with `telemetry.read`. Both need signal `logs`, service
`synthetic-porthole-1`, environment `synthetic-porthole-2` and team
`synthetic-porthole-3`. Use separate credentials for production collection.

```bash
PORTHOLE_ORIGIN=https://your-installation.example
read -r -s -p 'Ingest credential: ' PORTHOLE_CREDENTIAL
printf '\n'
```

Send the request from the checkout root:

```bash
printf 'header = "Authorization: Bearer %s"\n' "$PORTHOLE_CREDENTIAL" |
  curl --config - --silent --show-error --fail-with-body --include \
    --header 'Content-Type: application/json' \
    --data-binary @public/docs/examples/otlp-logs-v1.json \
    "$PORTHOLE_ORIGIN/v1/logs"
unset PORTHOLE_CREDENTIAL
```

On first acceptance, expect HTTP 200, `{}`, `X-Porthole-Accepted: 1` and
`X-Porthole-Duplicate: false`. Retrying identical bytes with the same credential
returns the same batch receipt and duplicate `true`; it creates no second log.
The synthetic record has body `synthetic-porthole-4` and source timestamp
`1793232000000000000` nanoseconds. That fixed timestamp makes the example
repeatable; it is not a current production event.

Once processing completes, query using the separate read credential:

```bash
read -r -s -p 'Read credential: ' PORTHOLE_CREDENTIAL
printf '\n'
```

Then send the query:

```bash
printf 'header = "Authorization: Bearer %s"\n' "$PORTHOLE_CREDENTIAL" |
  curl --config - --silent --show-error --fail-with-body \
    --header 'Content-Type: application/json' \
    --data-binary @public/docs/examples/query-logs-v1.json \
    "$PORTHOLE_ORIGIN/api/porthole/v1/query"
unset PORTHOLE_CREDENTIAL
```

In an otherwise empty matching scope, expect exactly one record with
`payload.record.body.stringValue` equal to `synthetic-porthole-4`, the service,
environment and team above, and a `queryRef`. A query before processing may
return an empty `records` array. Check `/app/ingest` as an owner or admin for
pending work, then issue a new query so it selects the latest completed
snapshot. Replaying an earlier empty snapshot will remain empty.

See the [query reference](/docs/v1/query-reference) for filters and pagination,
and [API errors](/docs/v1/api-errors) for actionable refusals.

## Current limits

The implemented intake retains and queries the four signal types described
above. Profiles are returned as whole profiles, with their scoped dictionary;
this does not provide a flame graph engine. Cross-language exporter coverage,
production gRPC deployments and high-volume latency or capacity have not been
qualified by these examples. Acceptance of a batch establishes durable intake,
not a throughput or query-latency guarantee.


## Stock Prometheus remote write

The qualified local source and reference are **Prometheus 3.5.0**, using its
unchanged `prometheus.WriteRequest` v1 sender and raw Snappy encoding. POST to
`/api/v1/write` with `Content-Type: application/x-protobuf`,
`Content-Encoding: snappy` and `X-Prometheus-Remote-Write-Version: 0.1.0`.
An optional `proto` parameter must identify `prometheus.WriteRequest`.
The same installation-local ingest credential and scope rules apply.

Use Prometheus's existing `remote_write` list to retain the original destination
and add the Porthole destination. Change only `url` and `bearer_token_file` for the
new installation. Keep existing scrape jobs, producer instrumentation, labels,
parsers, metadata and queue settings. The credential file is private local
configuration; exclude it from telemetry and installation exports. Adding a
remote destination requires the source owner's authority. This local
qualification grants no provider fanout or scrape-target management authority.

The public native records API and Explore preserve each complete emitted label
set, floating-point bits and original millisecond timestamp; the internal
nanosecond key is that timestamp multiplied by one million. Classic histogram
bucket, sum and count series remain their original individual series. Counter
and gauge values are retained without evaluation or invented temporality.
`record.valueBits` preserves the original 64-bit representation.
`record.sampleState` distinguishes `stale` (the exact Prometheus stale marker),
`nan` (an ordinary NaN) and `present`. A stale marker is source absence evidence,
never a zero or a healthy measurement. This intake performs no PromQL evaluation.

Metadata can arrive in independent requests, before or after samples. Each
received descriptor is a separately scoped native record with
`metricKind: metadata`, the original family name, type, help and unit in
`metadata`, and an empty `record`. It has no measured value or source timestamp.
Its internal zero sorting key supports pagination and is not a sample time.
Delivery receipts count both sample records and metadata descriptors; filter by
`metricKind` when reconciling numeric sample totals. Identical metadata envelopes
are retries under the existing source identity rules. No historical descriptor
is silently applied to a sample from a different request. Original wire bytes
remain in the private owner installation archive.

A 204 acknowledges durable custody, with the existing receipt headers. Buffer
pressure returns 429 and Retry-After; configure the source's existing
`retry_on_http_429` setting where retrying pressure is required. An interrupted
acknowledgment can be retried without adding a second stored batch. Malformed
Snappy or protobuf returns 400. Remote-write v2, native histograms, exemplars,
unknown message fields and unknown metadata types return 415 before any part of
the request is acknowledged. Empty proto3 label values and omitted numeric zero
fields are supported. The general 1 MiB and 5,000-record limits still apply.

`./tests/porthole/prometheus-stock.mjs` runs a checksum-verified stock source,
real request counters and latency histograms, and a separate stock reference
TSDB. It restarts the stock sender against its existing TSDB and WAL, then
compares more than 200 actual samples through every paginated native records,
query API and Explore result on D1, primary and standby analytical configurations. It includes source
staleness, normal NaN, complete labels, original bits and timestamps, metadata,
actual pressure and interrupted acknowledgments, restart, revoked and foreign
credentials, unavailable analytical storage, inactive restore and re-export.
This is local stock-source qualification. It establishes neither Datadog
continuity, full Prometheus wire support, query equivalence nor capacity.
