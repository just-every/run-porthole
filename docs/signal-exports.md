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
unless the owner supplies an explicit cost model. There is no silent total row limit.

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

## Cost preview

A preview may include `costModel` alongside its selection. Every field is
required: `source` names the owner's rate card; `fixedUsdMicros`,
`usdMicrosPerMillionRecords` and `usdMicrosPerGiBPayload` are nonnegative integer
microdollars, each at most one trillion. For example, this synthetic model has
a fixed cost of one dollar, two dollars per million selected records and one
dollar per GiB of selected payload:

```json
{"source":"Owner approved synthetic rate card","fixedUsdMicros":1000000,"usdMicrosPerMillionRecords":2000000,"usdMicrosPerGiBPayload":1000000}
```

The preview adds the fixed amount to each usage component rounded up to the
next microdollar. It returns exact decimal strings in `estimate.usd` and
`estimate.usdMicros`, together with the supplied model. Approval preserves that
exact preview and its rate source; downloading does not update or authorize
spending against it. Without a model both amounts remain null, never an assumed
zero. An explicit zero rate is accepted only when the owner supplied it.

This projection uses selected records and raw payload bytes. The owner must
include provider scans, format framing, retries and other infrastructure costs
in the supplied fixed and usage rates. It is an estimate, not a provider quote.
Later exclusions may reduce the delivered count; the original preview remains
visible for comparison.

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
page; NDJSON preserves those original normalized formats. The integration journey reads all four signal files with the official generated
OTLP protobuf schemas, including the standard profile dictionary and samples,
and independently reads the binary serialization. It also proves roundtrip
through the public intake parser. OTLP hexadecimal identifiers are adapted to
the protobuf JSON reader’s base64 convention without changing their bytes.

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

## Portable exclusions

An unrestricted native owner can apply an exact portable exclusion journal after
fresh five-minute proof. This is append-only suppression by stable record ID;
it never grants a credential erasure authority or deletes retained telemetry.
The owner explicitly confirms each batch. No subject values or connector secrets
belong in a journal.

`POST /api/porthole/v1/export-exclusions` accepts this exact shape, with up to
50 records in one batch:

```json
{"confirm":"apply-exclusions","journal":{"format":"porthole.export-exclusions.v1","records":[{"recordId":"00000000-0000-4000-8000-000000000001:0","excludedAt":1792800000000}]}}
```

`GET /api/porthole/v1/export-exclusions` returns the format, up to 50 records
and a `next` record ID. Follow `?after=RECORD_ID` until `next` is null. To move a
journal, apply each page’s format and records with explicit confirmation at the
destination. A replay cannot remove an exclusion or move its timestamp backward.
Apply the latest cumulative journal before authorizing exports from restored
history. A new product archive carries its journal; an archive that predates the
journal remains readable and cannot replace later destination exclusions.

Every signal page checks current exclusions inside its read transaction, even
for an export approved before the journal arrived. Preview counts describe the
preview time; later exclusions can reduce the downloaded count. Already downloaded
files remain in owner custody and cannot be recalled. Conversion of such a file
does not consult a running installation. Subject discovery, approved retention,
actual data deletion, legal holds, provider custody and fences on every query or
other derived artifact remain PORT-035 obligations. This interface is not a
complete subject-erasure implementation.

## Current qualification limits

PORT-061 remains PARTIAL. Standard signal read APIs, automatic subject-to-record
exclusion coverage and full erasure qualification remain open. The cost model
projects owner-supplied rates; live provider tariffs and complete infrastructure
cost qualification remain unproved. Independent OTLP and standard profile readers and portable
record exclusions across old product archives are covered by the focused journey. The existing actor anonymization
journal is not telemetry erasure. Exports explicitly disclose the distinction between record suppression and
actual telemetry erasure. Export approvals are local authority and are
excluded from both product archives and native installation archives. PORT-035
inherits the telemetry-erasure obligation; PORT-026 inherits the same live
scope, quota and revocation checks before adding configuration doors.
