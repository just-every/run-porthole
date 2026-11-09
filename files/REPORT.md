# PORT-061 bounded standard-read qualification

Tag: sx-porthole-c-f464. Repository: just-every/run-porthole.
Branch: cloud/sx-porthole-c-f464. Candidate: c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f.
Current recorded CI: Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f. A pending or cancelled run is not green proof.

PORT-061 remains PARTIAL. Counts before and after are 10 DONE, 20 PARTIAL and 69 MISSING, across all 99 Status rows. No acceptance sentence, Status, Gap, Evidence, summary or generated contract view changed. The sole updated plan row is PORT-061's bounded standard-read qualification; the full plan and execution decisions are in PLAN.md. No other clause progress, scope release, policy default, provider qualification or landing is claimed.

## Result

Main already contained predecessor 4a86b252865d95d341e2a54d5b5b88e98c40bdd4 and its two bounded standard read doors. The task branch also already contained published bf9eba1ad9206f6267a720c0fce3358ead041a34 and 0714a69f24edacb85ac194622f121a6251328dbd. Those commits and their authors are preserved through a merge; their actual report and receipt remain under prior/. Their stock comparison covers nineteen expressions, complete samples, labels, timestamps and values, actual producer summaries, stock OTLP and official-schema summary and non-monotonic cumulative sum inputs against unmodified Prometheus 3.5.0. The stock remote-reader has only remote-read and a credential file configured. Both analytical stores run the stock Prometheus and Tempo 2.8.2 client comparisons. Batched wire probes retain all four matcher types, inclusive millisecond bounds, ordered empty results and SAMPLES negotiation.

This continuation closes a concrete inactive-restore proof gap in the existing journey. It now starts with a populated real stock trace, compares complete Tempo JSON and protobuf content after installation restore and restart, proves the source trace credential and owner cookie cannot authorize destination reads, mints new destination authority, checks that a restricted destination credential sees only its team's original spans, refuses a revoked destination credential even with an owner cookie, and verifies intake remains paused. Metric restore assertions remain intact. The documentation states that boundary explicitly.

Production API source is unchanged from main. There is no new read door, new credential class, export approval, destructive permission, retention behavior, outbound action, homepage copy or Base pin. There are no UI changes and no added, removed or weakened test registrations. Existing positive and refusal assertions remain.

## Checks and exact provenance

| Check | Actual result | Receipt |
| --- | --- | --- |
| Native stock standard reads and inactive restore | PASS, exit 0 | continuation/standard.json and continuation/standard.log |
| Exact-candidate stock standard reads on both analytical configurations | PASS, exit 0 | continuation/analytical-exact.json and continuation/analytical-exact.log |
| Exact-candidate typecheck | PASS, exit 0 | continuation/typecheck-exact.json |
| Exact-candidate first-party source and evidence check | PASS, exit 0 | continuation/first-party-exact.json |
| Exact-candidate public schema check | PASS, exit 0 | continuation/schema-exact.json |
| Final source lock generation and check | PASS, exit 0; PASS, exit 0 | continuation/source-lock-final.json and continuation/source-check-exact.json |
| Contract generator write and check for PORT-061 | PASS, exit 0; PASS, exit 0 | continuation/views-write.json and continuation/views-check.json; generated views restored from main |
| Migration ledger | Not applicable | No migration changed |
| Branch Verify | Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f | continuation/CANDIDATE-CI.json when discovered |

Receipts state their actual start and end heads and worktree state. The native command was queued at a save head before the final commit; its actual test execution uses stable final files. The final analytical command and mechanical checks start on the clean candidate. continuation/REVIEW.json records final input hashes, empty contract and generated-view diffs, unchanged production source, no new email-shaped values and zero registration delta. Earlier results are retained as historical evidence and do not substitute for the candidate's Verify.

The first local native probe overlapped a helper edit and failed with `TypeError: Cannot read properties of undefined (reading 'secret')` at the new archive helper: the old already-loaded caller did not pass the new argument. continuation/overlapped-probe.log retains the actual output. A fresh run is used instead; no speculative product fix was made. An initial product push was rejected as non-fast-forward because the named task branch already existed. The guard saved and verified the bundle recorded in RECEIPT.json, and the published commits were merged. The subsequent guarded save push succeeded without force pushing. No published history was rewritten.

