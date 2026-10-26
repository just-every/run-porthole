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

Most collections are arrays. Each object needs a stable `id`, `uuid` or `name`; APM service nodes also use `serviceName`, and browser RUM initialization uses `applicationName`. An official APM topology response supplies `nodes` and `edges`, preserving the entire topology beside each service node.
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
The APM file reader accepts the official [service topology response](https://dev.splunk.com/observability/reference/api/apm_service_topology/latest/), retaining original nodes, edges and source tags. Export it with the source account’s authorized read-only topology request; this GET-only extractor does not infer permission for its POST operation. Browser RUM accepts the original [initialization configuration](https://help.splunk.com/en/splunk-observability-cloud/manage-data/instrument-front-end-applications/instrument-mobile-and-web-applications-for-splunk-real-user-monitoring-rum/instrument-browser-applications-for-splunk-rum/configure-the-splunk-rum-browser-agent), removes its access token, and retains configuration as evidence. Neither reader qualifies APM or RUM execution, mobile settings, sessions or sampling callbacks.

Run the read-only definition extractor from this checkout:

```sh
node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json
node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json --resume
```

Set `SPLUNK_ACCESS_TOKEN` in the private command environment; never pass it as an
argument. The fixed realm host uses the documented Observability API. This
command makes only GET requests to chart, dashboard and detector endpoints, paginates by offset, and retrieves full details. Explicit selected SLO IDs and metric windows add their documented read endpoints. It never changes the source, repoints a collector or routes notifications.
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

### Selected source history

Add an explicit authorized source selection to the extraction command:

```sh
node scripts/splunk-export.mjs --realm us0 --output ./splunk-export.json --slo-id SOURCE_ID --metric-query 'sf_metric:requests' --start-ms 1700000000000 --end-ms 1700000002000 --resolution 1000
```

The selected SLO detail uses GET; source-wide SLO search uses POST and is not
performed. Metric history follows the official [time-series window reference](https://dev.splunk.com/observability/reference/api/retrieve_timeserieswindow/latest/)
and retrieves every returned series’ [metadata](https://dev.splunk.com/observability/reference/api/metrics_metadata/latest/).
The private checkpoint binds the exact query, original millisecond bounds,
resolution and SLO selection. Changing the selection cannot resume an old job.
A metadata rate limit resumes without re-reading or duplicating the saved window.
No source identity is copied into Porthole collection authority.

The original response and metadata remain under `history`, with metric type,
dimensions, custom properties, tags, original times and values. Invalid or
partial responses, provider errors, missing metadata, unsafe integers, duplicate
or unordered timestamps and the source series cap refuse. No missing interval is
filled. The official schema disagrees with its timestamp-value example and with
its start-parameter prose; this reader follows the documented parameter schema
and explicit response example and records those discrepancies. Values are
source rollups, not reconstructed full-resolution observations. Paid access,
source retention, unread periods and complete account coverage remain named work.

After applying, choose **Read imported metric history** on Move in. The private
`GET /api/porthole/v1/migration/history?id=SOURCE_RECORD_ID` door exposes the same
retained values, original milliseconds and exact integer nanoseconds. It works
locally after source access is removed. The current native owner is checked at
entry and before return. Source identifiers and query text stay out of audit
labels. This reader does not silently publish source data into live native intake.

### Finite metric replay

On Move in, open **Analyze retained metric samples**, choose a definition and
native observations or a retained source window, then select service,
environment, team and exact nanosecond bounds. The API is
`POST /api/porthole/v1/migration/replay`, with `targetId`, `targetRevision`,
`service`, `environment`, `team`, `from`, `through` and optional `historyId`
and `sourceStreamId`.
The source revision, current owner and fresh proof are checked again before
return. Samples always come from real native storage or a saved source export,
never a caller-supplied sample array. A native read retains its query snapshot;
source-history results retain the exact source revision, series metadata and
extraction limits. Source dimensions must match the selected scopes exactly.

The closed grammar accepts one gauge stream; an optional literal scope filter;
cross-series mean, sum, min or max; direct publication or one detector comparison.
An explicit whole-second resolution also permits one trailing aggregate window,
`when` lasting with `at_least`, and an independent clear condition:

```python
A = data('requests', resolution=1000, extrapolation='null').mean();
detect(when(A > 10, lasting='2s'), off=when(A < 5, lasting='2s')).publish('high')
```

This finite replay requires already aligned values. It does not assign source
buckets, infer arrival order or extrapolate missing samples. A declared rollup
only accepts one value per observed series and aligned instant. Trailing windows
need complete inputs; warm-up, missing intervals and incomplete observed series
populations remain Unknown. Lasting includes missing instants in its denominator,
uses complete trailing windows and declares its inclusive `at_least` assumption.
The initial incident state remains unknown. Finite transitions carry no live
incident identity and activate no monitor, route or notification.

The official [data](https://dev.splunk.com/observability/docs/signalflow/functions/data_function/),
[when](https://dev.splunk.com/observability/docs/signalflow/functions/when_function/)
and [detect](https://dev.splunk.com/observability/docs/signalflow/functions/detect_function/)
references distinguish requested data cadence from actual source job resolution.
Exact source execution, bucket boundaries, extrapolation, earlier incident state,
all query constructs and lifecycle parity remain unqualified. An unresolved
construct stays an explicit retained dependency; successful local arithmetic does
not authorize equivalent cutover. Unsupported syntax, counters, scope mismatch,
missing-value flags, duplicate series timestamps, incompatible units, inexact
numbers and incomplete native pages refuse visibly.

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

### Inactive archive custody

Product archives now include the supported owner-session import domain: source
originals, uploads, immutable plan snapshots, provenance, job history, reversal
reports and reviewed native edits. Credential-bearing raw uploads refuse export
until the ordinary reader removes their original bytes. Unsupported populated
import-kit domains refuse the entire archive rather than silently dropping them.

An independent restore preserves exact native evidence and private historical
custody in an inert table. It restores no live import job, source connection,
Business grant, credential, lease or approval. Move in labels restored history
inactive; an archived plan’s apply or Undo refuses with
`restored_import_requires_fresh_preview`. Upload the authorized source again,
review a new destination plan and approve it as the current native owner. A source
review is history, never destination authority. Re-export preserves the inert
custody rows exactly. Source-record edits remain conflict-preserved by Undo.

PORT-043 and PORT-044 remain partial. Full native query meaning, source-exact
SignalFlow replay, reviewed notification routing, complete source schemas and
history, imported-evidence erasure and Business grant qualification remain open.
The [stock collector qualification](splunk-collector.md) separately exercises
supported OTLP pipelines; default proprietary exporters are not URL-compatible.
PORT-061 inherits current native owner checks on the history, replay and mapped
log-search doors; bearer credentials confer no import or source-reading authority.
PORT-034, PORT-035 and PORT-045 inherit this closed private custody projection,
inactive restore and no authority transfer. No import retires the source or
accepts a remaining historical gap. Every control has a visible word label;
there are no icon-only controls on these screens.

### Linked Splunk platform searches

An authorized Splunk platform user can preserve a search through the documented
[v2 search export endpoint](https://help.splunk.com/en/splunk-enterprise/rest-api-reference/9.4/search-endpoints/search-endpoint-descriptions).
Use the source installation's authenticated REST session, the exact original
search, explicit `earliest_time` and `latest_time`, and the permitted JSON output
mode. Export only authorized results. Keep the source search text, source link,
absolute event-time window, result capture and permission context with the
private source evidence. Never place the source credential in a URL or import
file. A Log Observer Connect link alone does not grant access to its Splunk
platform source, and a platform result export is not an Observability metrics
export. This edition does not execute a source search or download its result set.

On Move in, **Map a linked log search** maps one source index to one explicit
native service, environment and team, using the current saved source revision.
The native counter implements literal equality predicates joined by AND and a
terminal `stats count`, optionally grouped by one mapped scope field. See the
source [search syntax](https://help.splunk.com/en/splunk-enterprise/spl-search-reference/9.4/search-commands/search)
and [stats reference](https://help.splunk.com/en/splunk-enterprise/spl-search-reference/9.4/search-commands/stats).
No index name is guessed to be a native scope. The owner selects a native time
window in exact nanoseconds. Absolute epoch-second source bounds, whether in the
query or retained REST context, must match the selected window: source earliest
is inclusive and latest is exclusive. Relative bounds, unknown source context,
wildcards and other commands refuse as untranslated work.

The private `POST /api/porthole/v1/migration/log-search` door accepts `targetId`,
`targetRevision`, `mapping` with `index`, `service`, `environment` and `team`,
plus `from` and inclusive `through`. It reads complete native snapshot pages,
refusing a window beyond its bounded paging capacity rather than presenting a
partial total. It accepts no caller-supplied observations or expected count.
The response preserves source text and context, exact reviewed mapping, native
query references and source comparison status. A native count is not a source
parity result; absent an authorized source result comparison, cutover stays
blocked. Empty native data proves no source completeness.


### Finite source stream comparison

An authorized source operator can retain an original finite SignalFlow execution
stream using the official [SSE message specification](https://dev.splunk.com/observability/docs/signalflow/messages/stream_messages_specification/)
and [information message specification](https://dev.splunk.com/observability/docs/signalflow/messages/information_messages_specification/).
This edition does not execute a source program or obtain a source token. Attach
an authorized capture under the `sourceStreams` collection, with a stable `id`,
`source: "splunk-signalflow-stream"`, the original `programText`, exact
`request: {startMs, stopMs, resolution}`, `capture: {transport: "sse", body}`,
and a reviewed `comparison` declaring `valueTsId`, optional `eventTsId`,
`label`, `dimensions`, `tags` and optional `inputVariable`. Keep the complete
original SSE body; do not construct a result from expected native values.

The reader requires initialized finite execution, prior series metadata,
`JOB_RUNNING_RESOLUTION`, complete valid data and events, and `END_OF_CHANNEL`.
Aborted, incomplete, unknown, duplicated, unordered or malformed evidence refuses.
The original body is bounded to 60,000 bytes, with an explicit refusal rather
than truncation. Unknown information or changed actual cadence cannot establish
parity. Credential-bearing captures refuse; raw credentials cannot enter a
portable source archive.

Choose **Source stream comparison** in retained sample analysis. The comparator
binds the exact original program and capture revision, source job cadence,
selected aligned range and publish label. It compares each retained finite value,
common observed dimensions and metric tags, source firing and clear events, and
original event input values. Original provider incident IDs remain source
evidence, never new native identities. Definition tags cannot substitute for
observed metric tags. Each mismatch is named. Missing source points, missing
metadata, additional unqualified source series and unknown initial incident state
remain explicit. An equal finite sequence does not establish source lifecycle,
notification or completed-cutover parity.


### Local imported-target erasure

Move in keeps **Erase imported evidence** under its advanced controls. An
unrestricted native owner with proof completed within five minutes selects one
exact retained record revision, reviews the complete custody census and confirms
that inventory digest. A changed source, native edit, custody row or frozen
archive requires another review. Membership and proof are checked again inside
the destructive transaction. There is no automatic expiry or vendor deletion.

The selected native record and every linked kit lineage copy are retired through
the import library. Source tombstones prevent ordinary retries from recreating
the erased record. Unrelated native records and their review edits survive.
Opaque upload bodies, saved source-plan bodies and door archive bodies are
withdrawn as complete artifacts. All inactive restored import-history units and
all frozen product archive jobs are withdrawn whole. This deliberately removes
collateral original source history while preserving unrelated native records;
the preview names that consequence before consent. A large operation that cannot
fit the library's bounded transaction refuses rather than deleting a subset.
After an erasure, a newly uploaded source bundle cannot enter a product archive
until the real planner has screened it against the durable source tombstones.
A refused erased-source plan withdraws those newly uploaded bytes. The same
rule validates frozen inactive custody on restore.
This is imported-target erasure, not general subject erasure.

The private preview is `POST /api/porthole/v1/migration/erasure` with `kind`,
`id` and `revision`. The apply door adds `digest` and
`confirm: "erase-exact-import-target"` at the `/apply` suffix. Retrying the exact
successful approval returns its original receipt after current owner checks.
The committed checkpoint records only an opaque receipt, inventory digest and
erasure time, with an atomic private audit fact.

Download `GET /api/porthole/v1/migration/erasure/journal` and keep this later
journal with already downloaded archives. An independently owned empty
destination can explicitly apply it with the same journal's `format` and
`records`, plus `confirm: "apply-import-erasure-journal"`, through a POST to that
journal door. Applying new receipts to existing migration custody refuses;
reapplying identical receipts is safe. The journal has no subject selectors, so
it cannot selectively clean an older opaque archive. Restore therefore refuses
an archive missing any destination erasure checkpoint as a whole, both before
staging when detectable and at the final atomic commit. Rejected old source
bytes are withdrawn from that restore job under the current owner fence; other
archive jobs and native records are unchanged. A compatible subsequent
archive preserves those checkpoints. Downloaded copies and source vendors remain
under their original owners' control.

The adopted privacy default remains pending ct approval in PORT-043. PORT-034,
PORT-035, PORT-044, PORT-045 and PORT-061 inherit complete custody and later-journal
obligations; these local import doors do not qualify their broader erasure,
external-storage, retention or cutover requirements. Business grant custody and
streaming kit layouts refuse until separately adopted and qualified.
