# sx-porthole-ci-shape-1

Repository: just-every/run-porthole
Branch: cloud/sx-porthole-ci-shape-1
Candidate: a6be5702ed7022dcfc2c19bc5b26146c33cfa8b2
Base: 85b79464fa8a79597741711f6689f1b21132cd89

## Plan

1. Configure fleet Git identity, refresh the injected bundle, install the bundle-only Git helper, push guard and co-author hook; clone full history and branch from origin/main.
2. Read the launcher/repository instructions and inline builder rules, workflow, shard manifest and helpers; collect two recent Verify job/step records and analytical log timing evidence.
3. Separate immutable, runner-image/architecture/Playwright-version browser and system-package caches from the frozen pnpm store. Prewarm once before shards. Probe a real Chromium page before any apt work; cache signed downloaded .deb archives and apply them only on jobs whose probe fails. Keep apt network work bounded to one fallback per job.
4. Produce one production build in prewarm and share its exact-run cache. Validate commit, lockfile and every output digest before reuse. Keep normal local builds, hosted-output/hydration checks, all tests, and the 12-minute push timeout.
5. Rebalance the measured analytical hotspot by moving host heartbeat to exports. Also move native backup erasure from the near-limit typecheck shard to mail-receipts, using the lighter destination job total. Keep standard analytical reads with their Python and native-client preparation in source. Add per-command VERIFY_TIMING output for future measured rebalancing.
6. Run touched local checks and typecheck; stage source files, regenerate/check sources.lock.json last; commit with fleet identity, rebase the unpublished candidate on fetched main, audit all candidate identities/trailers and push the named product branch through the guard.
7. Obtain the candidate's exact-SHA Verify and job timings within the ten-call GitHub budget. Never rerun a SHA that already has a run. Publish actual non-secret reports/receipts separately on evidence/sx-porthole-ci-shape-1.

## Baseline findings

The two supplied recent runs are 42561706552 and 42565710026. Their API job lists contain mixed latest-attempt jobs after selective reruns; they are not independent p90 samples. Browser/system installation is generally 11–16 seconds in those records, rather than 5–8 minutes. Both analytical jobs exceeded nine minutes overall; the latter was cancelled at the job limit. In the actual latter analytical log, analytical recovery took about 124 seconds, host heartbeat 259 seconds, and database diagnostics ran for at least 269 seconds before cancellation. Moving heartbeat removes about four minutes from that overloaded group without removing coverage. The two recorded shard sets total 94.58 and 93.80 active runner-minutes respectively; these include jobs retained from earlier attempts after selective reruns, so they do not represent clean two-run p90 measurements.

GitHub returned zero bytes, with exit 0, for both the requested analytical job and the full attempt-1 log of 42561706552. Do not interpret the missing text as a passing log or fabricate per-test weights for it. Its complete job/step timing metadata is included. The populated analytical log is retained locally under work/sx-porthole-ci-shape-1/raw; only its relevant non-secret timing lines are published.

## Changes and coverage

