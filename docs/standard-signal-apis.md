# Bounded standard signal reads

Both doors require an existing credential with `telemetry.read` in the
`Authorization: Bearer` header. Native cookies never authorize these doors.
Current credential custody, expiry, signal grants, service, environment, team
and scan quotas apply. Every page is metered by the native reader. Before
release, the entire scanned set is checked against live authority, current
retained payloads, the erasure journal and portable record exclusions. Audit
stores opaque references and outcomes, never request bodies or credentials.

These are bounded live reads: at most 2,000 scanned records, one MiB of scanned
JSON, eight remote-read queries and 20,000 response samples. A larger request
refuses with `standard_read_budget_exceeded` (422). Quotas refuse with 429 and
`Retry-After`. No partial sample set is returned on exhaustion. Repeated retained copies
consume the same scan budget even when they describe one logical sample. Read
disjoint time windows to reconcile a larger capture. Narrow the time
range or the credential's scope; use approved resumable exports for bulk reads.
No additional export approval, credential class or destructive authority exists.

## Prometheus

`POST /api/v1/read` implements remote-read v1 `ReadRequest` and `ReadResponse`,
with raw Snappy and protobuf `SAMPLES`, version `0.1.0`. Equality, inequality,
regular expression and negative regular expression label matchers apply to
complete label sets; missing labels match the empty string. Regex uses RE2
semantics with full-string matching. Query order is preserved. Millisecond
bounds are inclusive. Read hints are advisory. Streamed chunks refuse unless
the client also accepts SAMPLES. Porthole performs no expression evaluation.

Remote-write samples preserve original labels, milliseconds and float bits,
including signed zero and stale NaN. Legacy samples recover their bits from retained original wire, within an
additional eight MiB recovery budget; those original envelope bytes also consume
the credential scan quota. Unavailable wire refuses explicitly. OTLP mapping pins OpenTelemetry specification v1.45.0,
Prometheus compatibility, with the Prometheus 3.5.0 OTLP receiver profile:
normalized names and labels, logical JSON values for compound attributes
(including exact integer labels), unit words before type suffixes, cumulative
monotonic sums as counters, cumulative non-monotonic sums as gauges, explicit
histograms as cumulative buckets plus count and eligible sum, and summaries as
quantiles, count and eligible sum. Milliseconds truncate original nanoseconds;
the native API and OTLP exports retain nanoseconds. Resource service namespace
and name form `job`, and service instance forms `instance`. Other resource
attributes form `target_info`. Scope-info metrics and scope labels are disabled
in this fixed receiver profile, matching the reference receiver. Compound labels also follow the
[upstream Value.AsString implementation](https://github.com/open-telemetry/opentelemetry-collector/blob/pdata%2Fv1.34.0/pdata/pcommon/value.go)
in pdata v1.34.0, the dependency embedded in that pinned Prometheus binary.

Label normalization preserves repeated underscores, prefixes digit-leading names
with `key_`, and prefixes a single leading underscore with `key`. Normalized
collisions join attribute values in original key order. Metric names tokenize
separators, avoid repeated unit tokens and put `total` last for counters. Bucket
and quantile label values use fixed decimal notation, including small bounds.

Delta temporality, exponential histograms, unsupported metric protocols,
invalid distributions, negative histogram or summary sums, and conflicting
values for one series and timestamp refuse with an explicit error. No implicit
accumulation, native histogram, exemplar, metadata or retention claim is made.
Queries scan the authorized range before matching; an unmappable authorized
point in that range can therefore refuse the request.

An unmodified Prometheus can use this configuration, with the credential in a
private file. Prometheus evaluates its own expressions over the returned data.

```yaml
remote_read:
  - url: http://127.0.0.1:8787/api/v1/read
    read_recent: true
    authorization:
      credentials_file: /run/porthole-read-credential
```

## Tempo

`GET /api/traces/{traceID}` pins Grafana Tempo 2.8.2's HTTP trace-by-ID v1
shape. The ID is 32 nonzero hexadecimal characters. The default JSON response
has `batches` of OTLP ResourceSpans and protobuf-JSON base64 identifiers.
`Accept: application/protobuf` returns the stock Tempo Trace protobuf, whose
first repeated field is wire-compatible with OTLP TracesData. Resource and
scope schemas, span attributes, links, events, flags and original nanoseconds
are preserved after mandatory intake privacy. A numeric, boolean or byte value
replaced by mask text is represented as an OTLP string mask; the original
value is never recovered. Source SQL is never recovered
from the original exporter capture. Exact duplicate copies collapse; conflicting variants remain.
Optional `start` and `end` are paired inclusive Unix-second bounds.

Every successful response says `X-Porthole-Trace-Completeness: partial` and
includes `X-Porthole-Trace-Evidence`. Even a connected authorized graph cannot
establish that hidden, sampled or unsent child spans never existed. Missing and
inaccessible traces both return 404; no hidden span count is disclosed.

Prometheus query, range-query, series, labels, metadata and exemplar routes,
and Tempo search, tags and v2 retrieval explicitly refuse. Standard log and
profile reads, TraceQL and Jaeger interfaces remain outside this implementation.
Broader erasure and retention qualification remains with PORT-035 and PORT-096.
