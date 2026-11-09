# sx-porthole-c-f464-pc1

Final candidate 265c5f4563d84f8cb81dc3646207b632b32314cb is pushed. The owner-proof fixture repair passes the integrated source shard locally and the exact-candidate CI source shard. Ten product shards succeeded; the analytical shard was cancelled around the twelve-minute limit, so the overall Verify is not green. PORT-061 remains PARTIAL and counts stay 10 DONE, 20 PARTIAL, 69 MISSING. The complete plan, actual non-secret receipts, cancellation evidence and held boundaries follow.

Repository: just-every/run-porthole
Branch: cloud/sx-porthole-c-f464-pc1
Starting head: c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f

## Plan

1. Preserve the published continuation commits and reproduce the failing source shard on the saved head with its CI environment.
2. Diagnose the actual assertion or transport failure, then fix forward without changing contract judgments, generated views, existing assertions or workflow guards.
3. Run the touched source shard, typecheck, contract generator and source lock checks. Merge fresh main, preserving current judgments, if main advanced.
4. Audit all candidate identities and trailers, push only the named cloud branch through the fleet guard, and discover its exact-SHA Verify once.
5. Publish the complete non-secret report and actual receipts through the separate evidence ref. Keep PORT-061 PARTIAL because the held full-clause dependencies remain unproved.

## Starting evidence

Verify 42544257646: source job 128925747630 failed; all ten other product shards passed. Aggregate verify job 128928899798 failed due to that shard.
The prescribed `gh run view 42544257646 --repo just-every/run-porthole --job 128925747630 --log-failed` exited zero but returned zero bytes. No log archive or blob download retries were attempted.

The already-downloaded archive was found at the CLI's temporary cache. Its source job text establishes the actual failure without another network request: `stock evaluation parity: rate(synthetic_scrape_requests_total[2m])`, at `tests/porthole/standard-reads.mjs:188`. Actual result was an empty vector; the reference had 24 producer series. The complete native standard-read journey passed in that run. The failure occurred in `standardAnalyticalJourney` before the standby comparison. The packet selects the assertion excerpt, excluding checkout and environment setup logs.

Starting contract counts: 10 DONE, 20 PARTIAL, 69 MISSING (99 total). No Status, Gap, Evidence or acceptance sentence changes are authorized or planned. No UI screens are changed by this repair.
## Initial local observations

Typecheck passed on Node 22.20.0. The first complete source-shard attempt inherited Node 24.19.0 for direct test commands; its build still selected the repository-pinned Node 22.20.0. It is recorded separately and cannot substitute for the requested same-runtime reproduction. Both the native and analytical stock Prometheus comparisons passed all nineteen expressions, including the CI-failing rate expression; both primary and standby matched. The Node 22.20.0 reproduction will run before any product edit.
## Acceptance map and held boundaries

- Point 1: `tests/porthole/archive.mjs#signalExportJourney` covers approved resumable multi-team four-signal export, CLI interruption, counts, types and relationships. It was loaded by the successful exports shard of saved-head Verify 42544257646; unchanged by this continuation.
- Point 2: the same journey covers independent format readers, query reconciliation and revoked export credentials. The standard-read addition is exercised by `tests/porthole/standard-reads.mjs#standardReadJourney` and `#standardAnalyticalJourney`: pinned stock Prometheus and Tempo clients, official OTLP readers, source-exact data, current scope, quotas, refusals and restart. No new acceptance point is added.
- Point 3: existing portable record exclusions and homogeneous local erasure fences are exercised. Full subject erasure remains unproved: mixed subjects, alternative representations, late arrivals, RUM, external and derived custody, full archive application and every derived-data fence remain under PORT-035 and PORT-096. Locked S3 needs an authorized customer bucket with object lock; RUM prerequisites and the existing ct judgment remain unchanged.
- Priced provider costs require the funded operating account and PORT-023 rate-card work. Standard log reads retain PORT-086 and PORT-087 holds; profile reads retain PORT-015. Search, TraceQL, PromQL evaluation, metadata, native histograms, exemplars and streamed chunks remain omitted. No export approval, deletion, expiry or new credential authority is added.

## Initial DONE-RIDERS assessment

