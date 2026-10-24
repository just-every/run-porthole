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
  aggregate?: 'average' | 'count' | 'p95'
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

Lucene-style exploration supports exact log scope terms:

```text
service:checkout environment:production team:commerce
service:checkout AND environment:production AND team:commerce
```

Terms are implicit conjunctions, with optional explicit uppercase AND. These
forms return matching log records. Body phrases, arbitrary attributes, OR,
exclusions, quoted or escaped terms, wildcard queries and regular expressions
refuse because this slice has no corresponding native predicate.

Expressions are bounded to 2048 characters. Filters are exact and value-sensitive.
Unsupported or duplicate expression filters refuse; no filter is dropped.
If an expression and a native field both set a signal, metric or scope field,
their values must agree exactly. An unknown dialect, malformed expression or
conflict throws `ExplorationError`, an existing-auth error with HTTP status 400,
a stable code and actionable `field` and `hint` properties. Hints contain no
submitted expression text. No parser result grants or broadens authority.
