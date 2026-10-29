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
