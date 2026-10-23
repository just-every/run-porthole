# Audit and operational doors

After native sign-in and setup, open Audit (`/app/audit`), Explore (`/app/explore`), Operations (`/app/operations`), Telemetry delivery (`/app/ingest`), Pipeline health (`/app/health`) or Settings → Archive. Each server handler checks the current native session or a scoped credential directly. Responses are private, uncacheable and excluded from indexing. Owners and admins read audit; only owners export it. Audit has no public append, edit or delete endpoint.

## Durable facts and private audit

Every covered mutation first records an attempted action. Its database writes run with an installation-local context inside one D1 transaction. Triggers record immutable facts containing the operation, actor, target reference and actual revision in that same transaction. A failed fact insert rolls back the target write. Native role, membership, invitation, session, credential, identity-setting, domain, provider and approval changes use this boundary. Bootstrap records its own durable fact. Notice delivery records a separate opaque attempt/result. HTTP results follow the database facts; a missing response never changes a committed fact into a failed action.

Facts project idempotently into a SHA-256 predecessor chain. A process can stop after a target commit and before projection; the next audit read projects the original fact once. A failed response or projection returns the operation reference with an instruction to inspect before retrying. Occurrence and recording times stay separate. A `committed` row describes persisted state; `succeeded`, `denied` and `failed` describe the HTTP result. Credential custody suspension and native session revocation facts are captured by the same transaction triggers.

Audit stores only server-selected action labels, opaque references, revisions, times and results. It never copies a request body, URL, header, email address, display name, token, credential hash, query literal or exception. Native settings with nonopaque keys have a private alias directory; their key strings do not enter the chain. The UI does not hydrate historical references from the native identity directory.

Actor privacy (`/app/settings/privacy`, `POST /api/porthole/v1/actors/erase`) requires the native owner, fresh identity proof and explicit confirmation. Remove the member first through Members. Erasure anonymizes their native directory record and external identity linkage, destroys unusable authentication values and records the opaque erasure journal in the same transaction. The erased account cannot reactivate. Historical audit bytes and actor references remain unchanged. Telemetry-subject erasure and retention policy remain PORT-035's separate responsibility.

## Queries, revisions and approval

`POST /api/porthole/v1/query` accepts the supported signal/service/environment/team and nanosecond range filters. Explore submits the same operation. The underlying reader persists a protected query descriptor and an immutable completion watermark; audit carries only its opaque reference. `GET /api/porthole/v1/query/REFERENCE` repeats that descriptor under the caller's current authority. A later batch cannot enter the frozen result, and changed permissions still narrow or refuse replay. Direct telemetry reads and credential queries use the same scoped reader and emit an audit reference. Query descriptors belong to the protected product store, not the less detailed audit packet.

Operations saves real versioned count-monitor definitions and inactive repair plans. Monitor activation requires explicit confirmation for the current revision. An authorized owner, admin, scoped maintainer or responder can record approval of an exact unexpired repair revision. Editing creates a different revision and removes its approved state. There is no production executor yet; an approval record is not an executed repair. Quarantined restored definitions cannot activate, change or approve until a supported local reauthorization path exists.

## Export and independent integrity checking

`GET /api/v1/audit?after=0&through=100&limit=25` reads sequence `(0,100]`. Omit `through` to select the current checkpoint. Follow `next` while retaining that checkpoint. Invalid, duplicate and unknown parameters refuse without copying their values. A concurrent action cannot change a pinned prefix.

`GET /api/v1/audit/export` streams the complete pinned packet in pages of 100 records without a row ceiling. Keep its checkpoint in independent custody and verify the saved packet:

```sh
node scripts/porthole/verify-audit.mjs audit.json INDEPENDENTLY_RETAINED_64_HEX_CHECKPOINT
```

The independent reader rejects content changes, gaps, duplicates, reordering, truncation and checkpoint substitution. SQLite guards reject chain modification and deletion. A privileged database custodian can remove guards, so the chain alone is not a signature against that custodian. The packet supports an owner-authorized Evidence handoff; exporting it does not send it to another provider. PORT-052 supplies the connected scoped Evidence request/export and provider-receipt workflow and inherits this private, independently verifiable packet.