1. PARTIAL: full point 3 and held capabilities are not proven. No DONE claim.
2. PASS for the implemented read slice in the initial local run: populated allowed reads and unsafe refusals, unchanged custody on budget failure, live authority changes and erasure replay fences are exercised.
3. NOT MET for the overall saved candidate: Verify 42544257646 failed its source shard, despite ten successful product shards. No exact-SHA green claim.
4. PASS for local results: both journeys ran on unchanged saved head c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f.
5. INSPECTED: PORT-061 names timestamps, provenance, erased-record exclusions and complementary PORT-026 and PORT-034 duties; no inheritance edits.
6. PRESERVED: no builder edits to Status, Gap, Evidence, provenance or counts; the lander owns generated views and judgments.
7. PASS: no acceptance changes, deleted clauses or coverage rewrites.
8. PASS for the implemented read slice in the initial local run: header-only credentials, foreign scope, narrowing, revocation, expiry, quota refusal and mid-read authority fences are exercised through public HTTP doors.
9. PASS boundary honesty: no provider, retention, physical analytical deletion or legal qualification claimed.
10. NOT APPLICABLE: no new policy default or authority choice.
11. PENDING LANDER: no main write, landing, publication-scan result or Run site receipt claimed.

Pre-ready checks: no assertions removed, narrowed, skipped or conditionalized; no UI changes; no source or fixture edits; security, erased-capture replay and current-authority cases passed in the initial local run. Publication scanning, main equality and Run site are unestablished cloud handoff gates. No new plan row or clause status is changed; this continuation only investigates the saved candidate's source failure.
## Exact-SHA workflow discovery

REST discovery found two Verify runs on c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f: original branch run 42544257646 failed, and continuation-branch run 42555699761 was completed with conclusion cancelled. No success exists in this response. Neither another SHA nor a cancelled run is treated as green. No workflow dispatch or rerun has been requested.
## Reproduced source-shard failure and repair 1

VERIFY_REPRODUCED: same saved head, source shard command and Node 22.20.0, exit 1. The native journey passed all nineteen stock metric expressions and restored the real trace, then failed in `standardMappingProof` at line 536 while minting a legacy-recovery scan-quota credential: `{"error":"step_up_required"}`, HTTP 403 versus expected 201. `source-node22.json` records the actual nonzero receipt. This is a different assertion from the original analytical-rate mismatch, which remains unreproduced.

The test obtained its native owner proof before the long independent restore. Refresh that proof after restore, before the next owner-only schema, credential and erasure probes. Product authorization and proof expiry are unchanged, every assertion stays active, and no missing or expired proof is accepted. The source fixture's `post` closure then uses the newly authenticated owner cookie. The full touched source shard will rerun on Node 22.20.0 before publication.
## Main integration and preservation

Main advanced to 85b79464fa8a79597741711f6689f1b21132cd89 with reviewed member handover and previously landed standard-read qualification. The published continuation was merged, never rebased or rewritten. CONTRACT.md remained unchanged. The source-lock conflict was resolved by regeneration, not manual hash edits. An internal precommit scope assertion stopped because the merge legitimately staged main's additional files; no commit or push occurred from that failed assertion. The scope check was corrected to compare the merged tree with origin/main.

The required merge was saved with `[skip ci]`, using a tree equal to current main while retaining both histories. The owner-proof repair was then reapplied from the preserved patch. Its SHA-256 still matches the bytes that passed the first repaired source run. The source shard will rerun on this integrated tree before the final candidate commit.

## Final candidate and local results

Branch: cloud/sx-porthole-c-f464-pc1
Full candidate SHA: 265c5f4563d84f8cb81dc3646207b632b32314cb
Current main at final fetch: 85b79464fa8a79597741711f6689f1b21132cd89
Preserved initial published head: c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f
Merge save: a2a7d7689176de2c1be982c142db02690a7bdea8, pushed with CI skipped.
Final product delta against main: only six fixture setup and comment lines plus the generated source-lock hash. No API implementation, assertion, test registration, UI screen, contract cell, acceptance sentence or count changes. No PR was created; branch push is this repository's Verify entry point.

