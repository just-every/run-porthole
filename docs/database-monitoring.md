# Local database diagnostics

Database opens at `/app/database`. Review collection under
`/app/settings/database` using a current native owner with fresh proof. The
review binds an intake credential, engine, service, environment, team and exact
SELECT template list. Updates require the current revision. Stop collection by
reviewing that source with collection stopped. Agents and bearer credentials
cannot review collection. A telemetry scope never grants database access.

This collector is for disposable, lawful local databases. Production collection,
remote database access, arbitrary diagnostic SQL, index creation and remediation
are outside this implementation. No collection starts from the browser. A local
operator runs one bounded collection; there is no scheduler or background retry.

## Qualified engines and privileges

| Engine | Native evidence | Collection privileges and prerequisites |
| --- | --- | --- |
| PostgreSQL 17.6 | `pg_stat_statements` native query ID, calls, execution milliseconds, mean and rows; JSON EXPLAIN operator and numeric estimates; `pg_stat_activity` and `pg_blocking_pids` blocking edges | DBA pre-enables `pg_stat_statements`, query IDs and its extension in the disposable database. Separate login has CONNECT, `pg_read_all_stats`, and SELECT on only reviewed plan tables. It has no table mutation, DDL, role administration or index privilege. Workload role is selected explicitly. |
| MySQL 8.4.6 Community | Performance Schema digest identity, calls, timer milliseconds, mean and rows; JSON EXPLAIN access type and numeric estimates; `data_lock_waits`, thread identities and structural lock type | Performance Schema is enabled by the fixture administrator. Separate login has SELECT on Performance Schema and only the reviewed application tables. It has no table mutation, DDL, role administration or index privilege. Statistics are scoped to the selected local database. |
| SQL Server, Oracle, MongoDB | Unqualified | Their native diagnostic equivalents, version matrix, privileges and real engine journeys remain required. |

The collector opens a read-only transaction, sets a three-second statement
budget, bounds statistics to 25 queries, waits to 100 edges and explain capture
to four reviewed templates. Plans contain at most 64 structural operators.
PostgreSQL uses a half-second lock budget; MySQL uses a one-second metadata lock
budget. EXPLAIN never enables ANALYZE. Only a small SELECT grammar is accepted
for plans, with a fixed harmless substitute for its single value parameter.
Plans therefore describe the reviewed query shape; they do not claim an actual
execution plan or parameter-specific runtime behavior. No query is executed to
obtain its plan.

Cumulative statistics are native engine observations since the engine reset,
not an interval throughput estimate or an unsampled traffic guarantee. Native
latency histograms and the complete distribution qualification remain open.
Each capture declares the actual engine version, collector and database clocks,
and statistics, plans and waits coverage. Permission errors produce
`privilege_denied`; other failures produce `unavailable`. Unreviewed plans are
`not_reviewed`. Empty observations do not prove absence of blocking outside the
capture window. A successful earlier sample cannot clear a later denied capture.

The native Database view distinguishes fresh observations, observations older
than 60 seconds, stopped collection, revoked intake credentials and inactive
restored history. Caller pivots require emitted trace identities or a matching
normalized statement in currently visible stock database spans. The caller scan
is bounded and declares incomplete evidence when its page is truncated. Missing
or out-of-scope caller data remains unavailable; time proximity creates no link.

## Run a reviewed capture

Install the checkout dependencies. Create a private file owned by the current
user with mode 0600. Its JSON fields are `engine`, `connection` (local host, port,
user, password and database), `workloadRole` for PostgreSQL, `plans` (an array),
`origin` (local Porthole origin), `secret` (the local intake credential), `id` and
`revision` from the reviewed source. Credentials never go on a command line.

```sh
node collectors/database/collector.mjs /private/path/database.json --review
node collectors/database/collector.mjs /private/path/database.json
```

The review command prints only the engine, safe templates, digest and collection
bounds. Review those exact templates in Settings before collecting. Supported
example template: `SELECT count(*) FROM porthole_orders WHERE customer = ?`.

The versioned native-owner review API is
`POST /api/porthole/v1/database/sources`; the native-session read API is
`GET /api/porthole/v1/database`. Read parameters are `service`, `environment`,
`team`, `from`, `through`, `limit`, `snapshot` and `cursor`. Retain the returned
snapshot when following a cursor. The authenticated local collector submits to
`POST /api/porthole/v1/database/captures`. A changed revision, stopped source,
wrong credential, changed plan digest or out-of-scope source refuses admission.

## Privacy and custody

The collector removes string and numeric literals, bind values, comments and
unsafe quoted atoms before sending samples. Only a fixed structural projection
of a plan survives; predicates, names, text and constants are excluded. Native
admission repeats shape validation and redaction before constructing a pending
envelope or its stored wire. OTLP database statement attributes receive the same
mandatory normalization independently of optional log pipelines. Raw database
responses and passwords are never diagnostic output.

Captures use existing scoped telemetry custody, snapshot reads, analytical
replication and installation archives. Active collection grants, credentials,
credential hashes and database connection configuration are excluded from both
native installation archives and product archives. Independent restore keeps
capture history inactive and ingestion paused; it cannot restart a collector or
recreate a grant. Original source digests remain distinct from sanitized stored
wire. Current membership and telemetry scope still govern every read.

This is a local PostgreSQL and MySQL slice, not complete database monitoring or
Datadog DBM qualification. The authorized unchanged Agent DBM dual-ship source,
separate sample, metric and plan intakes, native source comparisons and the other
three engine journeys remain required. Existing monitor, outbound, retention,
erasure and provider holds remain in force.
