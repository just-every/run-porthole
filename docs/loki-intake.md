# Loki log intake

Porthole accepts `POST /loki/api/v1/push` with a current scoped ingest
credential. It retains stream labels separately from per-line structured
metadata. Metadata does not become an index label or grant access to another
service, environment or team. Cardinality changes remain subject to the
PORT-023 approval boundary.

Use `Authorization: Bearer <local ingest credential>` and bind
`X-Scope-OrgID` to the credential's permitted team. The header must match every
record's team. Foreign, combined and forged tenant values refuse; a header
never grants read authority. Ingest credentials cannot read Explore. Native
sessions and separately minted read credentials retain their current scopes.
Revocation takes effect on the next request, including a retry of previously
accepted bytes.

## Wire formats and limits

The receiver follows Loki 3.5.0's `pkg/push/push.proto` and HTTP push schema:

- JSON with `Content-Type: application/json`, optionally gzip compressed.
- Raw Snappy-block protobuf with `Content-Type: application/x-protobuf`.
  Stock Loki clients may omit `Content-Encoding`; explicit `snappy` is accepted.
- Per-line string-map structured metadata, including protobuf default empty
  strings. Duplicate protobuf metadata keys refuse instead of silently losing
  a value. Parsed-field extensions are unsupported and return 415.

Use decimal-string nanoseconds in JSON. The original timestamp remains an
integer throughout storage and paginated reads. Results sort by nanosecond
ascending, then the persisted record ID ascending. That secondary key is
stable across restart, snapshot paging and inactive archive restoration.
Different lines may share the same nanosecond; neither is truncated to a
millisecond or dropped.

A request is limited to 1 MiB both on the wire and after decompression,
5,000 records, 1 MiB of normalized records, and a 1.5 MiB durable envelope.
A stream allows at most 30 labels; each label name plus value allows 4,096
characters. Labels must have Loki identifier names and string values.
The entire batch refuses if any line is older than two hours at receipt,
more than ten minutes ahead, malformed, outside scope or over a limit.
The supported delayed-line probe is 1 hour 59 minutes. Whole-batch refusal
avoids acknowledging a subset that the unchanged client will retry.

A 204 response follows durable envelope storage. Receipt headers include
`X-Porthole-Batch`, `X-Porthole-Accepted` and `X-Porthole-Duplicate`. An exact
wire retry under the same current credential returns its original batch
receipt, including after restart and reverse-order retries. A client-provided
`X-Porthole-Batch-ID` cannot be reused for changed bytes (409).
Re-encoding or regrouping entries into new envelopes is not covered by this
exact-wire identity guarantee; do not use it to claim general Loki replay
qualification. Preserve the shipper's source retry policy.

Queue pressure returns 429 with `Retry-After`; unavailable storage returns
503. Nothing is acknowledged without durable storage. The native Telemetry
delivery page and status API distinguish accepted, pending, queryable,
archived, rejected and duplicate records. Decoded rejected batches have exact
line counts. Malformed compressed bodies have an explicit unknown count,
never an invented zero-loss result. Rejections leave coverage Unknown even
when every accepted record has subsequently become queryable.

## Local shipper qualification

The reproducible journey in `tests/porthole/loki-shippers.mjs` uses:

| Component | Pinned version | Source |
| --- | --- | --- |
| Grafana Loki reference | 3.5.0 | Official Linux amd64 release archive |
| Grafana Alloy | 1.10.2 | Official Linux amd64 release archive |
| Promtail, retained compatibility version | 3.5.0 | Official Linux amd64 release archive |
| Fluent Bit | 4.0.0 | Official `fluent/fluent-bit:4.0.0` image |

Promtail is a retained compatibility target, not a recommendation for new
installations. Its historical supported configuration is preserved for this
migration test; this does not extend upstream maintenance.

Verify release archives against the publisher's `SHA256SUMS`. The Fluent Bit
image used here has digest
`sha256:3cabd4bd59596931cd99d812c99200e12fa08758fd08dfb0549c96ae97a70ddd`.
Provide the extracted stock binaries through `PORTHOLE_LOKI_BIN`,
`PORTHOLE_ALLOY_BIN`, `PORTHOLE_PROMTAIL_BIN` and `PORTHOLE_FLUENT_BIT_BIN`.
The journey installs nothing and makes no provider calls. Start with a built
checkout and run:

```sh
PORTHOLE_STOCK_ONLY=1 PORTHOLE_LOKI_SHIPPERS=1 node tests/runtime.mjs
```

This is an explicit scale journey, outside push Verify. Push Verify's existing
ingest journey exercises the official-schema wire edges and refusal paths.
The scale journey starts filesystem-backed Loki, writes 10,000 unique real
producer lines per shipper, and uses each shipper's existing multi-endpoint
configuration. Alloy uses endpoint blocks, Promtail uses clients, and Fluent
Bit uses two Loki outputs. The shared file parser, timestamp extraction,
labels, structured metadata, line selection, batch settings and retry policy
are identical for both destinations. Only the endpoint and local credential
can differ. No application-level fanout is used.

The fixture's baseline pipeline extracts a nanosecond RFC3339 timestamp,
selects the original Unicode line, labels four streams and attaches a
per-line metadata value. This baseline is deliberately the same before and
after adding Porthole. It is not a proposed rewrite of an existing customer
pipeline. `shipperConfig` in the journey publishes the exact configurations;
local credentials are passed privately through an environment reference.
The reference disables automatic service-name and log-level discovery so the comparison
covers the labels actually emitted by each shipper.

The journey reconciles every producer identity, full Unicode byte sequence,
stream label set, metadata value and original nanosecond through bounded
native pages and Loki's inclusive timestamp pages with categorized labels. A test destination edge
returns one 429 so the real stock client retries. The same stock corpus
survives restart, reversed exact-wire replay, private inactive product
archive restore and re-export. The native local analytical configuration and
separately connected primary and standby are compared using native APIs.
Delivery and Explore browser proof uses 1440 and 390 pixel viewports.

## Remaining qualification

This local slice does not qualify Lambda Promtail without an authorized AWS
account and Lambda scope, or the Docker Loki logging driver. It does not
approve a separate fanout, establish the complete PORT-086 LogQL floor or
supply its frozen authorized source corpus. Both Pyroscope profile paths,
including the stock Alloy Push RPC and the PORT-015 sample, stack, unit,
time and link comparisons, remain required. Five-shipper and two-profile-path
qualification and full PORT-087 completion remain open.

PORT-035 and PORT-096 custody and retention limits remain unchanged. Local
reference storage grants no AWS authority, source-corpus permission, broader
erasure, automatic expiry or external outbound authority.
