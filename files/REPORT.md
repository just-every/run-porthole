# sx-porthole-sqlite-busy-1

Result: BLOCKED. Product changes are pushed and preserved. The required ten consecutive local passes were not achieved, and final exact-SHA Verify is red. No READY claim.

Repository: just-every/run-porthole
Branch: cloud/sx-porthole-sqlite-busy-1
Final product SHA: 3dc24efb6f5f6aefd50450565837d037bceb1544
Base: f51e701475918613fee00845d1bef56fe49517b7
PR: none; this seed's supplied landing contract uses the named cloud branch.

## Full plan and execution

1. Set fleet identity; refresh the fleet launcher; install decrypted-bundle Git authentication, commit hooks and guarded push tooling. Read launcher and repository rules and the inline briefs/RULES.md. Clone main shallow with blob filtering and create the named branch.
2. Inspect nativeBackupErasureJourney and reuse its existing stop/start/restartWorker helpers. Stop the owned runtime before offline local-D1 observations, including fixture SQL and snapshots; read the three host tables sequentially. Keep every assertion and real CLI/HTTP/native backup and independent restore door.
3. Regenerate/check sources.lock.json, syntax-check the touched module and run typecheck. Commit and guarded-push the first real candidate. Fetch main before publication; final merge was already up to date. Preserve published history.
4. Execute the complete journey sequentially under exact Node 22.20.0 with fresh source and destination installations each time. The initial candidate passed five, then failed repetition 6 when old owner proof produced 403 at the unchanged expected-404 custody assertion. Add existing freshOwner() fixture calls before frozen export creation, confirmed erasure and withdrawn-custody inspection. This renews native verification through the existing public door; no product policy or assertion was relaxed.
5. Regenerate/check the lock and rerun syntax/typecheck on the correction. Commit and guarded-push final SHA 3dc24efb6f5f6aefd50450565837d037bceb1544. Start a fresh ten-run sequence on that exact unchanged candidate. Seven consecutive repetitions passed; repetition 8 failed in the installed native import CLI with native_error: TypeError after all 20 parts staged and private archive audit projected. The fail-fast sequence stopped; repetitions 9–10 were not run. Do not add a blanket retry or change the restore assertions to conceal this unrelated failure.
6. Observe exact-SHA CI within the ten-call budget. Inspect the earlier completed failed analytical job once. Reserve the final call for final-candidate discovery after local execution. Publish this complete non-secret report/receipt packet only to refs/heads/evidence/sx-porthole-sqlite-busy-1, independently from product custody.

## Product change and scope

Only tests/porthole/archive.mjs and its sources.lock.json hash changed (25 insertions, 6 deletions overall). Runtime shutdown precedes the local D1 read phases; cached owner-proof reads also use the existing restart helper. Fresh owner proof is obtained at sensitive HTTP phase boundaries because offline observations can consume the five-minute proof lifetime. The archive authority gate is unchanged at src/porthole/portability/http.ts:32.

No product runtime, UI, clause text, Status/Gap/Evidence cells, generated contract views or test registrations changed. No clause claims or status changes. No source IDs, package pins, deployment IDs or provider accounts changed. No PR, forced push, rebase of published history, empty commit, workflow dispatch or workflow retry. No full local verify/suite. No publication scan in this VM: the brief excludes it and the fleet owns the publication gate before landing.

## Before/after counts

| Measure | Before | After |
| --- | ---: | ---: |
| Assertion calls in touched file | 515 | 515 |
| Assertion calls in native backup helper | 56 | 56 |
| Exported journey functions in touched file | 21 | 21 |
| Test registration additions/deletions | 0 | 0 |
| Clause status changes | 0 | 0 |

Every original assertion-containing source line remains byte-equivalent after trimming indentation. These are static file/helper counts, not a claim about global suite registrations or dynamically executed assertion totals. See assertion-receipt.json.

## Local validation on final candidate

- Exact Node 22.20.0 `pnpm run typecheck`: exit 0.
- `node --check tests/porthole/archive.mjs`: exit 0.
- `pnpm run source:lock` and `pnpm run source:check`: exit 0.
- `git diff --check`: passed; committed worktree clean.
- Full native journey: seven consecutive passes, then one native import failure. Ten consecutive passes NOT established.
- No SQLITE_BUSY/database-is-locked error occurred in either recorded trial sequence. This observation does not waive the failed restore or the ten-pass requirement.