MECHANICAL lock=pnpm run source:lock and pnpm run source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-061 and check PORT-061 exit=0, then restored from origin/main; ledger=none exit=0

## Acceptance and inherited-duty register

| Item | Public-door journey and lines | Outcome and Verify provenance |
| --- | --- | --- |
| Acceptance 1: authenticated four-signal multi-team export beyond one page, interrupted and resumed with counts, types and trace relationships | ./tests/porthole/archive.mjs signalExportJourney:343, preserved; ./tests/porthole/standard-reads.mjs standardReadJourney:210 and standardAnalyticalJourney:334 supplement the scoped live-read doors | Existing export proof retained; selected standard transports exercised locally. Candidate Verify: Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f |
| Acceptance 2: independent Parquet, OTLP and standard profile readers, Explore comparison, revoked scoped token stops reads | ./tests/porthole/archive.mjs signalExportJourney:422; standardReadJourney and standardAnalyticalJourney compare independent stock clients and generated OTLP readers with actual captured producer data | Existing export proof preserved; selected read proof has nonempty allowed and refused cases. Candidate Verify: Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f |
| Acceptance 3: older archive plus later erasure journal cannot re-export erased subjects | ./tests/porthole/archive.mjs subjectErasureJourney:562 and standardArchiveJourney:1320; ./tests/porthole/standard-reads.mjs standardSchemaProof and standardAnalyticalSchemaProof | PARTIAL. Homogeneous native erasure, record exclusions and existing journal read fences are exercised. Mixed subjects, RUM and complete external and derived custody remain unproved. |
| Prometheus exact retained remote-write samples and pinned OTLP mapping | stockMetrics:87, standardReadJourney:210, standardAnalyticalJourney:334, standardMappingProof | Actual scrape and stock OTLP source input and official-schema edges reach a real reference Prometheus. Nineteen expressions plus complete series and target information compare exact labels, timestamps and values. |
| Tempo exact currently authorized trace-by-ID with explicit partial evidence | standardReadJourney:238 onward; ./tests/porthole/archive.mjs standardArchiveJourney:1320 | Real stock HTTP, Kafka and database traces; official generated OTLP reader and pinned Tempo client. Full trace fields and both restored representations are checked; restricted spans stay absent. |
| Current credential scope, header-only authority, scan quota, next-request and mid-read revocation, expiry and narrowing | standardReadJourney, standardAnalyticalJourney and standardBudgetProof | Allowed source data is returned; unsafe requests return 401, 403, 409, 422 or 429 without accumulated sample or span release. Restored source credentials and owner-cookie substitution refuse. |
| Portable exclusions, erasure, replay, restart and inactive restore | standardSchemaProof, standardAnalyticalSchemaProof, subjectErasureJourney and standardArchiveJourney | Native erased capture replay refuses after restart. Unsupported analytical physical erasure refuses unchanged; an independently planted prior journal fences stale copies. Restore transfers data with new destination authority and preserves paused intake. |
| Omitted expression evaluation, search and metadata routes | standardReadJourney:217 | Explicit refusals remain. Porthole does not evaluate PromQL or support TraceQL, search, metadata, native histograms, exemplars or streamed chunks. |

## DONE-RIDERS

