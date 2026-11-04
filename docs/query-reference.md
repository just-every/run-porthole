# Query reference

Send a JSON object to `POST /api/porthole/v1/query`. Use an installation-local
read credential in the Authorization header with action `telemetry.read`, the
requested signal and the required service, environment and team grants. The
browser equivalent is `/app/explore`. Both doors recheck current authority.
An ingest credential cannot query the records it writes.

## Native query fields

| Field | Meaning |
| --- | --- |
| `signal` | Required: `logs`, `metrics`, `traces` or `profiles`. |
| `service`, `environment`, `team` | Optional exact scope filters; omitted filters select only authorized records. |
| `from`, `through` | Inclusive source event time bounds, as decimal strings in Unix nanoseconds. Omitted bounds cover the full retained range. |
| `metric` | One exact metric name, only for metrics. |
| `trace` | One nonzero, lowercase, 32-character hexadecimal trace ID, only for traces. |
| `limit` | Page size from 1 through 200, default 100. A query with `trace` permits up to 2,000. |
| `cursor` | Opaque continuation token from the preceding result. |
| `snapshot` | Nonnegative integer completion watermark from the preceding result. |
| `dialect` | `visual` (default), `promql`, `sql` or `lucene`. |
| `expression` | Text expression, at most 2,048 characters; empty for visual queries. |
| `time` | PromQL instant evaluation timestamp, as decimal Unix nanoseconds. |
| `start`, `end`, `step` | PromQL range timestamps in decimal Unix nanoseconds, with a positive step in seconds. Use these together instead of `time`. |
| `lookback` | PromQL selector lookback in seconds, default 300. Millisecond duration precision is supported. |
| `scanLimit` | PromQL retained sample ceiling from 1 through 5,000, default 5,000. A ceiling refusal returns no complete result. |

Scope names accept letters, digits, periods, underscores, colons, slashes and
hyphens, starting with a letter or digit, up to 120 characters. Filters outside
your current grants are refused. Unknown fields and conflicting native and text
filters are refused before execution. Send timestamps as strings to avoid
JavaScript number rounding.

This [checked-in example](/docs/examples/query-logs-v1.json) selects the log
from the [OTLP walkthrough](/docs/v1/otlp):

```json
{
  "signal": "logs",
  "service": "synthetic-porthole-1",
  "environment": "synthetic-porthole-2",
  "team": "synthetic-porthole-3",
  "from": "1793232000000000000",
  "through": "1793232000000000001",
  "limit": 50
}
```

## Results, pagination and replay

Results contain `records`, `cursor`, `snapshot`, `queryRef`, `replay`, normalized
`parameters` and the original query `source`. Each record contains its scope,
source time and parsed `payload`. An empty array means no matching queryable
records in that snapshot; it does not establish service health or successful
collection. Intake can still be pending.

If `cursor` is non-null, repeat the same query with that cursor and the returned
`snapshot`. Stop when the cursor is null. The CLI's `query --all` does this
for you. Records are ordered by event time and record ID.

`GET /api/porthole/v1/query/QUERY_REF` repeats the saved page selection against
its completion watermark. Current authorization, erasure and retention still
apply: the reference conveys no access and cannot resurrect deleted records.
Replay preserves text source and explicit PromQL evaluation settings. SQL aggregates still describe the saved page.
Start a new query without `snapshot` to include newly completed batches.

The lower-level records door is `GET /api/porthole/v1/ingest/records` with the
native fields as query parameters. Credentials still belong only in headers.
The POST query door keeps query literals out of the URL.

## Supported text syntax

These are bounded selectors and aggregates over retained records. Unsupported
syntax returns HTTP 400 with a `field` and `hint` when normalization detects it.

| Dialect | Supported example | Boundary |
| --- | --- | --- |
| PromQL | `synthetic_porthole_1{service="synthetic-porthole-1",environment="synthetic-porthole-2",team="synthetic-porthole-3"}` | Without evaluation timestamps, one raw metric selector with exact scope labels. With explicit evaluation timestamps, scalar selection, `sum by (...)`, `rate` and `increase` from the bounded subset below. |
| SQL | `SELECT COUNT(*) FROM logs WHERE service = 'synthetic-porthole-1'` | Only the three aggregate forms below; exact equality filters joined by `AND`. |
| Lucene | `service:synthetic-porthole-1 AND environment:synthetic-porthole-2 AND team:synthetic-porthole-3` | Logs only; exact scope terms, with optional `AND`; no body search, wildcard or exclusion. |

