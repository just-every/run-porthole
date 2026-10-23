# Reviewed source evidence imports

The native owner opens `/app/import`, uploads a JSON export, reviews counts,
rejections, differences and the fingerprint, and explicitly applies that plan.
The same Base import door serves the screen and the owner HTTP API. Imports
remain inactive source evidence. They do not create working native dashboards,
translate queries, activate detectors, repoint collection, send notifications,
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

For Splunk, obtain permitted definitions through the official
[Observability API](https://dev.splunk.com/observability/docs/apibasics/), retaining
the original chart and detector IDs, `programText`, rules and tags. Attach only
log search references the owner is authorized to retain. SignalFlow and SPL
remain untranslated source text here. A security dashboard carries an explicit
Splunk Enterprise Security handoff; importing its reference does not provide
security analytics. Paid export limits and unavailable historical periods must
remain named source work. Automated extraction and rate-limit resume have not
been implemented.

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

PORT-043 and PORT-044 remain partial. Detector replay, native query and alert
meaning, supported OTel repointing, full source schemas, exact named construct
resolution and complete historical extraction are still required. PORT-034,
PORT-035 and PORT-045 inherit import custody and archive continuity before this
new domain can qualify complete product portability or erasure. The existing
product archive refuses when this new import custody exists, so it cannot
silently omit it. The new screens use visible word labels for every control;
there are no icon-only controls.
