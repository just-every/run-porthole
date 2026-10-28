# Native log pipelines

An installation owner opens `/app/settings/pipelines`, edits a definition,
previews sanitized samples and approves that exact preview. A preview expires
in five minutes and belongs to its native session. Activation requires fresh
proof and the same current revision. A rollback previews an earlier definition
and activates it as a new revision. It never rewrites accepted telemetry.

The API is `/api/porthole/v1/pipelines`: GET reads versions; POST to `/preview`
accepts `definition`, current `revision` and `samples` (log-body strings). POST
to `/activate` accepts `previewId`, `digest` and `confirm: activate-pipeline`.
Definitions name one exact `service`, `environment` and `team`, ordered
`processors`, and `metrics`. Only one definition is active at a time.

```json
{
  "service": "checkout",
  "environment": "production",
  "team": "payments",
  "processors": [{"type": "json"}, {"type": "status", "source": "level"}],
  "metrics": [{"name": "checkout.logs"}],
  "exclude": {"field": "level", "equals": "debug"}
}
```

GET `/api/porthole/v1/pipelines/catalog` publishes the native examples and
bounds. Native processors include JSON, key-value and bounded named grok captures,
enrichment, attribute remap, status remap, category matches, versioned lookup,
URL parsing, a bounded user-agent parser, arithmetic and logical routing.
This native subset is not a claim of complete Datadog processor equivalence.
Processor errors retain sanitized input and diagnostic codes. Errors, critical
statuses, severe source logs and malformed records are protected from exclusion.

Mandatory US SSN, card and phone masks apply to newly accepted logs and spans before the durable envelope write,
including failed parsing. Other conservative key, token, address and network
identifier masks also apply. Custom `redaction` rules accept exact-width
literals, character classes and bounded exact repetitions. Groups, alternatives
and variable repetitions refuse. Exact custom exceptions cannot override the
mandatory masks. Credentials are never checked with an external service.

The original source-wire digest continues to identify retry and erasure. Stored
log and trace wire is a labeled sanitized JSON envelope; it is not the original transport
capture. Pipeline revisions are fixed at acceptance, so a pending queue and a
later retry cannot apply a newer parser to an accepted record.

POST `/metrics` and `/accounting` with a `definition` naming scope plus `from`
and `through` nanoseconds (half-open). Counts include matching accepted logs
before exclusion. Approved exclusions discard the newly accepted body before
queuing, keeping only a count and byte journal. Previously accepted data is
never rewritten. Accounting distinguishes excluded and retained records, exact
sanitized payload bytes, and its displayed versioned USD projection rates.
Queue framing and provider infrastructure overhead are outside that projection;
no provider bill, purchase or spending authority is asserted.

Product archives retain versions and counted points. Restore quarantines pipeline
versions and excludes preview grants. A destination owner must preview and
approve a definition anew. No retrospective deletion, external deletion or
retention timer is introduced. Device-backed RUM, authorized source-processor
comparison and full rule-library qualification remain contract gaps.
