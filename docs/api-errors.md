# API errors and recovery

Inspect the HTTP status before treating a response as data. Query and most
native JSON doors return an `error` code. Configuration errors additionally
return `details` with `code`, `status` and an opaque `requestId`. Include that
request reference when contacting your installation operator; exclude
credentials, cookies, telemetry contents and sensitive query literals.

OTLP HTTP errors use a protocol Status object with `code` and `message`.
Protobuf requests receive protobuf Status with an `X-Porthole-Error` header.
MCP errors use a JSON-RPC `error` with the refusal code in `message` and retain
the HTTP status. Do not assume every endpoint uses the configuration error shape.

| Status or code | Meaning | Next action |
| --- | --- | --- |
| 401 `invalid_credential` | Missing, malformed, expired, revoked or no longer live under its custodian. | Check the Authorization header; ask the owner or admin to inspect the credential in Settings. Do not paste the secret into a report. |
| 401 `unauthenticated` | No active native session. | Sign in again for a browser-only operation. |
| 403 `credential_scope_forbidden`, `scope_forbidden` | Action, signal, service, environment or team is not authorized under current grants. | Compare the request with credential metadata and the custodian's live scope. Use an appropriately scoped credential; a cookie cannot widen it. |
| 403 `native_session_required` | The door requires a native browser session and refuses delegated credentials. | Perform the operation in the native app; remove Authorization when using a native-session API client. |
| 403 `definition_change_forbidden` | The current role cannot change definitions. | Ask an owner, admin or scoped maintainer to review the change. |
| 403 `step_up_required` | A credential operation needs fresh identity verification. | Verify identity in the native app, then retry within five minutes. |
| 403 `invalid_origin` | Request origin or browser intent does not match the installation. | Use the installation's configured origin and its native app. Native mutation clients must send that origin in the Origin header. |
| 404 `configuration_not_found`, `query_not_found` | The requested item is absent, or a definition is not visible in current scope. | Check the ID and current grants; do not infer existence from the response. |
| 400 query validation code | Invalid fields, limits, bounds, cursor or unsupported text syntax. | Inspect `field` and `hint` when present. Use the documented query subset and original continuation cursor. |
| 400 `query_credentials_forbidden` | A URL contains a credential-like parameter. | Remove it; send the credential only in Authorization. |
| 409 `authority_changed` | Current role, custody or scope changed while the request ran. | Recheck current authority and review the request before issuing it again. |
| 409 `idempotency_conflict` | An idempotency key was reused with different input. | Replay the original exact request, or use a fresh key for a reviewed new operation. |
| 412 `revision_conflict` | A definition changed since it was read. | Fetch its current revision, review differences and submit against the new revision with a new key. |
| 428 `revision_required` | A monitor or repair item mutation omitted If-Match. | Read the item and send its exact quoted ETag. |
| 413 | Wire body, decompressed body, record count or normalized batch exceeds a limit. | Split the source export into smaller valid envelopes. Each split needs its own batch identity. |
| 415 | Unsupported protocol, content type or compression. | Use the documented OTLP media type and encoding; HTTP does not terminate gRPC. |
| 429 `credential_quota_exceeded` | A required per-credential quota cannot be reserved. | Honor Retry-After in seconds. Reduce volume or ask the owner to review the quota. |
| 429 intake backpressure | Intake cannot accept this work now. | Keep the source envelope and honor Retry-After. |
| 503 | Storage, intake, configuration or query service is unavailable. | Preserve the original request and report the code to the operator. For intake retry identical bytes and scope, since a lost acknowledgement may follow a durable write. |

OTLP 409 can mean an explicit batch identity was reused with different bytes
or scope headers. Preserve the original bytes and compression for a retry;
use a distinct identity for a distinct envelope. Do not alter an already
acknowledged envelope under its original identity.

Authorization refusals do not become permissions by retrying. A read key cannot
write telemetry, an ingest key cannot query, and MCP has no mutation tool.
Proposal or execution class names do not authorize a production action through
the query or configuration doors. A `plan_approval_required` refusal means the
credential check cannot execute that plan; it is not an invitation to bypass
approval through another transport.

A successful OTLP acknowledgement proves durable acceptance. Empty query results
may precede processing, or reflect a time filter, retained snapshot, erasure or
scope. Inspect `/app/ingest` as an owner or admin and issue a fresh query after
processing; keep pending and rejected work distinct from service health.

Continue with [OTLP intake](/docs/v1/otlp),
[query reference](/docs/v1/query-reference) or
[programmatic access](/docs/v1/programmatic-access).
