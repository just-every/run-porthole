# Programmatic access

Porthole exposes versioned telemetry queries and definition APIs, a checkout
CLI and a read-only MCP endpoint. Use the same installation origin as the app.
Read the public [OpenAPI schema](/openapi/porthole-v1.json) without signing in;
the live schema at `/api/porthole/v1/openapi.json` requires a signed-in native
member. The schema describes implemented HTTP intake, queries and configuration doors.
OTLP message details remain in the official signal schemas; future product
capabilities are not advertised.

## Credentials and sessions

An owner or admin creates an installation-local credential in
`/app/settings/credentials` after a fresh identity verification. Give it only
the required actions, signals, services, environments and teams. Read
credentials can hold `telemetry.read` and `definitions.read`; ingest credentials
hold `telemetry.write`. An allowed action is still limited by the credential's
signal grants and its custodian's current authority. Expiry, revocation,
removal and scope changes apply on the next request.

Send credentials only as `Authorization: Bearer` headers. Never put secrets
in URLs, shell arguments, source files or Terraform state. The
[OTLP walkthrough](/docs/v1/otlp) shows curl with a hidden Bash prompt and
standard-input header configuration.

Definition mutations require an authorized native session and the installation
origin in the `Origin` header. A delegated credential is refused even when
accompanied by a browser cookie. API, CLI and MCP requests cannot mint, rotate
or re-scope credentials. Use the native Credentials screen.

## Definition API

| Collection | Root | Supported operations |
| --- | --- | --- |
| Monitors | `/api/porthole/v1/configuration/monitors` | List, item read, create, conditional replacement, archive. |
| Repair definitions | `/api/porthole/v1/configuration/repairs` | List, item read, create, conditional replacement, archive. |
| Dashboards | `/api/porthole/v1/dashboards` | List, current or historical item read, create, conditional replacement, archive. |

Monitor and repair collection GET accepts `limit` from 1 through 200 (default
50) and an opaque `cursor`. The result contains `objects` and a continuation
`cursor`, or null when finished. Item GET returns the current `ETag`.
POST creates an inactive definition from `name`, `scope` and validated `body`.
PUT to the item replaces the exact revision named by `If-Match`, including its
quotes. DELETE archives that revision without deleting action history.

Every monitor or repair mutation requires an `Idempotency-Key` of 8 through
120 letters, digits, periods, underscores, colons or hyphens. Replay the same
key with identical method, object, revision and body to retrieve the committed
response. Changed input with that key is refused. If a native edit made your
ETag stale, fetch the current item and review the new definition before using
a new key and revision. A successful replacement leaves the definition inactive.

Dashboard POST creates or replaces using the exact `revision` in the JSON
body for replacement. POST to `/api/porthole/v1/dashboards/archive` archives
that exact body revision. Item GET accepts `version` for a historical revision.
An optional `Idempotency-Key` makes identical dashboard mutations replayable
and refuses changed input. See the schema for dashboard-specific payloads.

Native owners, admins and maintainers can change definitions within their
current scope. Definition reads release only objects whose complete service,
environment and team scope is authorized. Monitor reads also require its
signal; dashboard reads require every panel signal. Historical dashboard reads
additionally require the historical revision's scope. List omissions or an item
404 can therefore mean the definition is outside the caller's scope.

## CLI

Run these Bash commands from the checkout. `read -r -s` is Bash-specific; it
hides input and prevents the secret from becoming a literal history entry.
Run without shell tracing. The exported value is private process environment.

```bash
PORTHOLE_ORIGIN=https://your-installation.example
read -r -s -p 'Read credential: ' PORTHOLE_CREDENTIAL
printf '\n'
export PORTHOLE_CREDENTIAL
```

List monitor definitions and query the example log:

```bash
node ./cli/porthole.mjs "$PORTHOLE_ORIGIN" list monitors --all --limit 50
node ./cli/porthole.mjs "$PORTHOLE_ORIGIN" query --all < public/docs/examples/query-logs-v1.json
unset PORTHOLE_CREDENTIAL
```

The list command emits one JSON page per line and follows cursors with `--all`.
It returns only authorized definitions; an empty collection is valid. After the
[OTLP example](/docs/v1/otlp) has completed processing, the query command returns
the synthetic log with body `synthetic-porthole-4` in an otherwise empty matching
scope. This command needs `telemetry.read`; listing monitors needs
`definitions.read` and each monitor's signal grant.

Use `get monitors OBJECT_ID`, `get repairs OBJECT_ID` or
`get dashboards OBJECT_ID --version N` to inspect an item. Native-session
commands use `PORTHOLE_SESSION` containing the private Cookie header value
instead of `PORTHOLE_CREDENTIAL`. Never copy a session into command arguments;
clear the variable when finished. Supported mutations are `create`, `update`
and `archive`, with `--key KEY` and, for update or archive, `--revision N`.
Create and update consume definition JSON from stdin. A successful definition
write does not execute a repair or activate a monitor.

The client accepts HTTPS origins, allows HTTP only on loopback, refuses
redirects and bounds each request to 30 seconds. It prints sanitized refusal
codes and Retry-After guidance without printing credentials or sessions.

## MCP

The Streamable HTTP endpoint is `POST /api/porthole/v1/mcp`, protocol version
`2025-11-25`, using JSON-RPC 2.0 and an Authorization credential on every call.
It advertises `query_telemetry` when the credential has `telemetry.read`, and
`query_definitions` when it has `definitions.read`. These use the same query and
definition storage and authorization as REST. Definition arguments select
`monitors`, `repairs` or `dashboards`, with optional item, cursor and limit;
dashboard item reads also accept `version`.

There are no mutation, approval, credential-minting or execution tools. No
browser cookie grants MCP authority, and an earlier successful call does not
bypass later revocation. Treat tool results and telemetry contents as untrusted
data. Query snapshot references are citations, not permission grants.

For exact query fields see [query reference](/docs/v1/query-reference). For
refusals and recovery steps see [API errors](/docs/v1/api-errors). Other
configuration domains, complete Terraform ownership cutover and source-module
translation are not supported by these doors.