| Row | Result | Proof or boundary |
| --- | --- | --- |
| 1 | PARTIAL | Acceptance sentence 3's full custody and erasure outcomes and other held scope remain unproved. Selected standard-read outcomes have public transport journeys; no DONE claim. |
| 2 | PASS in touched scope | Nonempty independent producer captures are compared; restricted, revoked, expired, excluded and journaled reads refuse or omit the unsafe data. standardReadJourney, standardAnalyticalJourney and standardArchiveJourney:1320. |
| 3 | PENDING CI | Existing push source shard loads both standard journeys; the exports shard retains signalExportJourney and subjectErasureJourney. Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f. |
| 4 | Actual provenance recorded | Final analytical and mechanical checks bind the clean candidate; native queue provenance and final input hashes are stated above. Candidate Verify remains the exact-SHA wall. |
| 5 | INSPECTED | ./CONTRACT.md:225 names erasure exclusions, PORT-026 configuration access and PORT-034 inactive restore. Existing PORT-035 and PORT-096 duties remain named; no expanded erasure claim. |
| 6 | PASS mechanical | Contract generator write and check pass; generated views are restored and all judgment rows remain unchanged. |
| 7 | PASS | No acceptance wording, clause ID or coverage map changed. |
| 8 | PASS in touched scope | Existing telemetry.read only; positive and unsafe scope, authority, expiry, quota and restoration paths run through the public doors. No mutation permission is added. |
| 9 | PASS boundary honesty | No locked S3, RUM, funded infrastructure, provider pricing or complete analytical physical deletion qualification is claimed. |
| 10 | NOT APPLICABLE | No new policy default was adopted. Existing approved credential and export policies remain. |
| 11 | PENDING LANDER | Branch-only custody. Main equality, exact-SHA successful Verify, complete publication scan and Run site remain guarded lander duties. |

## Pre-ready review

1. Selected standard-read behaviors retain real positive and unsafe public-door journeys and independent stock reference comparisons. The full clause remains PARTIAL. Current candidate CI is stated without inferring success.
2. No existing assertion was removed, narrowed, skipped or hidden behind a width or branch condition. Test registrations are unchanged.
3. Existing authority, erasure and replay fences remain; new restore checks demonstrate current destination scope and next-request revocation, with no transferred source credentials or activation of intake.
4. No screen or control changed; browser sizing, typography and tooltip work is not applicable to this diff.
5. Lock freshness, contract generation, schema and first-party checks pass. Changed source and fixtures introduce no email-shaped value. Publication scan: commit=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f, complete=unestablished, historyScanned=unestablished, findings=unestablished. The cloud cannot establish the Mac scan; it is never described as zero findings. Main equality=false, candidate Run site=pending guarded landing.

GAP PORT-061: Full subject erasure and analytical physical deletion, mixed subjects, alternate representations, late arrivals, RUM, external and derived custody, locked customer S3 proof, complete native archive application and every derived-data fence remain under PORT-035 and PORT-096. Priced estimates beyond owner-supplied rates need the held account and versioned rate-card work. Standard log and profile interfaces retain the PORT-086, PORT-087 and PORT-015 prerequisites. Prometheus evaluation, metadata, exemplars, native histograms and streamed chunks remain omitted; no PORT-014 or PORT-099 progress is claimed.

CLAIM PORT-061 PARTIAL points=1,2 tests=tests/porthole/archive.mjs#signalExportJourney; tests/porthole/archive.mjs#standardArchiveJourney; tests/porthole/standard-reads.mjs#standardReadJourney; tests/porthole/standard-reads.mjs#standardAnalyticalJourney

## Recorded per-point probes

PROBE PORT-061 1: unmodified stock Prometheus using only remote-read and a credential file over actual remote-write and OTLP intake -> nineteen exact expression comparisons, 223 series and 1,117 samples; native, primary and standby agree with the real reference.
PROBE PORT-061 2: pinned Tempo client and official generated OTLP readers over stock HTTP, Kafka and database traces -> three real trace IDs and eight selected trace spans agree with captured stock exports. Inactive native restore -> exact JSON and protobuf across restart; restricted destination spans only, source and revoked credentials refused, intake still paused.
PROBE PORT-061 3: native subject erasure, restart and replay through standard reads -> empty metric result, 404 trace and 409 replay. Unsupported analytical erasure -> unchanged custody with 409; prior-journal stale copies -> 409 without release on both stores. This is the supported subset; full erasure remains unproved.

Both final runtime journeys passed, exit 0. continuation/PROBES.txt preserves the actual emitted probe lines and series counts. No new code or test edit followed these passes.

## Terminal custody and CI

Product push succeeded on the named branch at c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f. Final bounded CI observation: Verify 42544257646, in_progress, conclusion=None, head=c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f. Ten workflow API calls are recorded across the preserved prior publication and this continuation; the two candidate observations are at least 300 seconds apart. The observed run is not successful green proof. The API budget is exhausted, so the terminal product state is PUSHED. No duplicate workflow dispatch or rerun was requested; the fleet must establish successful exact-SHA Verify before landing.
