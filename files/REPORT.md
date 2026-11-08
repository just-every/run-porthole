# sx-porthole-c-f463

Repository: just-every/run-porthole. Branch: cloud/sx-porthole-c-f463.
Continuation base: ff590be64b7cac3eaf2128c9833c641072cd8fb5.

## Plan

1. Read the target clause, current Status, inline plan and ct rulings. Preserve all Status cells and generated views.
2. Map the inherited standard read implementation and passing journeys to the requested points. Run the actual pinned stock Prometheus and Tempo clients, official generated OTLP readers and both analytical configurations.
3. Close unproved bounded read outcomes through the existing public HTTP doors: current authority, quota refusal, portable exclusions, erasure, restart and inactive restore. Preserve query evaluation and provider holds.
4. Generate and check contract views, restore main's view files, regenerate the source lock last, and run touched journeys, typecheck and first-party checks.
5. Integrate current main without rewriting published history, inspect all candidate identities and trailers, push only the named product branch through the fleet guard, discover exact-SHA Verify, and publish actual reports and receipts on the separate evidence ref.

## Initial acceptance map

PORT-061 remains PARTIAL. Acceptance point 1 is the approved four-signal paginated export journey; point 2 includes independent readers and revocation; point 3's complete subject-erasure outcome is held. The inherited signalExportJourney proves points 1 and 2 and record exclusions. The requested standard read slice supplements them; it does not complete full inherited erasure or cost qualification.

The continuation base already implements standard remote-read and Tempo retrieval, stock reference parity, official binary and JSON readers, native authority and custody fences, quota and budget refusal, restart and inactive restore. Verification of that exact implementation is in progress.

## Boundaries

No new credential class, export approval, deletion, expiry, provider call or query evaluation is authorized. Full erasure qualification still requires the locked S3 and RUM prerequisites named by PORT-035 and PORT-096. Funded provider rates, standard log and profile reads, search and PromQL evaluation remain held. No DONE claim or count change is justified by this bounded slice.

## Changes made in this continuation

The standard read implementation was already present at the requested continuation base. This round corrected remaining compatibility and metering gaps and expanded the existing sanity journey, without adding test registrations.

- Match the pinned receiver's label normalization: preserve repeated underscores, apply the `key_` prefix to digit-leading labels and the `key` prefix to a single leading underscore, and deterministically merge colliding normalized keys.
- Match metric-name token and unit suffix handling, including counters whose source name contains `total`, unit tokens already present in the name, the uppercase kilobyte unit, per-unit names and gauge-only ratio suffixes.
- Use fixed decimal bucket and quantile labels, so small bounds retain the same series identity as the reference Prometheus.
- Charge the original envelope bytes when legacy remote-write samples recover exact float bits. A request whose payload scan fits but whose original-wire recovery exceeds its remaining quota refuses with 429 and releases no samples.
- Compare all captured scrape and OTLP series, complete labels, original sample timestamps and values with the stock reference; compare `target_info` separately. Finish the stock provider's final shutdown collection before freezing the reference instant.
- Exercise trace quota refusal, next-request narrowing, revocation, expiry, mid-read narrowing and expiry, and both record and byte budget exhaustion. Run official-schema mappings, unsupported types, native erasure and replay fences, compare supported mappings on both analytical configurations, preserve the existing analytical deletion refusal, and check prior-journal read fences against stale peer copies. The prior-journal fixture establishes read refusal only; it does not qualify analytical deletion.

The final diff is limited to `./src/porthole/signals/standard/prometheus.ts`, `./src/porthole/signals/standard/read.ts`, `./tests/porthole/standard-reads.mjs`, `./docs/standard-signal-apis.md` and the generated source lock. No homepage, UI, workflow, credential class, export approval, erasure authority, retention policy or contract acceptance text changed. No existing assertion was removed, skipped or placed behind a new width or execution flag. Existing fixtures were expanded to exercise real compatibility cases; the complete-capture comparison strengthened the earlier gauge-only comparison.

