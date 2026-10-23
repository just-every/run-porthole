# Portable signal exports

Signal exports read the installation's retained hot records and archive records
once per stable record ID. They do not export credentials, approve actions, or
restore an installation. The current data door is the versioned REST endpoint
`/api/porthole/v1/exports`, with a resumable CLI in
`./scripts/porthole/export.mjs`.

A native owner creates a preview, reviews its frozen range, scope, per-signal
counts, payload bytes and page limits, then explicitly approves that export ID.
The preview pins the completed ingest sequence: later arrivals with old event
timestamps do not enter the approved export. USD cost is reported as unavailable
until infrastructure prices are configured; the payload estimate excludes file
framing and provider scan charges. There is no silent total row limit.

The conservative authority default awaiting policy review is that only a native
owner can preview, approve or cancel. Approval may designate one existing read
credential held by that same owner, whose live scope covers the entire selected
range. A credential cannot grant itself export access. Every page checks the
owner's current role and membership revision, the export state and the current
credential's scopes, expiry and quotas. Credential revocation or narrowing stops
subsequent requests. Already downloaded files stay in the owner's custody.
Cancellation also stops later pages. All actions and reads are privately audited.

## Preview, approve and resume

Supply the native session through `PORTHOLE_COOKIE`; never put it in arguments
or source files. For approved delegated downloads use `PORTHOLE_CREDENTIAL`.
The CLI gives credentials only to the selected HTTPS origin (or loopback HTTP),
refuses redirects and reports safe error codes and Retry-After guidance.

A selection JSON file contains decimal nanosecond strings and explicit scopes:

```json
{"from":"1792756800000000000","through":"1792760400000000000","signals":["logs","metrics","traces","profiles"],"scope":{"services":["checkout"],"environments":["production"],"teams":["commerce"]},"pageSize":50}
```

```sh
node ./scripts/porthole/export.mjs preview https://porthole.example < selection.json
node ./scripts/porthole/export.mjs approve https://porthole.example EXPORT_ID
node ./scripts/porthole/export.mjs download https://porthole.example EXPORT_ID ./signal-download
```

To designate a read credential, add `--credential-id=CREDENTIAL_ID` to the
approval command while using the owner's native session. Clear `PORTHOLE_COOKIE`
and set the designated `PORTHOLE_CREDENTIAL` for the download process. Setting
both selects the credential and never grants it the session's authority.

Repeat the identical download command after interruption. Each page is written,
synced and renamed before its SHA-256 checkpoint advances. Replaying a page
cannot duplicate a numbered file. Existing pages are checked before resume;
corruption or a different origin, export ID or format refuses. `--max-pages=1`
provides a bounded partial download, which is explicitly reported incomplete.

## REST and file formats

- `POST /api/porthole/v1/exports` creates a preview from the selection above.
- `GET /api/porthole/v1/exports/EXPORT_ID` returns the owner's saved manifest.
- `POST /api/porthole/v1/exports/EXPORT_ID/approve` accepts
  `{"confirm":"EXPORT_ID","credentialId":"CREDENTIAL_ID"}`; the credential is optional.
- `GET /api/porthole/v1/exports/EXPORT_ID/pages` returns NDJSON. Follow the
  `X-Porthole-Next-Cursor` response header as the `cursor` parameter until empty.
- `POST /api/porthole/v1/exports/EXPORT_ID/cancel` accepts `{"confirm":"EXPORT_ID"}`.

Pages contain at most the selected 1–50 records and one MiB of payload data;
JSON framing is additional. Each line preserves the stable ID, source and batch
references, original ordinal, signal, team, service, environment, decimal
nanosecond timestamp, trace and span IDs, and the original normalized payload.
The payload retains the resource and instrumentation schemas, attributes,
metric kind and unit, sample flags, profile dictionary and delivery provenance.
No time or integer field is converted to floating point.

`--format=otlp-json` writes one independent OTLP JSON ExportRequest per line
inside an envelope with record identity and scope. Profiles use the ingested
OTLP v1development schema and keep their isolated dictionary per request.
Metric data points regain their original metric container. For non-OTLP source
protocols this mode returns `source_format_requires_ndjson` before releasing a
page; NDJSON preserves those original normalized formats. The current journey
proves OTLP roundtrip through the public intake parser, not independent OTLP or
profile-tool interoperability.

Convert a complete NDJSON download into standard Parquet parts:

```sh
python3 -m venv ./.cache/export-readers
./.cache/export-readers/bin/pip install -r ./scripts/porthole/export-requirements.txt
./.cache/export-readers/bin/python ./scripts/porthole/export-parquet.py ./signal-download ./signal-parquet
```

Conversion checks each input digest and record count, uses one bounded page per
part and atomically replaces a completed part. A destination is bound to the
exact input checkpoint; another download cannot leave mixed parts behind.
Parquet stores nanoseconds as exact `DECIMAL(20,0)`, ordinals as signed 64-bit
integers, identity and scope as UTF-8 strings, and `payload_json` as the original
structured JSON. A nullable `metric_unit` column makes metric units directly
queryable. The integration journey uses DuckDB, independently of the Arrow
writer, to reconcile every row and payload with the public Explore query door.

## Current qualification limits

PORT-061 remains PARTIAL. Independent OTLP and standard profile readers,
priced cost estimates, standard signal read APIs, and telemetry erasure journals
that fence old restored archives remain open. The existing actor anonymization
journal is not telemetry erasure. Exports explicitly disclose that they do not
establish erasure compliance. Export approvals are local authority and are
excluded from both product archives and native installation archives. PORT-035
inherits the telemetry-erasure obligation; PORT-026 inherits the same live
scope, quota and revocation checks before adding configuration doors.
