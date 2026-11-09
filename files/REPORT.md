# sx-porthole-shard-time-3 plan and results

Repository: just-every/run-porthole
Branch: cloud/sx-porthole-shard-time-3
Baseline: 2564d7a4afad755896962b96d21f2385e1c866e0

## Plan
1. Full-history clone, install fleet identity/hooks and authenticated helper, fetch the previous cloud branch and main, start at the requested baseline. Merge main only if it has newer work; never rebase a published branch.
2. Read completed hosted run 42643013003 and earlier green run 42631085363. Obtain complete log archives plus job metadata, then extract VERIFY_TIMING command records and timestamped PROBE/Network window lines. The archives do not contain the literal phrase "verify progress"; these emitted timing records are the available measured evidence.
3. Keep the existing verification.json schema, all 28 runtime journey commands, all distinct checks, hosted-output verification, Chromium, Ubuntu 24.04 and the existing timeout. Do not add shards, remove journeys, change assertions, edit clauses or commit generated contract views.
4. Move the standard analytical journey with its Python readers and pinned Prometheus/Tempo clients to typecheck. Shift Services to ingest, metric rules to analytical, SLO to runtime, erasure to typecheck, signal export plus its Python prerequisites to traces, and heartbeat to exports. Leave pipelines with the native standard reader in source.
5. Reduce fixture overhead: read independent network snapshot witnesses concurrently inside each unchanged fault window; omit only fixture-control HTTP spans for /stats, /flush, /pause and /resume; retain all actual workload DNS/TCP/HTTP/broker spans and sampling intervals. Avoid eagerly cloning successful archive response bodies solely for unused assertion messages. Start Kafka/RabbitMQ independently in parallel. Once the capture is immutable, overlap analytical replay with native assertion/archive work in separate stores; always join the analytical proof in finally, preserving either failure and cleanup.
6. Run touched syntax/matrix/coverage checks, typecheck, real setup/build and the network public-door journey. Regenerate sources.lock.json last after staging. Save the first real commit with skip-ci, then publish the completed plan and wait for exact-SHA Verify using the REST budget.
7. Publish actual non-secret report/receipts only to the separate evidence ref. Report hosted per-shard durations, longest shard and exact SHA. No clause status changes or acceptance claims.

## Measured basis
Run 42643013003: network 12m08s cancelled, source 12m16s cancelled. Network command itself completed in 685.070s just before cancellation. Source completed native standard read in 303.240s and analytical standard read in 306.201s, then began pipelines before cancellation.
Run 42631085363: network 10m12s, source 11m35s. Network command 579.861s; native/analytical standard reads 261.679s/252.216s; pipelines (on ingest) 139.436s.
The production build is already produced once in prewarm and cryptographically checked before reuse. Historical source reader installation/client extraction took 3.778s/8.063s in the failed run; they do not explain multi-minute overruns. Network has one Docker estate, reused by its analytical proof; no repeated fixture installation was found. Repeated control spans, serial witness reads and redundant archive response reads are fixture overhead addressed here.

## Rebalanced command budgets
The table sums each command’s slower observed duration across both historical runs. It excludes job setup/cleanup and hosted wrapper overhead. The network entry is its pre-optimization measured 685.070 seconds. The final candidate command completed in 534.015 seconds (151.055 seconds faster), with the complete job at 9m26s.

| Shard | Conservative observed command sum (seconds) |
| --- | ---: |
| source | 461.189 |
| typecheck | 473.465 |
| runtime | 417.771 |
| exports | 531.159 |
| ingest | 505.769 |
| traces | 522.535 |
| analytical | 502.27 |
| migration | 475.723 |
| dashboards | 471.689 |
| network | 685.07 |
| follow-up | 491.867 |

## Coverage and scope
Push shards: 11 -> 11; nightly shards: 0 -> 0. The inherited plan already exceeds the older general eight-shard target; this scoped repair adds none. Its measured work cannot fit eight sub-ten-minute jobs without further optimization.
Runtime journey commands: 28 -> 28. Distinct non-build commands: 37 -> 37. Non-build command invocations: 37 -> 39, because reader installation and pinned-client extraction are also required on typecheck.
Test call-site inventory: 8 registration call sites and 4205 assertion call sites before/after; no registrations or assertions added, deleted or weakened. This inventory is evidence of unchanged coverage, not a reinterpretation of the seed test cap.
Clause changes: none. CONTRACT.md, ACCEPTANCE.md, docs/CLAIMS.md and ID-MAP untouched. No migration changes. No publication scan run, as explicitly scoped by the assignment; the Mac publication gate remains responsible for public landing.

## Results
Candidate head: 19850dac55d726ee2e2304b9eeffc0d40e27c354. Exact-SHA Verify run: 42650247726, completed/success on 19850dac55d726ee2e2304b9eeffc0d40e27c354. No PR was created; the fleet cloud-branch lander owns this repository.

Local setup, build, typecheck (including final edits), syntax checks, workflow-permission check, matrix selection, coverage-preservation inventory and staged source lock regeneration/check passed. The first local network attempt on the fixture save failed in Docker Kafka createAcls with a node-assignment timeout, before fault windows/assertions. The final-candidate local attempt also failed during broker startup: Kafka createTopics timed out after the broker disconnected (245.516 seconds total). Both attempts cleaned their owned containers. No retry loops or relaxed assertions were added. The exact-SHA hosted workflow remains the required runner proof.

All 11 hosted shards completed/success and each finished below ten minutes. The longest was network at 9m26s; mean shard wall time was 8m01s and longest/mean was 1.177. READY is supported by this exact-SHA hosted run. Local Docker startup failures remain disclosed; they did not occur in hosted Verify.

| Shard | Before: run 42643013003 | After: run 42650247726 |
| --- | --- | --- |
| runtime | 10m39s | 5m59s (success) |
| analytical | 7m27s | 6m50s (success) |
| traces | 7m44s | 8m28s (success) |
| exports | 8m50s | 9m21s (success) |
| follow-up | 10m09s | 7m18s (success) |
| typecheck | 5m55s | 8m51s (success) |
| network | 12m08s (cancelled) | 9m26s (success) |
| ingest | 5m11s | 8m31s (success) |
| source | 12m16s (cancelled) | 6m58s (success) |
| migration | 7m10s | 8m04s (success) |
| dashboards | 8m46s | 8m25s (success) |

The source and network failures are resolved on the pushed head. Clause/status changes: none. Runtime journey commands 28 -> 28; shard count 11 -> 11; no test deletions, skips or weakened assertions. The existing 12-minute timeout is unchanged. No product blocker remains. The fleet owns publication scanning and landing.

Evidence transport uses a report-only Git tree and a separate evidence ref. It does not change product custody, signal landing, or waive the fleet publication gate.