## Acceptance sentences

- Point 1: existing `./tests/porthole/archive.mjs` signalExportJourney covers the approved multi-team, four-signal, paginated export with interruption, resume and reconciliation. This round changes only live standard reads; no export behavior or acceptance sentence is narrowed.
- Point 2: the same signalExportJourney covers independent readers, Explore reconciliation and stopped credential reads. Additional standard read proof is `./tests/porthole/standard-reads.mjs` standardReadJourney at lines 145–305 and standardAnalyticalJourney at lines 308–384: stock Prometheus evaluation and complete raw sample parity, captured stock spans, official generated OTLP readers, stock Tempo CLI, current restricted authority and revocation.
- Point 3: record exclusion and existing homogeneous-envelope erasure are exercised; full inherited subject erasure remains unproved. Analytical erasure explicitly remains unsupported. The locked S3 and RUM prerequisites, mixed subjects, alternate representations, late arrivals, external and derived custody and complete archive and derived-data fencing remain held under PORT-035 and PORT-096. No complete point-3 or DONE claim is made.

## Frozen rubric for the requested standard read slice

- R1: Real producers reach actual remote-write and OTLP intake. Stock Prometheus configured only with remote_read and a private credential file evaluates twelve fixed expressions; a complete matrix compares every captured synthetic series, sample, label and timestamp, plus resource target series. Proof: stockMetrics, lines 84–185, called by standardReadJourney.
- R2: OTLP gauge, cumulative sum, explicit histogram and summary mappings agree with the declared pinned rules; delta and exponential inputs refuse. Proof: stockMetrics and standardSchemaProof, lines 388 onward; native and both analytical configurations.
- R3: Stock healthy, failed and slow HTTP and Kafka traces retain permitted fields, schemas, resources, scopes, relationships and nanoseconds. Official OTLP readers and the stock Tempo CLI decode the results; restricted spans remain absent and completeness is explicitly partial. Proof: standardReadJourney, lines 218–287.
- R4: Only Authorization credentials with current telemetry.read authority work. Owner cookies do not replace, revive or supplement them. Scope narrowing, expiry and revocation release no forbidden accumulated result. Proof: standardReadJourney, lines 194–216 and 267–287; standardAnalyticalJourney, lines 328–375.
- R5: Credential quotas, row budgets and byte budgets refuse whole results. Legacy original-wire recovery is charged in addition to retained payload scans. Proof: standardSchemaProof, including the legacy recovery quota, 2001-point metric and trace cases and 60-record byte cases.
- R6: Portable exclusions and live custody changes are checked at release; native erased inputs and replayed captures remain absent after restart. Analytical erasure refuses without changing custody, while a labeled prior-journal fixture makes both analytical stores refuse stale samples and spans. Proof: standardAnalyticalJourney, standardSchemaProof and standardAnalyticalSchemaProof. No physical analytical deletion is claimed.
- R7: Restart and inactive native installation restore retain samples without transferring source credentials, activating intake or accepting owner cookies as read credentials. Proof: standardReadJourney and `./tests/porthole/archive.mjs` standardArchiveJourney, lines 1320 onward.
- R8: Query evaluation, range evaluation, search, metadata, streamed chunks and unsupported types refuse explicitly. Proof: standardReadJourney, lines 195–198 and standardSchemaProof unsupported-type cases. Porthole evaluates no PromQL.
- R9: Private audit links successful and denied reads to opaque references and excludes credentials. Proof: standardReadJourney, lines 295–301.

## DONE-RIDERS review