The complete integrated source shard passed on Node 22.20.0. Both native and analytical runs reconciled 223 metric series and 1,117 samples, three actual stock traces and eight selected-trace spans. Stock Prometheus evaluated nineteen fixed expressions, including the formerly failing rate expression, against the independent reference on primary and standby. Stock Tempo CLI and generated OTLP readers matched the authorized captured span fields. The original CI analytical-rate mismatch did not reproduce in any local run; this repair instead addresses the separately reproduced expired native-owner proof. Every original assertion is retained.

The integrated test command ran on the merge save plus the recorded repair patch. Its tested fixture SHA-256 is bc7ccda2c29e6a633ebf2389f300f472ed69ddb03425d1aaec4b2b13a4cfcb3b; the committed candidate contains those exact tested bytes. The final committed source-lock check passed, and the checkout was clean at product publication. No migration is added relative to main; main's inherited migration was applied by both native runtime harnesses.

MECHANICAL lock=pnpm run source:lock and pnpm run source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-061 and check PORT-061 exit=0, then restored ACCEPTANCE.md and docs/CLAIMS.md from origin/main; ledger=none (no candidate migration delta) exit=0.

PROBE PORT-061 standard metrics: actual remote-write, stock OTLP and official-schema edges through /api/v1/read -> exact stock Prometheus reference series, labels, times and values on both stores.
PROBE PORT-061 standard traces: captured actual HTTP, Kafka and database estate through /api/traces/{traceID} -> exact permitted stock OTLP spans, both Tempo representations and explicit partial evidence; restricted spans absent.
PROBE PORT-061 authority: actual multi-page analytical reads -> mid-read revocation and expiry 401, narrowing and custody change 409, quota 429, unavailable storage 503; no accumulated unsafe result released.
PROBE PORT-061 erasure and restore: native homogeneous subject erasure and replay -> erased metrics and traces absent; prior-journal stale analytical copies refused; independent inactive archive restore -> retained exact content, new destination credentials only and intake still paused.

Counts before and after: 10 DONE, 20 PARTIAL, 69 MISSING; 99 total. PORT-061 remains PARTIAL. Plan rows changed: none. No new policy default or ct scope request.

Publication scan: {"commit":"265c5f4563d84f8cb81dc3646207b632b32314cb","complete":false,"historyScanned":false,"findings":null,"reason":"Mac guarded lander gate; not run in cloud"}. Git history is full, not shallow. Main equality and Run site remain unestablished before landing; no landing or acceptance claim is made. The exact-SHA branch Verify observation will be appended when available.

## Candidate acceptance and rider register

The final candidate remains PARTIAL. Point 1 and point 2 retain their signal-export coverage in `tests/porthole/archive.mjs#signalExportJourney`; the branch Verify exports shard reruns them. Their broader standard-read support is qualified by the two standard-read journeys named below. Point 3 remains only partially met and is not listed as fully proven in the claim.

- Acceptance point 1: approved multi-team, multi-page four-signal API and CLI export, interruption and reconciliation -> `tests/porthole/archive.mjs#signalExportJourney`, unchanged; exact-candidate CI confirmation pending.
- Acceptance point 2: independent Parquet, OTLP and standard profile readers, Explore comparison and revocation -> the same signal-export journey, unchanged; standard metrics and traces additionally use `tests/porthole/standard-reads.mjs#standardReadJourney` and `#standardAnalyticalJourney`, locally passed on the integrated candidate bytes.
- Acceptance point 3: portable record exclusions and local homogeneous erasure fences -> signal-export and subject-erasure journeys plus the standard-read schema and restore probes. Full mixed and external custody, RUM and complete derived fences are not claimed.
- Inherited live transport authority: both standard-read journeys serve real permitted data and refuse foreign, narrowed, expired and revoked authority, including mid-read changes and quotas; they passed locally on the integrated tree.
- Inherited erasure and inactive custody: standard-read journeys and `tests/porthole/archive.mjs#standardArchiveJourney` prove the local boundary and inactive restoration; broader deletion authority and physical analytical erasure remain held.

