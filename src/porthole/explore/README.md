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
  source: { dialect: 'visual' | 'promql' | 'sql' | 'lucene', text: string },
  aggregate?: 'average' | 'count' | 'p95',
  logSearch?: { version: 1, root: LogSearchNode }
}
```

Visual queries are the default. They preserve the native signal, service,
environment, team, range, metric, trace, cursor, limit and snapshot fields.
A nonempty expression with the visual dialect refuses. Explicit empty optional
metric, from, through, cursor, limit, snapshot and trace fields mean unset;
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

SQL supports only these statement families, with case-insensitive keywords:

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
optional when the native fields provide the desired narrowing. Joins, OR,
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