1. FAIL for full DONE: point 3 and the named held remainder are not complete. The requested bounded live-read outcomes are covered by the rubric above.
2. PASS for the implemented slice: real seeded stock input, exact reference comparisons, allowed reads and dangerous refusals are exercised. There is no empty-list-only or happy-path-only authority proof.
3. PASS exact-candidate Verify: verification.json invokes both standard journeys in the push source shard. Push Verify 42531988910 completed successfully on 4a86b252865d95d341e2a54d5b5b88e98c40bdd4. The earlier base Verify 42526716070 remains separate historical evidence.
4. PASS local exact-candidate binding: final local receipt files name 4a86b252865d95d341e2a54d5b5b88e98c40bdd4 and a clean worktree. Earlier development runs are labeled separately and are not substituted for final proof.
5. INSPECTED: receiving acceptance point 3 already names the archive and later-erasure-journal duty; the full inherited custody gaps remain explicit. This round changes no inheritance or acceptance text.
6. PASS mechanical generation: the documented PORT-061 write and check commands pass, generated views are restored from main, and source-lock check passes. Status, Gap and Evidence cells are unchanged.
7. PASS: CONTRACT.md has no diff, no acceptance point is added or removed, no ruling is rewritten and all 99 Status rows remain.
8. PASS for the implemented slice: current permitted reads complete; cookies, revoked credentials, narrower scopes, expiry and exhausted budgets refuse without forbidden contents. No mutation authority was introduced.
9. PASS boundary honesty: stock local installations establish interoperability only. No customer bucket, external deletion, RUM, provider tariff, funded capacity or legal boundary is reported as proven.
10. NOT APPLICABLE: no new custody, consent, spending or authority policy default was adopted; existing read authority and all holds remain in force.
11. PENDING lander: cloud work changes no default branch. Main equality, complete full-history publication scanning and Run site remain the fleet lander's checks.

## Pre-ready self-check

- Bounded public behaviors have sanity assertions, including supported reads and security and data-loss refusals. Full-clause DONE remains unavailable. Candidate Verify must be reported by its exact SHA.
- No existing assertion was removed, narrowed, skipped or hidden behind a new branch or width condition. No test registration was added; no cap raise is requested.
- Revoked authority, native erasure and replay, analytical deletion refusal and prior-journal read fences are exercised. The original wire is never used to recover a masked trace value.
- No UI screen changed; screen layout and tooltip work is not applicable to this round.
- Contract generation, source lock, typecheck, first-party checks and public schema checks pass locally. No migration changed, so the migration-ledger check is not applicable.
- The cloud-side full-history publication scan is not run. Its state is UNESTABLISHED here; no zero-finding scan receipt, main equality or green Run site is claimed. They remain mandatory independent landing checks.

## Plan return

Only the PORT-061 continuation row is advanced: standard live read compatibility, exact complete-capture reconciliation, legacy-wire scan metering and trace authority and budget proof. PORT-061 remains PARTIAL to PARTIAL. Counts remain 10 DONE, 20 PARTIAL and 69 MISSING, with all 99 rows intact. Other campaign rows, rulings and holds are unchanged. No new ct scope request or policy default is needed.




## Additional development findings

Extending native legacy fixture setup to analytical storage first produced a 409 custody refusal: metadata had been removed from only the control store after replication. The final setup instead models the old decoder in a pending envelope before real indexing and replication, keeping every retained copy consistent. The original wire stays unchanged and the read still must recover its exact float bits and meter that scan.

The expanded analytical erasure exercise then reached the existing `analytical_erasure_not_supported` refusal. The final journey preserves that public refusal and unchanged retained custody. Native erasure assertions remain unconditional in their original journey. A separately named analytical helper seeds only a prior journal to test both read fences and replay; it neither implements nor claims physical analytical deletion. This is an existing PORT-035 and PORT-096 hold, not a new authority default.

An environment reconnect interrupted receipt collection for one earlier development trial. Its actual terminal assertion log is retained separately; it is not used as final candidate proof. The final runs use fresh complete receipt files.


## CI triage

