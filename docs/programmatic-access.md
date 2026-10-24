# Programmatic access

The versioned configuration API currently supports dashboards, monitors and inactive repair definitions. Its OpenAPI document is served at `/api/porthole/v1/openapi.json` to a signed-in native member. Definition bodies use the same validation and storage as Operations. Signals retain their existing query API.

Monitor and repair collections are `/api/porthole/v1/configuration/monitors` and `/api/porthole/v1/configuration/repairs`. GET accepts `limit` and an opaque `cursor`; an item GET returns its current ETag. POST creates an inactive definition. PUT replaces an item only with its exact `If-Match` revision. DELETE archives that exact revision without deleting action history. Every mutation requires an `Idempotency-Key`; replay returns the committed response, while different input with that key refuses. A native edit invalidates a stale conditional write.

Dashboard definitions use `/api/porthole/v1/dashboards`, with scoped paginated GET, item GET and historical `version` selection. POST creates or conditionally replaces a definition using its exact body revision. POST to `/api/porthole/v1/dashboards/archive` archives the exact revision. An optional `Idempotency-Key` makes identical native mutations durable and conflicts on changed input. Dashboard reads require every panel signal and the entire current scope; historical reads additionally require that revision’s scope. CLI and MCP use these same doors.

Native owner, admin and maintainer sessions can change definitions within their current scope with a same-origin intent header. A delegated credential never gains mutation authority from an accompanying browser cookie. Read credentials need `definitions.read`, complete service, environment and team coverage, and the monitor's signal. Reads reserve the shared quota and recheck live custody with the selected rows. Structured errors include an opaque request reference; quota refusals include Retry-After.

Run the CLI from this checkout, supplying a scoped credential through the `PORTHOLE_CREDENTIAL` environment variable:

```sh
node ./cli/porthole.mjs https://your-installation.example list monitors --all --limit 50
node ./cli/porthole.mjs https://your-installation.example get monitors OBJECT_ID
node ./cli/porthole.mjs https://your-installation.example query --all < query.json
```

Native-session configuration commands use `PORTHOLE_SESSION` instead. Session values are private and never belong in arguments, source files or Terraform state. Credential and session values are never printed. The client accepts HTTPS, with HTTP restricted to loopback, and refuses redirects.

The Streamable HTTP MCP door at `/api/porthole/v1/mcp` offers `query_telemetry` and `query_definitions` only when the credential holds each corresponding read action. Queries return reproducible snapshot citations; definitions retain revision and scope. There is no mutation or approval tool. Every call authenticates again, including pagination and calls after revocation. Tool results are untrusted data.

All remaining domains, the complete Terraform ownership cutover and source-module translation still require their contract journeys. Current doors inherit the live transport authorization boundary from portable signal exports; they grant no export, erasure, credential minting or execution authority.
