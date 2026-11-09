# sx-porthole-shard-time-2

Moved the complete host-heartbeat journey from the typecheck shard to the shorter runtime shard. The product candidate is **BLOCKED** at `2564d7a4afad755896962b96d21f2385e1c866e0` on `cloud/sx-porthole-shard-time-2` in `just-every/run-porthole`.

Verify [42643013003](https://github.com/just-every/run-porthole/actions/runs/42643013003) is **cancelled** on that exact SHA. Typecheck: **5m55s** (previous final head: 12m16s, cancelled). Longest shard: **shards (source, true), 12m16s**. The target is typecheck under ten minutes, with every shard completing below the existing twelve-minute job limit.

## Investigation and decision

The full-history `git log/diff f4294d59a12a45667efc788c6a7f63f80bfd46f7..bb8d1e70d3a4c5ced856773fa2d6ab25939fdbb2` contains exactly one commit, bb8d1e7, touching verification.json and its source-lock digest. There is no intervening main merge. Every typecheck command and application/test source is identical across the two heads. The commit swaps handover/pipelines between source and ingest and moves nativeBackupErasureJourney from exports to follow-up. Those other-shard adjustments remain.

Historical hosted command timings explain the cancellation:

| Typecheck command | f4294d59, Verify 42631085363 | bb8d1e70, Verify 42633896731 |
| --- | ---: | ---: |
| Ordinary compiler | 5.156s | 6.354s |
| Incremental compiler regression | 44.330s | 54.594s |
| Complete local/analytical Services | 261.548s | 414.294s |
| Complete host heartbeat | 151.809s | interrupted after about 224.9s |

The first job passed in 8m12s. On the final head, Services grew by 152.746s (58.4%) without a source change. Heartbeat then reached inactive archive transfer at 14:32:45.890Z and was cancelled at 14:34:48.766Z; all compiler and Services assertions had passed. The unchanged cumulative workload exhausted the job budget. The final scheduling commit did not put work back into typecheck.

Reassigning heartbeat removes 2m32s at the earlier successful timing, or the entire interrupted final journey, from typecheck. Applied to the cancelled attempt, the remaining commands plus setup would have taken about 8m27s. This preserves the complete dense-observation, native browser, restart, authority, storage-failure and independent archive assertions, in the same push tier. No retry was added to CI.

## Change counts and source custody

| Item | Before | After |
| --- | ---: | ---: |
| Push verification commands | 48 | 48 |
| Push shard jobs | 11 | 11 |
| Nightly shards | 0 | 0 |
| Workflow timeout minutes | 12 | 12 |
| Test source files edited by this round | 0 | 0 |
| Clause status changes | 0 | 0 |

The command multiset is identical. Only verification.json and its digest in sources.lock.json changed. CONTRACT.md, ID map and generated acceptance/claim views were untouched. Sources.lock.json was regenerated last and checked on Node 22.20.0. No publication scan was run, as directed by this CI-only brief; the independent fleet publication and landing gates remain applicable. No clause CLAIM, DEFAULT or GAP is introduced.

## Local validation

- Production build: passed through cloud_run and the checkout's pinned RER.
- Ordinary typecheck: passed on Node 22.20.0.
- Incremental compiler regression: 7 passed, 0 failed, 0 skipped.
- Complete moved heartbeat command: passed, including 10,001 actual accepted observations and independent inactive archive restore.
- Manifest parsing, identical command multiset, reusable-workflow permissions, source-lock freshness and staged diff checks: passed.
- First Services attempt: failed in the unchanged handoff credential-refusal table. Cold stock Kafka/PostgreSQL image setup consumed time after owner confirmation; later requests returned 403 step_up_required instead of the expected 400 handoff_credentials_forbidden. Storage stayed unchanged and credentials were not echoed. The actual product authority guard requires proof within five minutes. No guard or assertion was changed.
- One identical Services rerun with cached stock images: **failed: handoffBrowser expected HTTP 400, observed HTTP 403 after the credential-refusal table passed all 28 cases**. The refusal-case receipts retain both attempts. This manual diagnostic rerun adds no retry to the product verification plan.

Local initial runtime checks used an application build made before the configuration-only commit; all application and test bytes are identical on the candidate. Hosted Verify supplies the exact-SHA full-suite evidence.

## Exact-SHA hosted results

| Job | Conclusion | Elapsed | Job ID |
| --- | --- | ---: | ---: |
| plan | success | 0m04s | 129248752875 |
| prewarm | success | 0m41s | 129248823589 |
| shards (analytical, true) | success | 7m27s | 129249249213 |
| shards (follow-up, true) | success | 10m09s | 129249249231 |
| shards (ingest, true) | success | 5m11s | 129249249297 |
| shards (migration, true) | success | 7m10s | 129249249344 |
| shards (runtime, true) | success | 10m39s | 129249249345 |
| shards (network, true) | cancelled | 12m08s | 129249249405 |
| shards (traces, true) | success | 7m44s | 129249249444 |
| shards (dashboards, true) | success | 8m46s | 129249249451 |
| shards (source, true) | cancelled | 12m16s | 129249249475 |
| shards (exports, true) | success | 8m50s | 129249249477 |
| shards (typecheck, true) | success | 5m55s | 129249249555 |
| verify | failure | 0m03s | 129256566945 |

The completed run and job receipts are in ci-receipt.json. No run from another SHA substitutes for this candidate. Source (12m16s) and network (12m08s) reached the unchanged twelve-minute job limit, so the brief's one-time rerun for unrelated cancellations did not apply. Neither cancelled job was rerun. GitHub budget used: 10/10 calls, including historical diagnosis. Candidate status polling used one watcher and waited at least 300 seconds between run reads. The first candidate discovery had a task-side JSON redaction formatting error in later URL fields; its leading run ID, branch, SHA, event and status were intact. The same watcher resumed from those fields without another API discovery. The formatter was repaired outside the product tree.

## Blocking result and remaining work

The typecheck goal is met at 5m55s, but the overall Verify is cancelled and its aggregate job failed. Source and network both exhausted the unchanged twelve-minute limit. No READY claim is made.

Source completed ordinary checks, reader installation and standard clients, then spent 303.240s on the native standard-read journey and 306.201s on the analytical standard-read journey. It started the complete pipelines command at 15:28:27.985Z and was cancelled at 15:29:40.822Z. These three complete journeys still need further redistribution or demonstrated fixture-overhead reduction across shorter jobs.

Network's job ran 12m08s. Its one log archive command, `gh run view 42643013003 --repo just-every/run-porthole --job 129249249405 --log`, failed with `EOF`, with no HTTP status or response body supplied. Only a truncated source-lock preamble arrived; it contains no runtime timing lines. The archive was not retried and no direct blob redirects were attempted. Its runtime bottleneck remains undiagnosed.

The ten-call GitHub budget is exhausted after the two completed-job diagnostics. The brief asks for a BLOCKED outcome when its once-pushed exact-SHA Verify is not green. The pushed fix is preserved; further source/network work and a fresh exact-SHA Verify are needed. All assertions, tests, shard timeouts and clause judgments remain intact. The two local Services failures are retained as validation limitations; the exact-SHA hosted typecheck shard did pass those complete Services assertions.

## Publication and handoff

The product push guard printed PUSH_OK on attempt 1. An independent git ls-remote read confirmed `2564d7a4afad755896962b96d21f2385e1c866e0` at the named product branch. The shell wrapper reported a nonzero exit after successful push output; remote verification establishes actual custody. All 16 candidate commits, including side parents, passed author/committer and trailer checks before push and again in the pre-push hook. No published history was rewritten.

Main remained `f51e701475918613fee00845d1bef56fe49517b7` at the final fetch and was already an ancestor. No merge/rebase was needed. No main/default-branch push, landing, PR or deployment was performed. The named branch is preserved for the lane; this BLOCKED result is not a landing candidate. Product custody and report publication are independent: this explicit non-secret packet is published only on evidence/sx-porthole-shard-time-2, with its exact evidence ref/head returned in the terminal message.

The complete executed plan is [PLAN.md](PLAN.md). Actual receipts include historical runs and command timings, the historical scheduling diff, the candidate product patch, scheduling/source checks, both Services refusal results, local check outcomes, identity audit, product remote custody and candidate CI timing. No credentials, environment dumps, private held-out material or symlinks are selected.
