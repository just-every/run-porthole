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
change-event/proposal overlap is at most seven days, and execution has no overlap.
Expiry warnings appear in Credentials. A quota refusal returns 429 with
`Retry-After`. Byte and USD reservations must be supplied by the trusted data or
job door when those doors ship, never by client usage claims.

Removal suspends custodial read, proposal and execution credentials permanently.
Ingest custody moves in the same removal transaction to an active owner/admin
whose existing scopes cover it. Personal tokens and sessions are revoked in
that transaction. Restoring an old scope does not revive a suspended key.

## Scoped programmatic reads

`POST /api/porthole/v1/query` accepts a read or proposal credential with
`telemetry.read`. Send a JSON object with `signal` (`logs`, `metrics` or
`traces`), optional `service`, `environment`, `team`, nanosecond `from`/`through`,
`limit`, `cursor`, `snapshot` or trace ID. The response includes records, a
snapshot watermark and a replay URL. Both the query and replay recheck current
credential and custodian authority. An accompanying owner cookie grants no
additional authority. Ingest and execution credentials cannot query.

The read-only CLI uses the same REST endpoint. Set `PORTHOLE_CREDENTIAL` through
your secret manager, then run:

```sh
node scripts/porthole/query.mjs https://your-installation.example < query.json
```

For example, `query.json` can contain
`{"signal":"logs","service":"checkout","environment":"production","team":"commerce"}`.
The CLI takes no credential argument, follows no redirects and permits plain
HTTP only on loopback. It prints the query result or a safe refusal code; it
cannot select a write route.

MCP clients use the shared stateless Streamable HTTP door at `POST /mcp`;
`POST /api/porthole/v1/mcp` reaches the same handler. Negotiate `2026-07-28`
or `2025-11-25`, and send the matching protocol header and an Authorization
credential on every call. Modern requests also carry MCP method/name headers
and matching protocol metadata. See [programmatic access](/docs/v1/programmatic-access).

The native tools are `porthole.telemetry.query`, `porthole.definitions.read`
and the content-free `porthole.workspace.snapshot`. Both content reads are
sensitive. Signed company policy, named-person approval when required and
current native authority govern them. A local owner may configure policy on
an independently operated installation. No native cookie, tool argument or
returned log text grants agent authority. Events, resources, prompts and
subscriptions are undeclared; no mutation, credential minting or repair
execution tool is exposed. Read the [company agent guide](/docs/v1/company-agents).

REST, CLI and MCP share one quota ledger, including daily selected-payload byte
reservations, and next-request revocation. Their audit records contain opaque
actor/snapshot references and outcomes, excluding request bodies, query literals
and header credentials. The closed installation archive excludes credential
secrets, hashes and approval grants.

PORT-025/026 and later query, job, object and approval doors inherit the same
role, scope and live-revision checks. PORT-091 owns device revocation and
reviewed object/running-work handover. PORT-092 remains incomplete for running
jobs, ignored-instruction reports, prompt/artifact secret exclusion and exact
approved-plan execution. These read transports do not run an agent or confer
approval authority; real execution requires PORT-077's authorized estate.
