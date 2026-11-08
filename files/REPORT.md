# sx-porthole-c-f458 — PORT-061 bounded standard reads

Product repository: https://github.com/just-every/run-porthole

Product branch: `cloud/sx-porthole-c-f458`

Candidate: `54efdb6297754c4f723cd0ff15390fd5fc6ab03e`

PORT-061 remains **PARTIAL**. The bounded Prometheus and Tempo read slice is implemented and locally proved. No Status, Gap, Evidence, acceptance sentence or generated contract view was committed. Contract counts remain 10 DONE, 20 PARTIAL and 69 MISSING, with all 99 rows retained. No other campaign row changed.

## Plan and implementation

1. Read the complete clause, its live Gap, existing export and authority journeys, the supplied plan extract, rulings and DONE riders. Existing signal exports already proved acceptance points 1 and 2 and part of point 3; standard reads and broader erasure remained open.
2. Add only two bounded standard doors over the existing scoped reader: Prometheus remote-read v1 at `/api/v1/read`, and Tempo HTTP trace-by-ID v1 at `/api/traces/{traceID}`. Document their pins, mappings, limits, refusals and authorization in `./docs/standard-signal-apis.md`, programmatic access and the generated public OpenAPI artifact.
3. Prove stock-client interoperability and live authority through actual intake, retained storage and both independent analytical Workers. Extend the existing stock ingest, trace, credential, signal export and erasure journeys. Restore an owner installation archive into an inactive independent destination and require new destination credentials.
4. Run touched journeys and typecheck, check the public schema and first-party source, generate and check contract views for inspection, restore those views from main, and regenerate the source lock last. Merge fresh main without rewriting published saves.
5. Push the named product branch, inspect exact-head Verify, then publish this separate report packet on the evidence ref. Landing and the publication scan remain with the Mac lander.

### Delivered behavior

- Existing `telemetry.read` credentials in Authorization are the only authentication for both doors. Cookies cannot substitute for credentials. Service, environment, team, signal, expiry, custody and quota checks remain live.
- Remote-read negotiates SAMPLES, decodes raw Snappy and protobuf, applies equality and RE2 label matchers with inclusive millisecond bounds, and preserves query order. Porthole does no PromQL evaluation.
- Remote-write label sets, timestamps and float bits round-trip, including negative zero, infinity and stale NaN. Older retained records recover their bits from original wire within a separate bounded recovery budget.
- OTLP gauges, cumulative sums, explicit-bucket histograms and summaries use the documented OpenTelemetry v1.45.0 compatibility profile and Prometheus 3.5.0 receiver conventions. Compound units and ratios are covered. Unsupported temporality, exponential histograms and other declared mapping gaps explicitly refuse. The documented profile also refuses negative histogram or summary sums; this is not universal Prometheus compatibility.
- Tempo 2.8.2 v1 JSON and protobuf shapes preserve permitted spans, resources, instrumentation scopes, flags, links, events and nanoseconds. Every successful response explicitly declares partial trace evidence. Existing mandatory intake privacy remains in force; parameterized database statements retain their approved normalized representation rather than recovering raw source SQL.
- Reads refuse exceeded budgets instead of releasing a silently truncated sample set. Limits are 2,000 scanned records, one MiB of scanned JSON, eight remote-read queries and 20,000 response samples.
- Final result release checks current credential identity and scope, selected analytical connection, retained payload identity, erasure journals and portable exclusions. No detached telemetry cache or new export approval exists.
- Prometheus evaluation and metadata routes, Tempo search and unsupported standard routes explicitly refuse. Standard log and profile reads, native histograms, exemplars and streamed chunks remain outside this slice.

## Actual local proof

All named journeys completed successfully. `./local-tests.json` and the complete passing logs record the results. The relevant source and tests match the final candidate tree; final mechanical checks ran on the full candidate SHA.

The standard-read runs observed **214 series and 1,092 samples**, three distinct healthy, failed and slow trace IDs, and eight spans in the selected trace. Twelve fixed expressions were evaluated by an unmodified Prometheus configured with only remote_read and a private credential file. A reference Prometheus received identical real producer samples through scrape and its own OTLP receiver. Series membership, labels, timestamps and values matched, including rates, increases, cumulative histogram families, unit suffixes and ratios.

The stock Tempo CLI fetched the actual trace through a local credential-adding relay; the relay did not alter trace bodies. Its decoded OTLP JSON and the binary response were read with the official generated OTLP reader. All permitted span fields, resources and scopes matched captured stock exporter data. The only expected source transformation is the existing mandatory database-statement privacy normalization. Actual HTTP and Kafka operations came from `./tests/porthole/polyglot/estate.mjs`.

### Acceptance sentences and inherited duties

