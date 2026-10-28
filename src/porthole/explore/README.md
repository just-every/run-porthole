# Explore query reference

This is a bounded query normalizer for the shared Explore door. It returns
native query parameters, the original source text and optional aggregate
metadata. It never executes expression text in a database or host process.
The caller retains responsibility for live authorization, snapshots, pagination,
scan bounds and result evaluation. This is an incomplete prerequisite for
PORT-018; it does not qualify PORT-049 or the vendor translation catalogs.

Import `normalizeExploration` from [./normalize.ts](./normalize.ts). The input
contains optional `dialect` and `expression` alongside the existing native
query fields. The result is:

```ts
{
  parameters: Record<string, string | number>,
  source: { dialect: 'visual' | 'promql' | 'sql' | 'lucene' | 'datadog', text: string },
  aggregate?: 'average' | 'count' | 'p95',
  logSearch?: { version: 1, root: LogSearchNode },
  metricQuery?: MetricQueryPlan,
  join?: JoinPlan
}
```

Visual queries are the default. They preserve the native signal, service,
environment, team, range, metric, trace, cursor, limit and snapshot fields.
A nonempty expression with the visual dialect refuses. Explicit empty optional
metric, from, through, cursor, limit, scanLimit, snapshot and trace fields mean unset;
unknown fields always refuse. Native validators still check native values.

PromQL support is limited to bare selector exploration:

```text
checkout_cpu{service="checkout",environment="production",team="commerce"}
{__name__="checkout.cpu",service="checkout",environment="production",team="commerce"}
```