Settings → Archive and `node scripts/porthole/archive.mjs export ORIGIN DIRECTORY` preserve current product data, source/history labels, raw telemetry, audit streams and the actor-erasure journal. Keep a fresh native-session cookie in `PORTHOLE_ARCHIVE_COOKIE`, never in command arguments. Restore requires an empty product under its own destination owner; credentials, sessions and approval authority do not transfer. Imported definitions and historical health/delivery work are quarantined, ingestion is paused, and source audit streams retain their original hashes. The destination erasure journal is merged, never replaced by an older journal.

The shared `rer export`/`rer import` adapter also excludes credential and session material and applies an executable inactive-restore policy. Its native full-installation round trip is a separate qualification from the HTTP product archive.

## Coverage inherited by later doors

Current public doors cover membership, credentials, identity administration, queries, exports, monitor definitions, exact repair approval, actor privacy and independent notice attempts. PORT-001/012/018/019/021/026/029/034/035/036/052/055/061 inherit this boundary before adding their remaining ingestion-policy, dashboard, SLO, pipeline, tool, execution, erasure, connector and signal-export doors. A future family is not implemented by a label in the audit map.

See [recovery.md](recovery.md) for independent observations, collector freshness, durable draining, firing-monitor outage behavior, notice consent and the remaining analytical/Base recovery limits.

## Customer-bucket history

An installation may bind its customer R2 bucket as `ARCHIVE_BUCKET`. The owner uploads an immutable open-format historical object through `POST /api/porthole/v1/storage/history`, supplying `X-Porthole-Source`, `X-Porthole-History` and its content type. The response records an opaque identity, SHA-256, byte count and source/history labels. No request chooses a different bucket or supplies provider credentials. GET/HEAD on `/api/porthole/v1/storage/history/REFERENCE/content` verify the actual object digest before releasing bytes under the current owner session. Uploads and reauthorization require fresh native owner proof.

The streaming product archive preserves those exact durable references, with no bucket access grant. Restore quarantines them. To reattach the destination bucket, the owner explicitly confirms the original digest and supplies the identical original bytes, or verifies an already present object; only then can the destination serve it. Collection and delivery remain paused independently. PORT-013/035/061 inherit this custody and audit boundary for their larger archive, erasure and export workflows.


## Oncall monitor handoff

The native owner can approve one explicit service, environment and team monitor
through `POST /api/porthole/v1/integrations/oncall` after fresh native identity
verification. The JSON body contains `monitorId`, the existing Oncall `source`,
`destinationService` and `confirm: "send-monitor-events"`. A read of the same
endpoint returns routes and secret-free durable outcomes. Send `monitorId` and
`disable: true` to stop future dispatch. Route replacement, monitor revision and
owner authority changes hold old pending work. Approval has no default recipient
and exports no raw telemetry or custom monitor text.

An owner must first configure the deployment service binding `ONCALL_SERVICE`,
its exact HTTPS `ONCALL_ORIGIN`, and the platform secret `ONCALL_SOURCE_KEY` for
an existing service-scoped Oncall native source. This adapter uses the documented
Oncall native ingress, not an incident-management credential. There is no direct
network destination input on the configuration API. Source keys never enter
Porthole tables, receipts, audit records or portable archives. Rotate the platform
secret together with the existing source key. A refusal requires owner review.

Real monitor evaluation commits the outbox event and state together. A firing
episode supplies the stable generation; its matching healthy evaluation sends
recovery with that generation. Unknown retains the generation and cannot create
recovery. Each tick sends at most one due event. Provider rate limits retain the
retry deadline and stop after five attempts. Lost responses, malformed receipts,
server failures and expired send leases remain uncertain, with no automatic
resubmission. Inspect the stable source event in Oncall; there is no replay door
in this slice. Recovery waits for an accepted trigger. Accepted means only native
intake acceptance; it proves neither human receipt nor paging or incident
resolution. Current Oncall does not provide phone paging or an independent
standby; preserve an existing pager. This path never calls incident transitions.

Portable archives retain route metadata and exact outbox history in the existing
quarantined history projection. They restore no live route, source key or delivery
authority. Lamp component rules, SLO evidence, investigation evidence and action
result handoffs remain unimplemented under PORT-051.

Conservative policy adopted pending ct approval: only the fresh native owner may
approve an exact single-scope route; outbound data is restricted to opaque alert
identity, original event time, generic state text and the authenticated health
link. PORT-020, PORT-055 and PORT-059 inherit the same authority and uncertainty
obligations when they add destinations, lifecycle controls or follow-up.
