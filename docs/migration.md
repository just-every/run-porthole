# Reviewed source evidence imports

The native owner opens `/app/import`, uploads a JSON export, reviews counts,
rejections, differences and the fingerprint, and explicitly applies that plan.
The same Base import door serves the screen and the owner HTTP API. Imports
remain inactive source evidence. They do not create working native dashboards,
activate detectors, repoint collection, send notifications,
change access or retire a source. Keep the source and its history available.
Business grants remain disabled. Each request requires the native owner session;
mutations also require identity proof within five minutes and the exact origin.
Session, membership and proof predicates guard the database mutations.

This first version accepts at most one MiB, 200 source objects, and 64 KiB per
object. Wrap original source objects in a JSON object with these collection keys:

| Source | Collection keys |
| --- | --- |
| Splunk Observability | charts, dashboards, detectors, services, rum, slos, notifications, logSearches, history, securityDashboards |
| Dash0 | dashboards, checkRules, openSLO, history |
| SigNoz | dashboards, alerts, history |
| ClickStack | savedSearches, sources, dashboards, alerts, history |
| Honeycomb | boards, queries, triggers, slos, history |
| Resolve AI | investigations, knowledge, issues, connectors, history |
| Cleric | investigations, knowledge, issues, connectors, history |
| Traversal | investigations, knowledge, issues, connectors, history |

Each collection is an array. Each object needs a stable `id`, `uuid` or `name`.
Unknown collections and malformed objects remain visible rejections. Original
noncredential fields are retained, including query text, chart variables, tags,
permissions, sampling and retention settings, connector scopes, issue identity
and explicit history references. Those settings describe the source; they grant
no Porthole permission and do not configure Porthole retention or sampling.
The shared reader removes credential values, reports `CREDENTIAL_REMOVED` per
record and withholds original bytes containing removed credentials. Never paste
credentials into a source definition, free text or an investigation attachment.