The selector chooses one named metric and optionally exact service, environment
and team labels. The second form selects dotted native metric names through
the standard `__name__` label. PromQL strings support unescaped double-quoted
values only. Returned records are retained raw samples within the native range.
This does not implement Prometheus instant or stepped range evaluation,
lookback, staleness, series reduction or time alignment. `avg(...)` and all other
functions, range selectors, grouping, regular-expression matchers, negative
matchers and arithmetic refuse before any read. See the primary
[Prometheus selector reference](https://prometheus.io/docs/prometheus/latest/querying/basics/)
for the semantics that remain outside this slice.

SQL supports these scalar statement families and the retained join documented below, with case-insensitive keywords:

```sql
SELECT COUNT(*) FROM logs WHERE service='checkout' AND environment='production' AND team='commerce'
SELECT AVG(value) FROM metrics WHERE metric='checkout.cpu' AND service='checkout' AND environment='production' AND team='commerce'
SELECT PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration) FROM traces WHERE service='checkout' AND environment='production' AND team='commerce'
```

`COUNT(*)` selects logs and counts the matching retained records. `AVG(value)`
selects scalar metric records and requires one exact metric selection, either
in the expression or in the native metric field. Its aggregate is the arithmetic
mean of the selected records. The trace percentile is discrete nearest rank,
not interpolation; durations 100, 200 and 400 milliseconds produce 400 at p95.
`PERCENTILE_CONT` refuses. Equality values use unescaped single quotes; expression
scope fields are service, environment and team, plus metric for metric queries.
Filters may be reordered but each may appear only once. A WHERE clause is
optional when the native fields provide the desired narrowing. Other joins, OR,
subqueries, aliases, comments, semicolons, other predicates, grouping, ordering,
LIMIT clauses and database names refuse. Time ranges and pagination belong in
the existing native fields.

Lucene-style exploration executes a bounded native log predicate over retained
OTLP records in both the local store and the selected analytical Worker:

```text
service:checkout @http.status_code:>=500 -status:info
service:checkout (@http.status_code:[500 TO 599] OR status:warn)
service:checkout host:checkout-* @payment.note:"payment: retry"
```

Reserved fields are `service`, `environment` (also `env`), `team`, `status` and
`host`. Status matches severity text without case sensitivity; host reads the
`host.name` attribute. An `@` field reads typed log or resource attributes,
including a dotted key or nested OTLP key-value lists. Strings, numbers and
booleans remain distinct: `@http.status_code:500` does not match the string
`"500"`, and numeric comparisons do not coerce strings. Missing attributes do
not match positive terms. `NOT` and unary `-` complement the entire predicate,
so negating a positive term also selects missing or differently typed values.

Terms use implicit AND or explicit uppercase `AND`, `OR`, `NOT` with parentheses;
AND binds more tightly than OR. Numeric `>`, `>=`, `<`, `<=`, inclusive `[a TO b]`
and exclusive `{a TO b}` ranges are supported. An open range endpoint is `*`.
Quoted text preserves string type. Backslash escapes reserved punctuation and
spaces; escaped wildcards are literal. Unquoted `*` and `?` match string values,
and a lone `*` tests existence. Numeric text outside the safe integer range,
nonnumeric ranges, regex, fuzzy matches, boosts, body searches and unsupported
operators refuse with an explanation before reading telemetry. Expressions and
plans allow at most 32 predicates, 128 nodes and 16 nesting levels; these are parser bounds, not a
claim of runtime scan budgets or complete vendor parity.

The query result exposes `source`, native `parameters` and a versioned `plan`.
Snapshot replay retains source text and revalidates current authority; the
browser's Next page link carries the expression, snapshot and cursor. Explicit
forbidden scopes refuse, and every predicate remains inside native permission,
time and retention filters. Native fields and conjunctive expression scopes
must agree. No result establishes equivalence to an unexecuted vendor source.

Expressions are bounded to 2048 characters. Filters are exact and value-sensitive.
Unsupported or duplicate expression filters refuse; no filter is dropped.
If an expression and a native field both set a signal, metric or scope field,
their values must agree exactly. An unknown dialect, malformed expression or
conflict throws `ExplorationError`, an existing-auth error with HTTP status 400,
a stable code and actionable `field` and `hint` properties. Hints contain no
submitted expression text. No parser result grants or broadens authority.

## Bounded execution and current custody

The visual form's Query tools section offers attribute discovery and a durable
bounded run. `scanLimit` chooses 1 to 200 authorized candidate rows per page
and cannot exceed `limit`. Candidate selection precedes the log predicate.
`coverage.scannedCandidates` and `scannedPayloadBytes` describe this page;
`matchedRecords` describes its matches. A full candidate window returns
`state: partial`, `reason: scan_limit` and a cursor even when it has no matches.
Continue with the same expression, time bounds and snapshot plus that cursor.
An empty terminal page can be necessary to establish complete coverage. Page
aggregates never claim a complete value for a resumed or unfinished scan.

`POST /api/porthole/v1/query/runs` takes `{query, scanLimit, timeoutMs}`. It validates
the supported query and current scope before preparing its immutable watermark.
The response is ready; it has read no telemetry. Advance with
`POST /api/porthole/v1/query/runs/ID/advance` and `{revision}`. Each advance reads
one bounded candidate page and reports cumulative coverage. Cancel with
`POST /api/porthole/v1/query/runs/ID/cancel` and its current revision. Cancellation
stops further pages; a concurrent cancellation prevents a late page release.
Timeout is measured from preparation; an expired or late page releases no rows.
Completed, canceled, timed-out and interrupted runs do not advance. A stale
revision refuses. Runs have no background execution and hold no result copies.
They do not interrupt a database statement already in progress; deadlines are
cooperative boundaries before and after bounded reads.

`GET /api/porthole/v1/query/history` lists the current actor's latest 50 protected
snapshot descriptors. Explore exposes the same history. A replay re-enters the
native reader under current authorization and retention; it never serves a
stored result copy. Installation archives retain descriptors, not operational
runs or credentials. Subject erasure interrupts existing runs and clears their
coverage counters; intake replay cannot restore journaled erased captures.

`POST /api/porthole/v1/query/schema` takes a supported native query and reports
observed attribute paths and their typed families, metric names and declared
units. It scans one authorized candidate page, returns its coverage and cursor,
and includes no example values. Continue with the same snapshot and cursor;
a missing path on one page is not proof that it is absent in the installation.

`GET /api/porthole/v1/query/ID/export` downloads NDJSON for that actor's exact
snapshot expression, time, scope and storage segment. Its first line describes
the query and coverage; record lines contain the current authorized matches.
Follow `next` or `X-Porthole-Next` until null, including across empty pages.
Every page checks current authority and portable record exclusions. The export
does not widen a Lucene predicate into an entire service export. Metric exports
carry their evaluated typed series in the metadata, without additional raw data.

## Native metric expressions

Choose `datadog` and supply explicit nanosecond `from` and `through` values:

```text
avg:system.cpu.user{env:prod} by {host}
per_second(sum:requests{service:checkout,env:prod} by {host})
avg:system.cpu.user{env:prod} by {host}.rollup(avg,60) * 2
timeshift(avg:system.cpu.user{env:prod} by {host}, -3600)
```

The bounded parser supports avg, sum, min and max; exact service, environment,
team and host filters; those same group dimensions; per_second, per_minute,
per_hour, derivative, diff and monotonic_diff; explicit numeric rollups;
arithmetic; and negative second timeshifts. Every selector's explicit scope is
authorized before reading, including a forbidden selector hidden in arithmetic.
All selectors must use the same group dimensions. Unsupported functions and
ambiguous values refuse. Typed OTLP int64 wire strings decode only within the
exact safe-integer range; arbitrary numeric strings are not numbers.

Evaluation reads one complete bounded snapshot, with at most 10,000 records and
a ten-second cooperative deadline. It refuses an incomplete input instead of
returning a partial aggregate. Rates require an observed predecessor, zero
division produces a null with its reason, absent samples remain absent, and
unknown units remain null. Addition and subtraction require compatible declared
units. Explicit rollups align to Unix intervals. The visible plan and diagnostics
state these native semantics: there is no implicit source interpolation,
automatic rollup, counter-reset correction or proven Datadog source equivalence.
Timeshift expands only the authorized read window and preserves original output
time bounds during replay. Full PromQL evaluation remains outside this branch.

## Retained log and trace joins

One SQL correlation family is supported:

```sql
SELECT * FROM logs JOIN traces ON logs.trace_id = traces.trace_id WHERE service='checkout' AND environment='production' AND team='commerce'
```

The join selects up to 20 authorized log candidates, then looks up their actual
trace IDs in exactly the same service, environment, team, time range and snapshot.
Both signals require current read authority. Each lookup is limited to 100 trace
rows; the page allows at most 200 trace rows and 200 pairs. A truncated right
lookup refuses the whole result. Candidate cursors resume left-side scanning;
prepared runs can cancel between chunks and refuse late completion. A ten-second
cooperative deadline bounds the join's provider-read sequence. Pairs retain
both native record references and actual current rows. Missing keys and missing
retained traces are explicitly Unknown, with retained-only coverage; they prove
neither healthy operation nor complete sampling. Other joins, databases and
host commands remain unsupported. Full cross-signal source equivalence remains
unproved, as do the PORT-086 authorized NRQL and LogQL source catalogs.

`POST /api/porthole/v1/query/estimate` takes the same supported query and returns
its native plan plus candidate-record and payload-byte measurements inside the
current authority, range and snapshot, before its log predicate. Explore's
Estimate scan control uses this door. Measurements examine at most 10,001
candidates; an exceeded 10,000-record floor is explicitly inexact, a lower bound,
and never a complete query result. A join estimate describes its bounded left
candidates and right-side caps, rather than pretending to know the unexecuted
pair count. There is no invented provider price or optimizer cost.
