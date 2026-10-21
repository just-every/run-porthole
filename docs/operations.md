# Operational audit and health foundations (API v1)

These doors are implemented foundations. PORT-033 and PORT-037 are incomplete;
the contract and acceptance journeys retain their full scope. No telemetry,
monitor, repair, collector, notification or analytical recovery is supplied by
these foundations.

An installation owner can open `/app/audit` and `/app/health` after native
sign-in and first-run setup. The documents reuse the existing Base frame.
`GET /api/v1/audit`, `GET /api/v1/audit/export` and `GET /api/v1/health` use
the same installation-native session. Every handler checks authority directly;
non-owner sessions and requests from another origin refuse. Responses are
private, uncacheable and excluded from indexing. There are no public append,
edit or delete audit endpoints, and these endpoints do not mint credentials.

## Audit coverage and privacy

Today the edition records native POST attempts/results for invitations and
cancellations, role/status changes, session revocation, display-name/email
changes, identity settings, domain rules, provider unlink/relink and the optional
policy approval/revocation routes. An unavailable optional auth action remains a
recorded refusal; a record does not claim that the action exists or succeeded.
Audit reads/exports record their own result and pinned numeric sequence range.
The event includes opaque operation and actor references, the actor's native
authority revision, occurrence time, recording time, phase and HTTP status.
UUID references are not session tokens. The ledger stores no actor directory,
email, name, request/response body, header, URL, exception, credential or query
literal. History is not hydrated with current identity labels in the audit UI.

A durable attempt is written before a covered native mutation. If that write
fails, the mutation does not run. Its result is appended after the native handler
returns. Those are separate transactions: a crash or failed result append can
leave an attempt without an outcome after the action took effect. That means
**uncertain**, not failed or safe to retry; inspect the native object and the
operation reference before retrying. Do not infer a target object's revision
from the authority revision. Full atomic target revision/outcome capture,
non-HTTP/background actions, all remaining native auth/provider doors and the
future product action families remain PORT-033 gaps.

SQLite triggers reject ledger updates/deletes and broken sequence/predecessor
inserts. Concurrent append uses a guarded predecessor check; exhausted contention
refuses instead of accepting a fork. A deployment with privileged database
access can remove guards, so export integrity requires an independently retained
checkpoint; a hash chain alone is not a signature or proof against its custodian.

## Reproducible reads and Evidence handoff

`GET /api/v1/audit?after=0&through=100&limit=25` selects sequence `(0,100]`,
where `through` must already exist; omit it to pin the current head. Limits are
1–100, default 25. Follow `next` as `after` while retaining the original `through`.
The returned checkpoint belongs to that pinned `through` value. Concurrent
reads append their own audit events without changing the pinned result. Invalid,
duplicate and unrecognized parameters refuse without recording their values.
An empty range is explicit. An attempt's result contains the exact numeric
reproduction range; query strings are never copied.

Download `/api/v1/audit/export`. The `porthole.audit.v1` packet contains the
ordered prefix, its checkpoint and versioned metadata for an owner-authorized
Evidence handoff. It does not send anything to Evidence or assert compliance.
Keep `checkpoint.hash` in separate custody, then check the saved packet offline:

```sh
node scripts/porthole/verify-audit.mjs audit.json INDEPENDENTLY_RETAINED_64_HEX_CHECKPOINT
```

The independent reader rejects changed content, gaps, duplicates, reordering,
truncation, digest changes and an inconsistent retained checkpoint. Replacing
both a packet and its untrusted checkpoint is not authenticated by this format.
Export refuses above 10,000 entries rather than silently truncating; streaming,
scoped provider handoff and larger archival export remain future work.

The installation adapter includes `porthole_audit_entries` in Base's archive
inventory. `rer export --output PATH` and `rer import --input PATH --yes` remain
the supported archive commands, into an empty destination only. The independent
packet is an evidence export, not a product-data import door. No separate
product importer is introduced. Actor erasure, later-erasure fencing and the
full supported Base archive round-trip still require their public-door proof;
restart persistence alone does not prove them. Do not restore an older identity
directory to claim erased actors stayed anonymous.

Future clauses PORT-001/012/018/019/021/026/029/034/035/036/055/061 inherit
PORT-033's existing audit obligations for their query, configuration, execution,
archive, erasure, credential, connector and export doors. None is implemented or
qualified by the audit foundation.

## Independent health and recovery limits

`GET /api/v1/health` and `/app/health` read the Base control plane directly,
without calling an analytical backend or consulting deployment `/health`.
The control-plane row probes its real D1 database and reports its observation
time. Collector, ingest, queue, analytical storage, query, monitor-evaluation
and delivery each have separate rows. Until real components provide independent
fresh receipts, every one reports **Unknown** with a missing-coverage reason.
Last-accepted/queryable timestamps are null, never manufactured from request time.
The overall state stays Unknown even while deployment `/health` says `ok`.

For a missing pipeline, inspect these rows first and retain Unknown. For a
control-plane failure, use the owner's Base installation backup/restore procedure;
do not enable collection, delivery or execution based on a successful `/health`.
This is a diagnostic starting point, not a qualified analytical failover runbook.
Last-known telemetry snapshots, fresh/stale component receipts, an independently
configured failure notification, analytical-worker failover, durable ingest/send
backlog reconciliation, original telemetry timestamps, repair idempotency and a
firing-monitor outage/restore drill are still required by PORT-037. No notification
or production action is sent by these read-only health doors.
