# PORT-061 standard-read qualification

Tag: sx-porthole-c-f464. Repository: just-every/run-porthole. Branch: cloud/sx-porthole-c-f464.
Candidate: 0714a69f24edacb85ac194622f121a6251328dbd. Verify: Verify 42541236693 (push; completed, cancelled; exact candidate SHA).

PORT-061 remains PARTIAL. Counts before and after are 10 DONE, 20 PARTIAL and 69 MISSING, across all 99 Status rows. No clause text, Status, Gap or Evidence cell changed. No plan was rebuilt; the changed plan row is PORT-061's bounded standard-read qualification. All other plan rows and holds remain unchanged.

Main already contained predecessor 4a86b252865d95d341e2a54d5b5b88e98c40bdd4, with its standard interfaces and security fences. There was no unpublished predecessor delta to replay. This round completes additional interoperability proof rather than claiming to introduce those existing interfaces.

The existing standard-read journeys now compare nineteen fixed expressions and the complete original series, labels, timestamps and values with unmodified Prometheus 3.5.0. Its reader uses only remote-read and a credential file. The reference receives actual producer scrapes and identical stock OTLP exports. Actual producer summaries now exercise remote-write continuity; official-schema summary and cumulative non-monotonic sum packets also reach the real reference receiver. Their quantiles, sums, counts, compound attributes, namespace and instance labels are compared independently of Porthole's mapping code.

The full stock Prometheus comparison and pinned Tempo 2.8.2 client now run after selecting both primary and standby analytical stores. The official generated OTLP reader compares actual captured exporter fields after mandatory intake privacy. A batched wire probe additionally checks ordered empty and nonempty results, inclusive millisecond bounds, all four label matcher types and SAMPLES negotiation when streamed chunks are also listed.

No test registration was added or removed. Existing twelve expression comparisons remain, with seven added. Existing positive and refusal assertions remain. The two existing standard journeys carry the additional cases; no per-point unit tests or test cap increase were introduced. There are no UI changes.

## Actual results and provenance

The initial unchanged-main native journey passed: 214 metric series, 1,092 metric samples, three source trace IDs and eight selected trace spans, including native erasure, replay and inactive archive restore. Main had successful exact-SHA push Verify runs 42538273578 and 42531988910, and Run site 42538273580. MAIN-CI.json records the discovery.

The initial extended analytical journey passed with 223 metric series, 1,117 samples, three source trace IDs and eight selected trace spans. It proves stock-client comparisons on both analytical stores and the live scope, quota, revocation, expiry, portable exclusion and prior-journal fences. analytical.json and analytical.log preserve that run. The final standard and analytical receipts additionally cover the batched query probe and identity-encoding transport correction; see standard.json and analytical-final.json. Local receipt heads and changed working-tree files are stated honestly; the final candidate differs from those inputs only as recorded in RECEIPT.json, and its exact-SHA Verify is configured to execute both journeys. The observed run was cancelled and is not green proof.

The first extended native attempt exposed a fixture relay error: Node fetch decompressed the response while its gzip header was forwarded to another fetch. The exact observed error was `TypeError: terminated`, caused by `incorrect header check` and `Z_DATA_ERROR`. relay-before-fix.log retains it. The relay now asks for identity encoding. This was a test transport repair, without a product protocol or permission change. No failing CI assertion was repaired, and no workflow rerun was requested.

Typecheck and the first-party check passed. The contract adapter's write and check pass for PORT-061; generated views are restored from main and uncommitted. The source lock is generated after final edits and checked. There are no migration changes.

MECHANICAL lock=pnpm run source:lock and pnpm run source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-061 and check PORT-061 exit=0; ledger=none exit=0

## Acceptance and selected obligation register