SQL supports `COUNT(*) FROM logs`, `AVG(value) FROM metrics` and
`PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration) FROM traces`, each after
`SELECT`. Filters are `service`, `environment`, `team` and, for metrics, `metric`.
`AVG(value)` requires one exact metric selection. Filters use unescaped
single-quoted values; there are no joins, grouping or arbitrary SQL statements.

Aggregates operate on the returned page. When more records remain,
`aggregate.state` is `partial` and its `value` is null. A complete empty count
is zero; an empty average or percentile is null. The average requires numeric
point values with compatible units. The trace percentile is the discrete
95th percentile of span duration in milliseconds. Do not treat an incomplete
page as a whole-window statistic.

See [programmatic access](/docs/v1/programmatic-access) for CLI and MCP access,
and [API errors](/docs/v1/api-errors) for permission and validation failures.


## Scalar PromQL evaluation

For an instant result, set `dialect` to `promql`, provide an expression and
`time`. For a range, use `start`, `end` and `step`. Timestamps use decimal Unix
nanoseconds; durations use seconds. Do not also supply `from`, `through`,
`cursor`, `limit` or `trace`: the evaluator owns its bounded scan and pages.
The optional `snapshot` freezes the same completion watermark for replay.

```json
{
  "dialect": "promql",
  "expression": "sum by (team) (rate(synthetic_porthole_requests_total[5m]))",
  "time": "1793232000000000000",
  "lookback": 300,
  "scanLimit": 5000
}
```

An evaluated response has empty `records`, a null `cursor` and an `evaluation`
object. Its `resultType` is `vector` for an instant or `matrix` for a range.
Each result holds a `metric` label map, `unit`, and either `value` or `values`.
Each value is a pair of decimal Unix nanoseconds and a numeric scalar.
`settings` records the explicit range, step, lookback and budget; `plan` records
the supported expression. `resolution` states that retained source samples
are evaluated without downsampling. A complete scan does not establish full
source delivery, healthy services, long-term retention or vendor compatibility.

A selector preserves scalar labels, with exact equality matchers and an exact
metric name. Missing and empty labels compare equally to an empty matcher.
Native scope always wins: `service`, `environment` and `team` identify the
currently authorized record, irrespective of producer label spelling. Scalar
OTLP resource and point attributes with valid Prometheus label names are
preserved, with point attributes taking precedence. Dotted resource scope keys
map to the three native scope labels; other dotted or structured attributes are
outside this label subset. Neither grouping nor matching grants more access.

Instant selection takes the latest sample at or before the evaluation time,
strictly inside lookback. Missing, explicit OTLP no-recorded-value and
Prometheus stale samples produce absent series. No interpolation creates a
replacement zero. Range evaluation repeats this selection at each step; an end
that is not reached by a step is not emitted.

`sum by (label, ...) (selector)` drops labels outside its declared grouping,
including the metric name. `rate(selector[5m])` and `increase(selector[5m])`
require monotonic cumulative counters, exclude the range's left boundary and
require two numeric samples. They correct counter resets and apply Prometheus
boundary extrapolation, including the zero bound. Rate drops the metric name
and expresses units per second. These functions can sit inside `sum by`.
Duration literals accept one number and one unit: ms, s, m, h, d, w or y, up to
31 days. Gauge rates, delta sums, non-monotonic sums, histograms, summaries,
ordinary NaN, conflicting same-time samples and incompatible units refuse.
Remote-write scalar evaluation requires matching type metadata in that request;
untyped retained remote-write records remain available as raw samples only.

The evaluator scans at most 5,000 records and 8 MiB of normalized payload, with
at most 1,000 selected series, 1,000 instants and 10,000 output samples. A scan
or result ceiling refuses the entire evaluation. It charges ordinary native
read quotas on every page, checks current authority at entry, during paging
and immediately before release, and refuses if local erasure or analytical
connection authority changes. No detached telemetry cache is created.
Snapshot replay repeats these checks and cannot revive a revoked credential,
erased subject or source connection after an inactive restore.

The [bounded reference](./promql-reference.md) pins the actual Prometheus
reference and enumerates supported comparisons. Full upstream compliance,
remaining operators and functions, native histograms, exemplars, recording
rules, reviewed rollups and cardinality controls, retention and funded capacity
qualification remain open. This query door adds no spending, retention or
monitor activation authority.