| Item | Outcome and public-door proof | Result |
| --- | --- | --- |
| PORT-061 point 1: export a multi-team range beyond one page, interrupt and resume, reconcile all four signals | `./tests/porthole/archive.mjs:343` signalExportJourney; native preview and exact approval, spawned CLI, 18 records across pages, counts, types, trace context, nanoseconds and snapshot reconciliation | PASS locally; existing complete point reconfirmed |
| PORT-061 point 2: independent Parquet, OTLP and profile reads, Explore comparison and revoked scoped reads | Same signalExportJourney; DuckDB, official generated OTLP readers, actual format roundtrip, native Explore, revocation and cancellation. Added standard metric read before exclusion and absence afterward | PASS locally; existing complete point reconfirmed |
| PORT-061 point 3: older archives and later erasure journals cannot re-export erased subjects | `./tests/porthole/archive.mjs:562` subjectErasureJourney proves homogeneous local envelopes and later-journal restore fencing; both standard metric and trace reads remain absent after restore. SignalExportJourney proves portable record exclusions | PARTIAL for the full sentence; broader inherited erasure remains held |
| Standard metric read behavior | `./tests/porthole/standard-reads.mjs:163` standardReadJourney; actual stock Prometheus, stock OTel instruments and real intake; twelve source-reference expressions, multiple pages and original samples | PASS locally |
| Supported mapping, exact float bits and bounded refusal | `./tests/porthole/standard-reads.mjs:324` standardSchemaProof; official-schema public intake, gauge and sum values, buckets and summary quantiles, stale bits including legacy recovery, explicit unsupported-type errors and 2,001-record refusal | PASS locally |
| Standard trace retrieval and partial evidence | standardReadJourney plus `./tests/porthole/traces.mjs:12` traceJourney; actual HTTP, gRPC and Kafka operations, official readers, stock Tempo client, restricted spans and current authority | PASS locally |
| Current authority and scan quota | `./tests/porthole/standard-reads.mjs:260` standardAnalyticalJourney; real primary and standby, quota 429, mid-read revoke and expiry 401, narrowing and custody change 409, portable exclusions, unavailable storage 503; trace revocation releases no spans | PASS locally |
| Private audit and read-only delegated authority | `./tests/porthole/credentials.mjs:155` credentialQueryJourney and the existing audited read seam; read-only REST, CLI and MCP, write-only and revoked standard credentials refused | PASS locally |
| Restart, inactive restore and no transferred authority | standardReadJourney and standardArchiveJourney; byte-equivalent standard samples across restart and independent restore, intake remains paused, source credentials absent, newly minted destination authority required | PASS locally |
| Existing stock intake continuity | `./tests/porthole/stock-ingest.mjs:118` stockIngestJourney with official Alloy v1.10.2; durable paused acknowledgement, restart, wire retry, seven reconciled records and a stock remote-write sample read through the new standard door | PASS locally |

### DONE riders

| Rider | Assessment on this candidate |
| --- | --- |
| 1 | PARTIAL for the complete clause: points 1 and 2 and the bounded standard-read outcomes are exercised; full subject-erasure qualification remains held. |
| 2 | PASS for this slice: actual seeded stock data, supported reads complete, unsafe and revoked reads release no data, exclusions and erasure are checked through public doors. |
| 3 | FAIL: exact-SHA Verify 42519315359 failed source job 128849149694. All other shards passed. The new journeys are invoked by the existing source shard; the local successful runs do not establish this rider while Verify is red. |
| 4 | PASS: relevant local proof uses the candidate's source and tests, and no relevant code changed afterward. Final mechanical receipt names the full candidate SHA. |
| 5 | INSPECTED: receiving clause and inherited erasure and transport duties remain unchanged; no new Base-duty completion claim is made. |
| 6 | PASS mechanically: contract write and check succeeded; generated views were restored from main and not committed. Source lock and public schema checks passed. Status judgments remain the lander's responsibility. |
| 7 | PASS: no acceptance point, Status row or coverage obligation changed. |
| 8 | PASS for existing read authority: dangerous authority paths are exercised in both directions, including mid-read revocation, narrowing, expiry, quota, bearer precedence and inactive restore. |
| 9 | Full provider and erasure boundaries remain explicitly unproved; no provider deletion, retention, tariff or compliance qualification is claimed. |
| 10 | Not applicable: no new custody, consent, spending or authority default was adopted. |
| 11 | PENDING Mac landing: this cloud pushed only its named branch. Main equality, complete publication scan with zero findings and resulting Run site remain guarded lander duties. |

## Mechanical and pre-handoff checks

`./mechanical.json` records exit 0 for source lock freshness, contract views, public schema, typecheck and first-party source checks on `54efdb6297754c4f723cd0ff15390fd5fc6ab03e`. Contract regeneration used `node scripts/porthole/contract-docs.mjs write PORT-061` and its check, followed by restoration of ACCEPTANCE.md and docs/CLAIMS.md. The workflow's existing PORT-075 contract check also passed. No migration was added or edited, so no migration-ledger action applies.

No existing user-visible assertion was removed, weakened or put behind a new width condition. No homepage, logo or product screen changed. Existing affected trace and export screens were exercised at 1440 and 390; `./trace-1440.png` and `./trace-390.png` are actual browser captures using system Chromium. The branch preserves current authority, erasure and replay fences. New fixture lines introduce no email-shaped values or provider-shaped secrets.