| Item | Public door and proof | Result |
| --- | --- | --- |
| Acceptance 1: multi-team, four-signal export, interruption, resumption and counts, types and trace relationships | Existing ./tests/porthole/archive.mjs signalExportJourney at line 343, authenticated export API and spawned CLI. Loaded by the candidate's exports shard in push Verify. This round preserves that journey and supplements independent live reads. | Existing proof retained; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Acceptance 2: independent Parquet, OTLP and standard profile readers; Explore comparison; token revocation stops reads | Existing ./tests/porthole/archive.mjs signalExportJourney at lines 422 to 558, independent DuckDB and generated OTLP readers; ./tests/porthole/standard-reads.mjs standardReadJourney and standardAnalyticalJourney add stock clients and current credential fences. | Existing export proof retained; standard-read proof passed locally; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Acceptance 3: old archives plus later erasure journals cannot re-export erased subjects | ./tests/porthole/archive.mjs subjectErasureJourney at line 562 and standardArchiveJourney at line 1320; standardSchemaProof and standardAnalyticalSchemaProof execute erased-subject and journal fences, replay refusal and unsupported analytical erasure refusal without mutation. | PARTIAL: homogeneous native envelopes and record suppression are proved; complete mixed-subject, RUM, external and derived custody qualification remains held. |
| Prometheus retained sample and OTLP mapping parity | ./tests/porthole/standard-reads.mjs stockMetrics, standardReadJourney and standardAnalyticalJourney: actual producer scrape, remote-write, stock OTLP intake, real reference receiver, nineteen expressions, complete ranges and target information. | Passed locally on native, primary and standby; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Tempo trace-by-ID and exact authorized spans | Same journeys: real HTTP, Kafka and database estate, captured stock packets, official generated OTLP reader, pinned Tempo client on both analytical stores, restricted spans and explicit partial evidence. | Passed locally; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Credential, quota, budget and unsupported-route refusals | Same journeys and standardBudgetProof: header-only authority, bearer precedence, scope narrowing, expiry, revocation during real reads, daily scan quota, row and byte limits, unsupported mapping and explicit query, search and metadata refusals. | Passed locally, no partial data released; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Batched sample responses | standardMappingProof: public remote-read requests on actual retained schema inputs with multiple ordered queries, an empty middle result, boundary timestamps and positive and negative matchers. | Final local receipts; Verify 42541236693 (push; completed, cancelled; exact candidate SHA) |
| Portable exclusion, erasure and restart fences | standardSchemaProof and standardAnalyticalSchemaProof: actual native subject erasure; analytical erasure refuses unchanged; independently planted prior journal fences stale copies on both stores and after restart; replay refuses. standardArchiveJourney uses actual inactive restore with newly minted destination credentials. | Passed within the stated boundaries; broader physical deletion remains unproved. |

## DONE-RIDERS

| Row | Result | Evidence or limit |
| --- | --- | --- |
| 1 | PARTIAL | Acceptance sentences 1 and 2 retain their public export journeys, and selected standard reads now have stock-client proof. Sentence 3's broader held custody and erasure outcomes remain unproved. No DONE claim. |
| 2 | PASS for touched scope | ./tests/porthole/standard-reads.mjs standardReadJourney:210 and standardAnalyticalJourney:334. Nonempty independently captured producer data is reconciled exactly; restricted, revoked, expired, excluded and journaled data is refused or absent; budget refusals release no sample or span payload. |
| 3 | PENDING: Verify 42541236693 (push; completed, cancelled; exact candidate SHA) | Both standard journeys are loaded by the existing source shard in push Verify. Export and subject-erasure journeys remain in the exports shard. No env-only proof was introduced outside its existing Verify entry point. |
| 4 | PASS for relevant bytes, subject to recorded CI | ./tests/porthole/standard-reads.mjs, exact candidate Verify 42541236693 (push; completed, cancelled; exact candidate SHA). Local receipts bind tested input hashes where available. The candidate's exact-SHA Verify is configured to rerun the committed journeys; its cancelled conclusion is not green proof. RECEIPT.json records input equality. |
| 5 | INSPECTED | ./CONTRACT.md:225 and ./docs/standard-signal-apis.md:1. PORT-061 names erasure exclusions and cites configuration access under PORT-026 and inactive restore under PORT-034. Existing PORT-035 and PORT-096 custody responsibilities remain named in documentation and the report, without a new authority claim. |
| 6 | PASS mechanical; judgments preserved | Contract write and check pass; main's generated views and all 99 Status rows remain unchanged. This builder does not update judgment cells or generated summaries. |
| 7 | PASS | No acceptance sentence, clause ID or coverage map changed. |
| 8 | PASS for touched scope | ./tests/porthole/standard-reads.mjs standardAnalyticalJourney:334 and standardBudgetProof:575. Existing read credentials only. Both successful and refused scope, revocation, expiry and quota paths execute through public standard doors; no mutation permission is added. |
| 9 | PASS boundary honesty | ./docs/signal-exports.md:158 and this report. No RUM, locked S3, funded infrastructure, provider cost, complete analytical physical deletion, standard log or standard profile qualification is claimed. |
| 10 | NOT APPLICABLE | No new custody, consent, spending, retention or authority default was adopted. Existing approved export and credential policy remains. |
| 11 | PENDING LANDER | This cloud pushes only its named branch. Main equality, complete full-history publication scan and candidate Run site are guarded lander duties; no landing is claimed. |

