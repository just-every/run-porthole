# Retention and local subject erasure

These native-owner API doors require an installation session, same-origin POST,
unrestricted product scope and identity proof from the preceding five minutes.
Delegated credentials cannot preview, approve or erase. Audit facts contain opaque
references and counts, never the subject identifier or removed telemetry.

## Retention selections and explicit schedules

POST `/api/porthole/v1/retention/preview` with `selection` containing `signal`,
`service` and `team`, plus integer `days` from 1 to 730. Service and team accept
`*`. The response freezes the cutoff, current policy revision, affected retained
record count, payload bytes and digest. Hot and archive copies count once.
The historical-analysis warning describes the loss a reduction would cause.

POST `/api/porthole/v1/retention/approve` with the same selection and days,
the returned `cutoffNs` and `confirm` equal to the preview digest. Approval
requires the unchanged preview and current policy revision within five minutes.
A preview, rejected approval and policy approval itself delete no data.

Scheduling requires `schedule: true` in both preview and approval. Without that
explicit consent no expiry runs. This authorizes an hourly moving cutoff for
the exact signal, service, team and retention days, first due one hour after
approval. The installed scheduled handler runs due work. A fresh native owner
can also POST `{}` to `/api/porthole/v1/retention/tick` to process due work;
requests cannot supply a clock or bypass the due instant. A changed policy
cancels the previous schedule. A removed or changed approving owner suspends
it. Restored policies are inactive and live scheduling authority is not exported.

GET `/api/porthole/v1/retention` exposes saved policies, scheduled next instants
and expiry run counts and cutoffs. Each executed instant appends a private,
minimal audit entry. Expiry applies the same selective erasure journal to
original envelopes, retained data and configured analytical copies. An unavailable
copy remains pending; product reads apply its journal before returning data.

Trace selections include 15 and 30 days. A lower custom trace policy is labeled
below the switching-buyer minimum. The 30-day trace filter tier, resource sizing
and full-horizon query qualification remain PORT-085 work.

## Review before selective erasure

POST `/api/porthole/v1/subject-erasure` with an `identifier` string. Matching
uses exact decoded string values in normalized local intake envelopes for logs,
metrics, traces and profiles, including pending envelopes. The preview lists
matching batch identities, selected and remaining record counts, bytes, a digest
and custody limits. It deletes nothing. The digest binds the record ordinals
and analytical configuration revision; a changed inventory or connection requires
new review.

POST `/api/porthole/v1/subject-erasure/apply` with that identifier, digest and
`confirm: "erase-exact-batches"`. One live-authority transaction appends permanent
record fences, invalidates frozen product archive jobs, withdraws original wire
and removes the selected normalized, hot, archive and span-metric contributions.
Other subjects retain their original record IDs, payloads and timestamps.
Null holes in the normalized envelope preserve original ordinals, including
when a pending envelope later drains. Scoped missing-evidence windows keep the
erased interval Unknown. Original-wire retries are refused.

Every configured primary and standby receives the same append-only journal,
including paused workers. A successful response lists both acknowledgements.
An unreachable copy produces HTTP 202 with its pending role, rather than a
complete deletion claim. Owner reconciliation resumes propagation. Query,
health and failover apply the journal to the selected copy before using it;
an unavailable erasure transport therefore refuses data instead of serving a
stale copy. Analytical replication cannot reinsert an erased ordinal, including
original and sanitized packet replay after restart.

## Carry the later journal

GET `/api/porthole/v1/subject-erasure/journal` returns
`porthole.erased-batches.v2`: batch references, original content digests, original
record ordinals and erasure times, without subject identifiers. Null ordinals
mean an older whole-envelope fence. Up to 100 entries are returned; a larger
journal requires the whole product archive instead of silent truncation.
POST the format and records with `confirm: "apply-erasure-journal"` under fresh
owner authority to apply it. The earlier v1 format remains readable as whole
envelope fences. Conflicting content digests refuse atomically.

The Settings product archive carries this journal. Applying a later journal
before restoring an older product archive preserves later exclusions, selectively
withdraws restored records before commit, and keeps unrelated subjects. Staged
raw chunks are removed after successful restore. Subsequent queries and signal
exports cannot release the erased subject. Source credentials and approval
authority stay inactive.

## Boundary and adopted authority

PORT-096 adopts unrestricted native owner, five-minute identity proof, exact
inventory consent for mixed local erasure and both configured analytical workers,
and a separately explicit audited hourly retention schedule. No schedule is
inferred from policy selection. No external deletion is attempted. The standing
28 October conservative-default rule permits building this owner-only floor;
ct approval of the expanded custody and schedule remains required before DONE.

RUM, customer buckets and locked S3 objects, legal holds, external backups,
complete native installation-archive journal application, notice receipts,
imported evidence, dashboard projections, every derived cache, service-wide
erasure and alternate or late subject representations remain PORT-035 and
PORT-061 gaps. This operation never labels those domains deleted. The earlier
ct ruling of 25 October 2026 at 17:55Z qualified the homogeneous local slice;
it did not authorize the broader provider operations.
