# Members and installation credentials

After completing setup, open **Settings → Members**. Owners can invite or
change all seven product roles. Admins manage the five member roles. A member
has one role and explicit service, environment and team scopes. Contractors
must name services and environments; they cannot open Settings.

A confirmation link re-proves your identity for five minutes. Use **Send
confirmation link** before granting owner/admin, removing someone or managing
credential grants. Revoking a session or credential does not require a new
proof. To transfer ownership, grant owner to an active member, type their email
to confirm, and only then step down. The last active owner cannot be removed or
demoted. Changes invalidate existing sessions and personal tokens immediately.

Members includes the one-time migration report. Existing Base owners and admins
keep their roles; existing Base members become read-only analysts with empty
scopes. Newly installed accounts have explicit product-role records too.

Open **Settings → Credentials** to mint a named installation identity. A native
session and fresh proof are required. Owners and admins mint ingest,
change-event and read credentials within their own authority. Only owners mint
proposal and execution credentials, separately. No credential can mint,
approve, change membership or access provider secrets.

Copy the secret into your secret manager when it is shown. Porthole stores only
its hash and masked identifiers; the secret cannot be recovered. Use
`Authorization: Bearer <secret>`; URLs never authenticate a credential.
`GET /api/porthole/v1/credential` reports the authenticated identity's current
scope and last use. It does not query telemetry or execute a plan.

Every credential expires. Rotation preserves scope and quotas; read/ingest/
change-event overlap is at most seven days, and execution has no overlap.
Expiry warnings appear in Credentials. A quota refusal returns 429 with
`Retry-After`. Byte and USD reservations must be supplied by the trusted data or
job door when those doors ship, never by client usage claims.

Removal suspends custodial read, proposal and execution credentials permanently.
Ingest custody moves in the same removal transaction to an active owner/admin
whose existing scopes cover it. Personal tokens and sessions are revoked in
that transaction. Restoring an old scope does not revive a suspended key.

The current role policy covers native administration, these Settings screens,
the personal-token identity door and credential introspection. PORT-025/026 and
the later query, job, object and approval clauses must enforce the same roles,
scopes and revision fence on their doors before shipping. PORT-091 owns device
revocation and reviewed object/running-work handover; PORT-092 owns job and plan
execution plus prompt/archive secret exclusion. These paths do not collect
telemetry, run an agent or confer approval authority.