Full-history publication scanning is not run in this cloud, per the cloud adaptation. It is not represented as complete or green. The Mac lander must scan the exact candidate, require exact-head Verify, land it, then require Run site where applicable. No product landing or new DONE count is claimed by this report.

## Remaining scope and custody

Full subject-erasure coverage remains with PORT-035 and PORT-096: mixed subjects, alternate representations, late arrivals, RUM, external and derived custody and complete native archive application remain unproved beyond the exact local cases exercised here. The brief names the unprovided customer S3 object-lock account and RUM prerequisite. Priced provider tariffs and complete infrastructure qualification remain with the funded account and PORT-023 rate-card work. Standard log reads remain held under the PORT-086 floor and PORT-087 feeder hold; standard profile reads await PORT-015. Existing PromQL and search holds are unchanged. No PORT-014 or PORT-099 progress is claimed.

The plan return is PORT-061 PARTIAL to PARTIAL, bounded standard reads completed; counts unchanged. No other plan row was rewritten. Product and report custody are separate. This packet contains only actual non-secret reports, receipts, passing logs and selected browser captures; it contains no credential file, environment dump, held-out gate material or symlink.

CLAIM PORT-061 PARTIAL points=1,2 tests=tests/porthole/archive.mjs#signalExportJourney; tests/porthole/standard-reads.mjs#standardReadJourney; tests/porthole/standard-reads.mjs#standardSchemaProof; tests/porthole/standard-reads.mjs#standardAnalyticalJourney; tests/porthole/archive.mjs#subjectErasureJourney
GAP PORT-061: Full inherited subject-erasure, external custody and RUM qualification, provider-priced cost qualification, and the held standard log and profile read prerequisites remain open; this round supplies the bounded Prometheus and Tempo doors only.

MECHANICAL lock=pnpm run source:lock and pnpm run source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-061 and check PORT-061, then restore generated views exit=0; ledger=none exit=0.

CI observation: exact-head push Verify 42519315359 completed with failure. Source job 128849149694 failed standardReadJourney at `./tests/porthole/standard-reads.mjs:178`, through remoteSeries: expected HTTP 200, observed HTTP 422 with `standard_read_budget_exceeded`. Every other shard succeeded. The complete failed-job log is `./verify-source-failed.log`. The original successful local runs do not override the red Verify. No CI rerun or repair commit was issued. Seven GitHub calls were used, including the one failed-job archive read.

A recovery bundle was created outside the product checkout and verified: `/home/agent/rer-consolidation/work/sx-porthole-c-f458/product.bundle`, SHA-256 `21b228f56afbd0280d2d1c3cf0d95fe30d81afaa9109044b70709bfc1b68592e`. This is preservation data, not a landing or READY receipt.

## Terminal Verify handoff

BLOCKED: exact-SHA Verify run 42519315359, source job 128849149694, is red and its assertion did not reproduce. On unchanged commit `54efdb6297754c4f723cd0ff15390fd5fc6ab03e`, the exact command `node scripts/verify-ci.mjs source` ran with Node 22.20.0 and CI=true, WRANGLER_SEND_METRICS=false, PLAYWRIGHT_SKIP_BROWSER_GC=1, SHARD=source. It completed with exit 0, including both native and analytical standard-read journeys. The full output is `./verify-source-reproduction.log` and the receipt is `./verify-reproduction.json`. No source was edited after the failed Verify, no repair round was attempted, and no workflow was dispatched or rerun.

This follows the supplied Verify-repair instruction: “If it does not reproduce, stop BLOCKED with that output; do not guess a fix.” The failure is not claimed to be a proven infrastructure flake. The new standard journey does not exist on main, so running main cannot reproduce that same assertion. Diagnosis is handed to fv. No READY or landing claim is made.

PROBE PORT-061 1: owner-approved multi-page signal export and independent reads -> exact retained four-signal content, counts and snapshot reconciliation.
PROBE PORT-061 2: real producer intake, stock Prometheus remote_read and Tempo trace retrieval -> exact permitted samples and captured stock spans; revoked standard credentials refuse.
PROBE PORT-061 3: exclusion, native subject erasure, older archive plus later erasure journal -> excluded and erased samples and spans remain absent; broader erasure prerequisites remain held.

POST lanes/sx/INBOX.md: sx-porthole-c-f458 PORT-061 PARTIAL to PARTIAL, points 1 and 2 reconfirmed, bounded standard readers implemented; counts remain 10 DONE, 20 PARTIAL, 69 MISSING. Branch cloud/sx-porthole-c-f458 head 54efdb6297754c4f723cd0ff15390fd5fc6ab03e; Verify 42519315359 failed source job 128849149694; exact unchanged source shard reproduction passed, exit 0; BLOCKED per Verify-repair rule.
POST lanes/fv/INBOX.md: sx-porthole-c-f458 just-every/run-porthole head=54efdb6297754c4f723cd0ff15390fd5fc6ab03e Verify run=42519315359 job=128849149694: standardReadJourney at line 178 observed 422 standard_read_budget_exceeded instead of 200. Exact node scripts/verify-ci.mjs source on unchanged SHA with Node 22.20.0 and CI environment completed exit 0. No speculative repair or rerun; diagnosis required.