Final rider assessments before CI: R1 PARTIAL (held full point 3); R2 PASS for the implemented populated safe and unsafe read journeys; R3 NOT MET for the overall workflow (cancelled analytical shard; target source and export jobs succeeded); R4 PASS (committed test bytes match the successful integrated run); R5 INSPECTED (existing clause inheritance unchanged); R6 PASS for preserved judgments and local contract generation, with views restored; R7 PASS (no acceptance change); R8 PASS for current scoped credential authority; R9 PASS for honest provider boundaries; R10 not applicable (no policy default); R11 PENDING guarded lander. No DONE count is proposed.

The independent lander owns publication scanning, main equality and Run site. No local full-suite run, CI dispatch, workflow rerun, broader provider operation, new account or new credential class was used. The ten other product shards of the saved-head Verify had passed; the final branch Verify independently reruns the complete plan.

## Branch Verify custody

Push Verify run 42562830073: https://github.com/just-every/run-porthole/actions/runs/42562830073
Event: push; branch: cloud/sx-porthole-c-f464-pc1; exact head: 265c5f4563d84f8cb81dc3646207b632b32314cb.
First permitted observation: status in_progress, conclusion None. One watcher observes this run at most once every 300 seconds. The final observation is stored in final-verify.json. No other head is used as evidence.

## Terminal CI result and handoff

Candidate: 265c5f4563d84f8cb81dc3646207b632b32314cb, cloud/sx-porthole-c-f464-pc1.
Verify 42562830073 completed with conclusion cancelled, not success. Source job 128982813551 succeeded; exports job 128982813465 succeeded. Ten of eleven product shards succeeded. Analytical job 128982813461 was cancelled from 04:37:22Z to 04:49:38Z, approximately 12 minutes 16 seconds, consistent with the workflow's configured twelve-minute job limit. The aggregate verify job 128986106497 failed because every shard was not successful.

The permitted log command exited zero and returned no failed-step text. Its already-downloaded archive was inspected without another request. It contains no AssertionError. The analytical connection and host-heartbeat journeys completed. The database journey printed its final native installation archive and re-export proof at 04:49:25Z, followed by “The operation was canceled” at 04:49:35Z. This is cancellation evidence, not an exact-SHA green workflow. No failure was guessed away and no workflow or test command was altered to make it green. The CI-shape lane must resolve the analytical job's duration and confirm a complete exact-SHA Verify before landing. The GitHub budget reached ten calls; no dispatch or rerun was requested.

The run's cloud handoff rule explicitly allows a pushed, locally proven candidate when CI is cancelled; the terminal READY custody signal is not a green-Verify, landing or DONE claim. The guarded Mac lander must still require the complete publication scan, exact-SHA green Verify and subsequent Run site. Main remains 85b79464fa8a79597741711f6689f1b21132cd89 at the recorded remote observation and does not equal the candidate. Publication scanning and Run site are unestablished. No status or count promotion is requested.

Final rider result: R1 PARTIAL (held full point 3); R2 PASS for implemented safe and unsafe read journeys; R3 NOT MET for overall Verify, with the target source and export jobs successful; R4 PASS (exact candidate CI ran the preserved assertions); R5 INSPECTED; R6 preserved judgments and passing local generation; R7 PASS; R8 PASS through current authority, erasure and quota probes; R9 honest held-provider boundaries; R10 not applicable; R11 pending guarded lander. Full clause DONE remains unclaimed.

CLAIM PORT-061 PARTIAL points=1,2 tests=tests/porthole/archive.mjs#signalExportJourney; tests/porthole/standard-reads.mjs#standardReadJourney; tests/porthole/standard-reads.mjs#standardAnalyticalJourney
GAP PORT-061: Broader subject erasure and derived custody, RUM and locked S3 proof, provider costs, and held log and profile prerequisites remain open. The overall candidate Verify is cancelled, with its source and export qualification jobs successful; the analytical job's runtime budget requires fv triage.

VERIFY_REPRODUCED {"head":"c62aa0a225f5da1b2965b37c20b6bcdfb12fee3f","job":"128925747630","command":"CI=true WRANGLER_SEND_METRICS=false PLAYWRIGHT_SKIP_BROWSER_GC=1 node scripts/verify-ci.mjs source","test":"standardMappingProof","exit":1,"failure":"step_up_required; 403 !== 201"}