## Pre-ready review

1. Selected standard-read behaviors have actual positive and refusal journeys, independent stock reference data and configured exact-SHA Verify coverage. The observed candidate run was cancelled, so completed green CI remains a lander gate. The complete clause remains PARTIAL for the explicitly held remainder.
2. No existing user-visible assertion was removed, skipped, narrowed or hidden behind a width or branch condition. The existing twelve expression assertions remain within the expanded comparison.
3. Revoked and narrowed credentials release no accumulated data; native erased subject captures cannot resurrect after restart; stale analytical copies under an existing journal refuse. Unsupported analytical erasure remains a refusal and changes no custody.
4. No screens or controls changed; browser sizing and tooltip duties are not applicable to this diff.
5. Source lock and contract generation are checked. New changed text contains no email-shaped string. The cloud does not run the Mac publication scanner. Publication scan: commit=0714a69f24edacb85ac194622f121a6251328dbd, complete=unestablished, historyScanned=unestablished, findings=unestablished. Main equality=false intentionally; candidate Run site=pending guarded landing. No zero-finding or landing claim is inferred from a branch push.

## Remaining boundaries

GAP PORT-061: Full subject erasure and analytical physical deletion, mixed subjects, alternate representations, late arrivals, RUM, external and derived custody, locked customer S3 object proof, complete native archive application and every derived-data fence remain under PORT-035 and PORT-096. Priced estimates beyond owner-supplied rates and complete infrastructure cost qualification need the held account and rate-card work. Standard log and profile APIs retain their PORT-086, PORT-087 and PORT-015 prerequisites. Prometheus query and range-query evaluation, metadata, exemplars, native histograms and streamed chunks remain explicitly omitted; no PORT-014 or PORT-099 progress is claimed.

No new default, outbound action, deletion authority, export approval class, credential class, homepage claim or Base pin was introduced. The complete plan is in PLAN.md. Product and evidence publication are separate; evidence is transferred only on the evidence ref.


## Recorded public-door probes

PROBE PORT-061 1: stock Prometheus configured only with remote-read over real scrape, remote-write and OTLP intake -> nineteen exact reference expression results, 223 retained series and 1,117 samples; both analytical configurations match.
PROBE PORT-061 2: pinned Tempo client and generated OTLP readers fetch actual estate trace IDs -> every permitted field agrees with captured stock exports; eight spans in the selected trace, three independent source trace IDs, restricted spans absent and explicit partial evidence.
PROBE PORT-061 3: native subject erasure followed by standard metric and trace reads, restart and capture replay -> empty metric result, 404 trace and 409 replay. Analytical physical erasure -> 409 with unchanged data; an existing erasure journal -> 409 without stale copy release on both stores. Full subject-erasure qualification remains PARTIAL.


## Terminal CI and handoff

Exact candidate push Verify 42541236693 completed with conclusion `cancelled`, observed at 2026-11-09T00:53:21.986441Z. This is not a successful Verify receipt. The cancellation cause and individual job outcomes were not established by the run-status response. No duplicate dispatch, rerun or speculative code repair was requested. Six GitHub calls were used, with the candidate watcher spacing observations at least 300 seconds apart.

The brief's cloud READY rule explicitly permits handoff when a run is cancelled after local gates pass. READY identifies the pushed candidate only: the Mac lander must still obtain successful exact-SHA Verify and complete the full-history publication scan before landing, then establish Run site success on landed main. No main push or landing occurred here.

CLAIM PORT-061 PARTIAL points=1,2 tests=tests/porthole/archive.mjs#signalExportJourney; tests/porthole/standard-reads.mjs#standardReadJourney; tests/porthole/standard-reads.mjs#standardAnalyticalJourney