For Splunk, the supported v2 resource subset follows the official
[chart](https://dev.splunk.com/observability/reference/api/charts/latest),
[dashboard](https://dev.splunk.com/observability/reference/api/dashboards/latest)
[detector](https://dev.splunk.com/observability/reference/api/detectors/latest)
and [SLO](https://dev.splunk.com/observability/reference/api/slo/latest/)
resource schemas. Each collection accepts either an original-resource array or a complete
`{count, results}` envelope. A count that differs from the supplied resource count
produces a named incomplete-export rejection; it cannot establish completeness.
Chart lists omit `programText` and tags: retrieve every chart's detail resource.
Dashboard variables belong in `filters.variables`, with array-valued `value`.
Original rules, chart references, variables and tags remain retained source data.
The SLO reader recognizes the documented RequestBased resource, its inputs
object, metadata strings and one rolling or calendar target with source alert
rules. The official response schema and example disagree about cycle fields;
that discrepancy stays named source work. It retains definitions only, without
evaluating an SLO, registering an alert or authorizing native SLO mutation.
Other source collections still require full official-schema qualification.

Run the read-only definition extractor from this checkout:

```sh
node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json
node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json --resume
```

Set `SPLUNK_ACCESS_TOKEN` in the private command environment; never pass it as an
argument. The fixed realm host uses the documented Observability API. This
command makes only GET requests to chart, dashboard and detector endpoints,
paginates by offset, and retrieves full details. It never changes the source,
repoints a collector, routes notifications or extracts telemetry history.
The mode-0600 checkpoint records completed details and the pending page. On 429
it exits resumably, honoring an optional `Retry-After` value as seconds or an HTTP
date; without one it waits one minute before a manual resume. Restarting early
makes no provider request. Completed output is private and cannot be overwritten.
Keep the checkpoint private with its export and delete both when no longer needed.

Source credentials, unstable counts, duplicate identities, oversize exports and
the documented 10,000-object listing ceiling for charts and dashboards refuse
with explicit incomplete work. The current importer additionally bounds the
export to 200 records and one MiB, with 64 KiB per original resource. A resume is
operational continuity, not a transactional source snapshot: offset pagination
cannot prove a stable source under concurrent edits. Paid export limits and all
unread historical periods remain named work, never invented retained history.

The preview enumerates each retained SignalFlow or SPL expression, its field and
lexical constructs, and unresolved source semantics. No expression is silently
dropped or cleared by applying an evidence plan. Keep the source dependency until
its native meaning is qualified. Log search references are this edition's
owner-authorized evidence envelope, not an asserted official Observability log
export schema. Preserve source search text and authorized links. Log Observer
Connect export still needs the authorized Splunk platform export workflow.
A security dashboard carries an explicit Splunk Enterprise Security handoff;
importing its reference does not provide security analytics.

### Explicit source review

After applying an inactive evidence plan, choose **Review source items** beside a
retained record on Move in. The owner reviews each expression, lexical construct
and schema issue, then records either **Retain source dependency** or **Require
specialist handoff**. The exact source text and offsets stay visible. Structured
challenger queries are inventoried as complete JSON expressions; their syntax is
not presented as a translated native language. Credential removal precedes the
inventory, so a removed structured credential cannot reappear in query text.

Each save requires a current native owner, fresh identity proof, exact origin,
explicit confirmation, a server-inventoried item and the current record revision.
The API is `POST /api/porthole/v1/migration/resolutions`, with `kind`, `id`,
`revision`, `item`, `decision` and `confirm: "reviewed"`. Decisions are
`keep-source` or `specialist-handoff`. Unknown items, other decisions, extra
fields, missing confirmation and stale submissions refuse. No free-text note or
external recipient is accepted. The existing private audit records the decision
mutation without copying the query text.

A saved decision is a native edit of the evidence record. It survives restart.
Undo removes unchanged imported siblings and preserves the complete reviewed
record, its original definition and its decisions. Inspect retained records after
Undo. Both decisions keep cutover blocked: a specialist disposition records a
required handoff, sends nothing and supplies no query-parity qualification.

To collect new data, mint a separate scoped ingest identity in Credentials and
configure a standard OTel exporter using the installation's OTLP endpoints and
that new identity. Follow [the OTLP guide](otlp.md). Inspect intake and a new trace
before considering a separate cutover. Source permission metadata, linked history
and imported credentials supply no collection authority. The migration journey
runs a real local request through the stock Node SDK with a fresh installation
identity after each source import, then reads its correlated trace and log and
its new metric through the native records API.

### Retained metric sample analysis

After importing a chart or detector, open **Analyze retained metric samples** on
Move in. Select the definition, exact native service, environment and team, and a
bounded time range in nanoseconds. This owner-only read uses the same fresh proof
and origin checks as the import door. Its API is
`POST /api/porthole/v1/migration/replay` with `targetId`, `service`, `environment`,
`team`, `from` and `through`. It reads actual retained native metric samples and
records their query snapshot; it does not accept caller-supplied sample arrays.

The strict grammar accepts one `data` stream, an optional literal filter for
`service`, `environment` or `team`, and cross-series `mean`, `sum`, `min` or `max`.
A chart can publish that aggregate directly. A detector can assign it to one
variable and publish a single immediate comparison, for example:

```python
A = data('requests', filter=filter('service', 'checkout')).mean();
detect(when(A > 10)).publish('high')
```

This is observed-sample analysis. It groups exactly aligned gauge timestamps,
retains the source identity and text, and returns values and comparison booleans.
It refuses unsupported timing or grouping syntax, scope mismatches, counters,
missing-value flags, duplicate series timestamps, incompatible units, inexact
integers and windows exceeding one complete 200-record native read. An empty
window returns no points and no inferred healthy state. No monitor, destination,
alert lifecycle or notification is activated. Source resolution, rollup,
extrapolation, missing intervals and detector lifecycle parity remain unqualified;
this analysis is not an equivalent-cutover result.

The seven challenger readers currently accept documented file envelopes of
original objects. Official API network fixtures and complete vendor schema
qualification remain pending. Prior investigations and open history are retained
as source evidence, never presented as new Porthole findings or guessed history.
There is no proprietary credential transfer and no source write.

Apply commits bounded batches through the shared kit. Saved history resumes a
previously approved plan. Reconciliation reads the native evidence records and
accounts separately for present records and explained rejections. Undo uses the
kit's preserved-conflict policy, retaining later native edits. Catch-up requires
an explicit comparison with the previous source snapshot. Neither an applied
job nor a successful evidence reconciliation means equivalent cutover.

PORT-043 and PORT-044 remain partial. Source-exact detector replay, full native query and alert
meaning, supported collector repointing, full source schemas, source-qualified
resolution beyond retained-dependency dispositions, and complete historical
extraction are still required. The new native collection proof does not establish
source parity or configure a source collector. PORT-034,
PORT-035 and PORT-045 inherit import custody and archive continuity before this
new domain can qualify complete product portability or erasure. The existing
product archive refuses when this new import custody exists, so it cannot
silently omit it. The new screens use visible word labels for every control;
there are no icon-only controls.
