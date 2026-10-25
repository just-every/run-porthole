# Retention and local subject erasure

These native-owner API doors use the installation session, same-origin POSTs,
an unrestricted product scope and identity proof from the preceding five minutes.
Delegated credentials cannot preview, approve or erase. Request and response
contents stay private; audit facts retain opaque references, never identifiers.

## Retention selections

POST `/api/porthole/v1/retention/preview` with `selection` containing `signal`,
`service` and `team`, plus integer `days` from 1 to 730. Service and team may be
`*`. The response freezes a cutoff, current policy revision, affected retained
record count, payload bytes and digest. Hot and archive copies count once.
The historical-analysis warning describes the loss a reduction would cause.

POST `/api/porthole/v1/retention/approve` with the same selection and days,
the returned `cutoffNs` and `confirm` equal to the preview digest. Approval
requires an unchanged preview and current policy revision within five minutes.
GET `/api/porthole/v1/retention` lists saved policies. A preview, a rejected
approval and policy approval itself delete no data. There is no expiry worker
yet; saved policy is a configuration selection, not executed retention proof.

Trace selections include 15 and 30 days. A lower custom trace policy is labeled
below the switching-buyer minimum. The 30-day trace filter tier, resource sizing,
expiry and full-horizon query qualification remain PORT-085 work. Restored
policies remain inactive and transfer no approval authority.

## Review before local erasure

POST `/api/porthole/v1/subject-erasure` with an `identifier` string. Matching
uses exact decoded string values in the normalized local intake envelope.
It includes complete and pending envelopes for logs, metrics, traces and
profiles. Substrings, alternate encodings, RUM and derived projections are not
qualified. The preview lists matching batch identities, record counts, bytes,
a digest and limits. It deletes nothing.

Original wire is an indivisible custody unit. If any record in a matching
envelope lacks the exact identifier, `canApply` is false and erasure is refused.
This preserves unrelated subjects until record-level erasure exists. A changed
inventory requires a new preview. No other subject or service is implicitly
added to approval.

POST `/api/porthole/v1/subject-erasure/apply` with the same identifier, returned
digest and `confirm: "erase-exact-batches"`. One live-authority transaction
appends minimal batch tombstones, invalidates frozen product archive jobs,
clears the selected original wire and normalized envelope payloads, deletes
their hot and archive records, and keeps only opaque envelope metadata so
sequence watermarks can never be reused,
and records scoped missing-evidence windows that keep monitor evaluation Unknown
for the erased interval. Local health receipts are invalidated. An empty selection is a
no-op. Original-wire retries refuse instead of reintroducing erased envelopes.
Previously configured analytical replication makes this operation refuse;
external replica erasure has not been implemented.

## Carry the later journal

GET `/api/porthole/v1/subject-erasure/journal` returns
`porthole.erased-batches.v1` with batch references, original content digests and
erasure times, without the selected identifier. Up to 100 entries are returned;
a larger journal requires the whole product archive rather than truncation.
To explicitly apply a journal, POST the same format and records with
`confirm: "apply-erasure-journal"` to that address under fresh owner authority.
Application is append-only; conflicting content digests refuse atomically.
It also invalidates product archive jobs and erases matching local envelopes.

The Settings product archive includes the journal. Applying a later journal
before restoring an older product archive preserves the later entries and
clears matching restored envelope payloads and deletes their records before commit. Staged raw chunks are
removed after successful restore. Subsequent signal export cannot release
those erased envelopes. Source credentials and approval authority stay inactive.

This is a bounded local implementation. Customer buckets and locked S3 objects,
legal holds, external backups, complete native archive journal application,
receipt history, imported evidence, dashboard projections, every derived cache,
service-wide erasure and late arrivals remain unqualified. It never reports
those domains deleted or sends an external deletion. Full PORT-035 and PORT-061
acceptance remains partial until those custody paths are implemented and proven.
