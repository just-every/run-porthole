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
Replay uses native filters; it does not restore a text aggregate presentation.
Start a new query without `snapshot` to include newly completed batches.

The lower-level records door is `GET /api/porthole/v1/ingest/records` with the
native fields as query parameters. Credentials still belong only in headers.
The POST query door keeps query literals out of the URL.

## Supported text syntax

These are bounded selectors and aggregates over retained records. Unsupported
syntax returns HTTP 400 with a `field` and `hint` when normalization detects it.

| Dialect | Supported example | Boundary |
| --- | --- | --- |
| PromQL | `synthetic_porthole_1{service="synthetic-porthole-1",environment="synthetic-porthole-2",team="synthetic-porthole-3"}` | One metric selector with exact equality labels `service`, `environment`, `team` and `__name__`; no ranges, regex, functions or series evaluation. |
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

## Retained log patterns (version 1)

Native Explore links to **Log patterns** at `/app/explore/clusters`. The same
read is available as `POST /api/porthole/v1/logs/clusters`, with a native session
and same-origin Origin header or a current `telemetry.read` bearer credential
with the logs grant. Bearer authority takes precedence over an accompanying
cookie. This door reads data and grants no configuration or erasure authority.

```json
{"service":"checkout","environment":"production","team":"commerce","from":"0","through":"18446744073709551615","limit":50,"scanLimit":10000}
```

Scope and inclusive nanosecond bounds follow the native query API. Optional
`dialect` and `expression` accept existing visual or Lucene log predicates;
aggregate expressions and other signals refuse. All matching retained records
are scanned at one completed-batch `snapshot`, which is returned in the result.
New completions do not enter that snapshot. Pending intake is outside this
watermark; a complete pattern scan makes no delivery-completeness claim.
An explicit snapshot must not exceed the current completion watermark. A future
watermark refuses with `invalid_query_snapshot` (400), so later completions
cannot enter a scan through a caller-selected future bound.

Version 1 groups messages by exact service, environment, team and severity,
then replaces decimal tokens, UUIDs and hexadecimal tokens of at least eight
characters in string bodies with typed placeholders. Literal words and
whitespace remain significant. Structured bodies group by their exact encoded
body. A pattern is a deterministic heuristic, not a diagnosis. Two messages
that differ only in a generalized identifier can intentionally share a group.
`clusters` contains each pattern's opaque `id`, displayed `pattern` and exact
`count`; `totalRecords` and `totalClusters` describe the whole completed scan.

Set `cluster` to a returned ID to obtain `records`, each retaining its original
ID, payload and a native Explore `pivot`. To page either patterns or members,
resubmit the same filters, returned `snapshot`, `limit`, `scanLimit` and
`cluster` (for members), plus the returned opaque `cursor`. A member pivot
selects one original record with the native query's `record` filter and the
same snapshot and time bounds. The native query API also accepts `record`.
Current permissions apply on every request, including old links and replay.

`limit` is 1 to 200 (default 50). `scanLimit` is 1 to 10,000 (default 10,000),
and an internal eight-MiB scan byte budget also applies. Exhaustion returns
`state: "partial"`, a `scan_limit` or `byte_limit` reason, null totals, empty
patterns and members, and no cursor. Narrow the time range or scope and retry;
partial results never present accumulated counts as exact. A completed empty
scan returns zero totals. Pages are recomputed from retained data; no detached
telemetry cache, pattern table or sharing capability is created.

Before any accumulated result is released, authority, the selected analytical
connection and every scanned record's retained contents are checked together.
A reviewed connection change during the scan returns `authority_changed`
(409), even when the newly selected store contains the same records. Retry
under the current connection; an accumulated response cannot cross that change.
An erasure or content change during the scan returns `cluster_custody_changed`
(409), including journaled content that is still physically present or was
captured under another batch identity. A later erasure changes counts and invalidates old pagination cursors
(400 `invalid_cluster_cursor`); removed patterns return 404 `cluster_not_found`.
Revoked credentials refuse, and storage outages return 503 without a local
fallback. Invalid input returns 400, unsupported methods 405, invalid media
415, oversized input 413, and credential quotas 429 with Retry-After.
Malformed expressions include the parser's `field` and correction `hint` in
the API response; native Explore shows the same hint. Diagnostics do not echo
rejected expression values.
Existing custody and inactive archive-restore rules remain unchanged.

This bounded functional door supplies no one-TB latency, full-retention,
source-equivalence, saved-search, live-tail or log-to-trace qualification.