Final sequence, all on 3dc24efb6f5f6aefd50450565837d037bceb1544:

| Repetition | Result | Seconds | Started (UTC) | Finished (UTC) |
| --- | --- | ---: | --- | --- |
| 1 | PASS | 772.837 | 2026-11-09T13:25:29.841Z | 2026-11-09T13:38:22.680Z |
| 2 | PASS | 863.689 | 2026-11-09T13:38:22.682Z | 2026-11-09T13:52:46.371Z |
| 3 | PASS | 838.390 | 2026-11-09T13:52:46.373Z | 2026-11-09T14:06:44.763Z |
| 4 | PASS | 844.281 | 2026-11-09T14:06:44.766Z | 2026-11-09T14:20:49.047Z |
| 5 | PASS | 894.430 | 2026-11-09T14:20:49.050Z | 2026-11-09T14:35:43.480Z |
| 6 | PASS | 813.888 | 2026-11-09T14:35:43.482Z | 2026-11-09T14:49:17.370Z |
| 7 | PASS | 893.744 | 2026-11-09T14:49:17.373Z | 2026-11-09T15:04:11.117Z |
| 8 | FAIL | 760.738 | 2026-11-09T15:04:11.119Z | 2026-11-09T15:16:51.857Z |

Actual full final output is journey.log; actual receipt is journey-receipt.json. The executed driver is repeat-harness.mjs. The initial candidate's five passes and proof-expiry failure are preserved in initial-journey.log and initial-journey-receipt.json; they are not counted toward the final candidate's sequence.

## Blockers and exact-SHA CI

1. Local repetition 8: `Native import failed (1)` / `native_error: TypeError`, through tests/porthole/archive.mjs:1012. All 20 parts were staged and the private archive audit was projected before the native portability module reported failure. The installed @runeditrun/rer 0.2.91 CLI deliberately reports only symbolic native error class/code (cli/portability-worker.mjs:83 and cli/portability.mjs:114), so no deeper cause is asserted. That failure is outside this one local-D1-read test defect. Its restore assertion was not skipped, weakened or automatically retried. A focused CLI/portability investigation is needed before the ten-consecutive-pass requirement can be met.
2. Final Verify 42625338953 on 3dc24efb6f5f6aefd50450565837d037bceb1544: completed/failure. URL: https://github.com/just-every/run-porthole/actions/runs/42625338953. The remaining API budget was used for exact-SHA discovery; final job-level failure details were not read. Do not infer the final run cause from the earlier run.
3. Earlier candidate Verify 42615886113 on c7a6d9862319ff0ab4c80ed32ed6d337aa238591 failed the analytical shard's `no horizontal page overflow` assertion at tests/porthole/explore.mjs:167:66 (job 129155847796); the typecheck shard 129155847741 was cancelled. The affected mail-receipts shard 129155847610 completed/success on that earlier SHA. The aggregate verify job 129161603335 failed. Earlier CI evidence is retained in ci-receipt.json, ci-jobs.json, ci-failed-jobs.json and ci-failure.log. This is context only, not green evidence for the final SHA.

Ten GitHub calls total: historical failed-job metadata and one permitted log read (2), earlier exact-SHA discovery and three observations spaced at least 300 seconds (4), failed-job metadata, its one archive log read and complete final earlier-job outcomes (3), final-candidate exact-SHA discovery (1). No more GitHub calls or workflow reruns were made. The historical `gh run view 42605662859 --repo just-every/run-porthole --job 129121214753 --log-failed` exited 0 with empty output; the earlier candidate's permitted log read returned 7,961 bytes. Final-candidate log inspection remains pending due to the exhausted budget.

## Product custody and evidence return

Both commits use Run Edit Run fleet author and committer identities and no trailers. All candidate commits, including side parents if present, were inspected before each push. Both guarded product pushes succeeded on attempt 1. Remote product head was independently verified as 3dc24efb6f5f6aefd50450565837d037bceb1544; the clean published work is retained, with no push rejection or rescue-bundle requirement. Product publication, evidence publication and landing readiness are separate: this packet is not READY, acceptance or landing proof.

The lane should retain this scoped test fix, investigate the native import TypeError and final CI failure, then repeat the full ten-run requirement. No unrelated product repair or assertion weakening is included.