- Production builds: 11 repeated shard builds become one shared build per Verify run. Every consumer verifies the shared build before accepting it.
- Push shards: 11 before and after. The inherited manifest already exceeds the general eight-shard rule. This change keeps its job count and reduces repeated setup rather than merging unmeasured work into near-timeout shards. Eight-shard consolidation remains unproved.
- Declared commands: 45 before and after; all 34 non-build commands remain byte-for-byte identical as a multiset. No existing product test was removed, skipped, weakened or moved out of push Verify, and no product test file changed. Two new CI validation helpers check browser launch and shared-build integrity; the 45/34 counts describe manifest commands, not a fabricated total of underlying test registrations.
- Browser provisioning: previously ten unconditional --with-deps invocations. Now one cache producer, browser-only consumers, and no apt operation when the launch probe passes. System cache contains signed package archives, not installed-state databases or blanket copies of /usr/lib. Exact keys intentionally have no cross-version/image restore fallback.
- Build caches are scoped to full commit SHA, workflow run ID and attempt. Browser/library caches are scoped to runner OS/architecture, ImageOS/ImageVersion, exact pinned Playwright version and installer helper hashes. A cache eviction cannot silently skip verification.
- All existing source freshness, hosted/hydration and aggregate checks remain. Aggregate now also requires prewarm success. The push timeout remains 12 minutes.
- No src/**, CONTRACT.md, ACCEPTANCE.md or docs/CLAIMS.md edits. No clause status changes, releases, deployment, main push or DONE claim.

## Local verification

Setup with the required fleet owner and non-interactive flags completed. Typecheck passed on both the VM Node and the exact pinned Node 22.20.0. A fresh production build on the committed candidate also passed. Workflow YAML parse, local reusable-workflow permissions, JavaScript syntax and shell syntax passed. A real Chromium launch/render probe passed using /usr/bin/chromium with --no-sandbox. Behavior probes proved valid shared output reuse and refusal of modified bytes, extra files, symlinks, another commit and mismatched workflow SHA; ordinary command failure still propagates and emits timing. Source lock regeneration/check passed after staging all source changes. Controlled installer probes also passed for the healthy launch, cold fallback, cached dependency recovery and still-unhealthy refusal paths; these probes used mocked package/sudo commands and made no system-package changes. Product identity/trailer audit passed and the first guarded push succeeded on attempt one.

The setup command selected the exact repository Node 22.20.0 automatically. The supplied cloud toolchain leaves the newer VM Node 24.19.0 for direct pnpm commands; a pinned-Node typecheck is also recorded separately. Full local verification was not run, following the touched-check rule. No UI changed, so no screen proof is required. An attempted optional actionlint installation could not run because /usr/bin/go is a different program ('Go: Unknown option: install'); YAML and workflow permission checks did pass.

## Candidate CI and remaining limits

The initial candidate 04dd09bbb2b22d4f2486827c866709e28c82adcb had Verify run 42572469295. Dependency review caught the standard-read move before completion: it needs source's Python readers and native clients. A second non-force commit restored that placement and preserved all commands. The final candidate is a6be5702ed7022dcfc2c19bc5b26146c33cfa8b2; its exact-SHA Verify 42573437878 completed successfully: https://github.com/just-every/run-porthole/actions/runs/42573437878 . Two consecutive completed green candidate Verify runs have not been obtained: the rules forbid dispatching/rerunning a SHA with an existing run, and the ten-call shared budget limits observation. A p90 cannot be established from these samples. Source publication scanning and landing belong to the fleet Mac; cloud has not claimed either.

## Final exact-SHA observation

Final Verify run: 42573437878 — completed/success on a6be5702ed7022dcfc2c19bc5b26146c33cfa8b2. https://github.com/just-every/run-porthole/actions/runs/42573437878

| Shard | 42561706552 total seconds | 42565710026 total seconds | Final total seconds | Final run step seconds |
| --- | ---: | ---: | ---: | ---: |
| shards (source, false) | 593 | 686 | 667 | 636 |
| shards (migration, true) | 643 | 596 | 411 | 381 |
| shards (traces, true) | 387 | 353 | 365 | 329 |
| shards (dashboards, true) | 562 | 598 | 386 | 340 |
| shards (runtime, true) | 689 | 582 | 590 | 554 |
| shards (analytical, true) | 692 | 736 (cancelled) | 506 | 451 |
| shards (mail-receipts, true) | 331 | 340 | 555 | 518 |
| shards (follow-up, true) | 434 | 376 | 339 | 305 |
| shards (ingest, true) | 455 | 333 | 413 | 376 |
| shards (exports, true) | 284 | 292 | 490 | 455 |
| shards (typecheck, true) | 605 | 736 (cancelled) | 383 | 350 |

Measured final performance: {"all_job_minutes": 86.08, "longest_seconds": 667.0, "longest_to_mean": 1.437, "mean_seconds": 464.09, "prewarm_seconds": 50.0, "shard_minutes": 85.08}.

These are one final candidate run's actual job and command-step times, not a per-shard p90. The earlier candidate was superseded by the dependency correction. No second consecutive green run was dispatched or claimed.

The product branch remains separate from report-only evidence. The full report/receipt packet is published only on evidence/sx-porthole-ci-shape-1. No contract clauses or status counts changed.

## Provisioning and cost comparison

The final browser prewarm took 2 seconds, and consumer browser provisioning/probes took 1–2 seconds each; source correctly skipped that step. The shared production build took 4 seconds. All producer/consumer steps succeeded. Complete active job totals, including plan/prewarm/aggregate, were {"42561706552": 94.73, "42565710026": 93.92} minutes for the two mixed-attempt baselines versus 86.08 minutes for this candidate. This is observed runner time, not a billing guarantee or a causal benchmark.

The analytical shard is now 8:26; typecheck 6:23; exports 8:10. Remaining long shards are source 11:07, runtime 9:50 and mail-receipts 9:15. Their per-shard p90 is unproved from one final sample, and the inherited eleven-shard count remains above the general eight-shard target. No test or timeout was relaxed to obtain green. Exact-SHA Verify is green, local touched checks passed, the branch is pushed, and there is no product blocker to returning READY. This is not a DONE, publication-scan or landing claim.