The first exact-candidate Verify attempt failed in job 128888013610, the typecheck shard. TypeScript compilation and all seven incremental typecheck tests passed. The failing command was `node --input-type=module -e 'import {nativeBackupErasureJourney} from "./tests/porthole/archive.mjs"; await nativeBackupErasureJourney()'`. Wrangler's local D1 read of `porthole_host_heartbeats` failed with `workerd/util/sqlite.c++:1710: SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY`, exit 1. The full actual failed-step log is retained as ci-failed-typecheck.log; ci-jobs.json records every job outcome. The source shard containing both new standard journeys passed, as did exports, ingest, traces, runtime, dashboards, migration, follow-up and mail. The unrelated analytical shard was cancelled.

Before any repair, the exact failed shard command `node scripts/verify-ci.mjs typecheck` ran unchanged on the candidate under Node 22.20.0 with CI, Wrangler and browser settings matching the cloud adaptation. It passed, exit 0, including native backup and both Services configurations. The same native-backup command then ran against main ff590be64b7cac3eaf2128c9833c641072cd8fb5 in the same runner after building main; it also passed, exit 0. The product checkout was restored to cloud/sx-porthole-c-f463 at the unchanged candidate. No source or assertion was edited during CI triage.

This is a transient SQLite contention failure in unchanged backup code. The one permitted failed-job rerun was requested for run 42531988910. verify-reproduce.json, main-native-backup.json and ci-rerun.json retain actual commands, heads, exits and request time. This was an infrastructure rerun, not a code repair round. No nonzero local reproduction is claimed.




## Terminal candidate and receipts

Candidate: 4a86b252865d95d341e2a54d5b5b88e98c40bdd4 on cloud/sx-porthole-c-f463. Current main at the final fetch was ff590be64b7cac3eaf2128c9833c641072cd8fb5. The final merge was already up to date. The fleet guard pushed the candidate successfully on its first attempt. Every candidate author and committer is the fleet identity; no trailer is present. Published history was not rewritten. No PR was required or created.

All eight local checks passed with complete receipts bound to this exact candidate and a clean worktree. The native and analytical journeys returned 214 metric series, 1092 source-exact samples, three distinct stock trace cases and eight spans in the selected trace. Native elapsed time includes waiting behind the analytical run in the repository queue; no scale or latency claim is made.

Verify run 42531988910 (push) on the exact candidate is completed, conclusion success. https://github.com/just-every/run-porthole/actions/runs/42531988910

MECHANICAL lock=pnpm run source:lock then pnpm run source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-061 then check PORT-061, restored main views exit=0; ledger=none exit=0.

PROBE PORT-061 standard-metrics: actual remote-write and OTLP intake, then stock Prometheus remote_read -> twelve expressions and every retained source series, label, timestamp and value match the reference.

PROBE PORT-061 standard-traces: stock HTTP and Kafka estate, then Tempo trace-by-ID -> official OTLP readers and stock Tempo CLI preserve every permitted span; restricted spans remain absent and completeness stays partial.

PROBE PORT-061 authority: mid-read revoke and expiry -> 401; narrowing and custody change -> 409; quota -> 429; record and byte exhaustion -> 422; unavailable analytical storage -> 503; no forbidden accumulated result.

PROBE PORT-061 erasure: actual native erasure -> empty metrics and trace 404, replay 409; analytical deletion -> 409 with unchanged custody; prior-journal fixture -> both analytical stores refuse stale metrics and traces with 409. Full analytical deletion remains unqualified.

GAP PORT-061: Complete subject erasure, analytical deletion, external and derived custody, RUM and locked S3 proof, provider cost qualification and held log and profile prerequisites remain open. No DONE claim or count change.

The full-history publication scan, main equality and Run site are unestablished in this cloud report and remain mandatory lander checks. Evidence publication transfers reports only and does not signal product acceptance or landing.

Exact-SHA Verify completed successfully on attempt 2 after the one permitted infrastructure rerun. GitHub budget used: 10 calls, including baseline inspection, candidate discovery and polling, failed-job metadata and one log archive, the rerun request and the final status. No code repair was made.
