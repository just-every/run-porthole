# sx-porthole-f466fix1 — network replay quota

Product repository: just-every/run-porthole. Branch: cloud/sx-porthole-f466fix1.
Product head: 9eff8deeb6a3ad54781dff817213b08c3e12d033.
Merge parents: d77a80daa5c1b4a608839d079ccc20ca28ecc7c9 and f51e701475918613fee00845d1bef56fe49517b7.
PR: none created; the fleet owns landing. No main/default branch push or force push.

## Finding and fix

The failing statement is the POST replay loop after `restartWorker()` in `tests/porthole/network.mjs` (line 125 on the supplied parent). It is not an owner-session drain refusal. The earlier estate captures ongoing stock Collector exports across baseline, delay, loss, backlog, restored consumers, application failures, and eight permission removal/restoration windows. Those minutes of traffic are replayed without their original pacing after restart. The analytical journey also reuses the retained packets and replays them at intake speed.

The PORT-060 diff does not change `src/porthole/credentials/verify.ts`, `policy.ts` or the intake store's quota reservation/key. Each successful intake authentication reserves one request and its original wire bytes before duplicate recognition in the same fenced transaction. Duplicate delivery must still spend intake quota; batching or retained-record count does not erase request cost. Defaults remain 600 requests/minute and 10 MiB/minute. This explains why a replay can legitimately hit the default quota even though the original paced collection succeeds.

The fixture now mints its same scoped ingest credential with an explicit finite burst budget: 10,000 requests/minute and 64 MiB/minute. Production quota policy, limiter key, SQL fences, auth, custody, and deduplication are unchanged. This applies to original collection, restart replay, retained analytical replay, erasure replay, and revocation checks without changing any expected response.

All 53 lines containing assertions in network.mjs are byte-for-byte identical after trimming to the supplied d77a80d parent. No assertion, registration or journey was deleted, skipped or weakened. This round adds no committed test registration; it extends the existing network journey fixture.

## Main integration

Main's complete CONTRACT.md and generated ACCEPTANCE.md/docs/CLAIMS.md were retained. Conflicts in Services read/page combine network evidence with main's neighboring-product handoff data/UI. Runtime entrypoint keeps both network and fleet/collector-install routes and main's Services route inventory and analytical proof. CI retains main's Services/fleet placement; network occupies the existing mail-receipts slot and its mail/archive commands are retained in exports. The supplied isolated handover proof is retained in typecheck. No main assertion was removed. Main's migrations through 0067 are retained; this branch adds no competing migration requiring renumbering. No separate ID-MAP file exists in the repository.

## Clause scope and counts

No CONTRACT.md Status/Gap/Evidence text, homepage claim, or CLAIM scope was edited. The supplied builder's PORT-060 claim remains PARTIAL; this is a one-defect repair and does not promote it to DONE. Main's actual contract source still records PORT-060 as missing; the required whole-main contract resolution preserves that judgment for the lander. Do not confuse the builder claim with that source status.

Main before/after counts are identical: 10 done, 20 partial, 69 missing, 99 total (published: 1/0/0; target/push-further: 9/20/69). Network assertion-bearing lines: 53 before, 53 after, exact unchanged. No new test registrations in this repair. Remaining PORT-060 gaps and claim points are unchanged.

## Local validation and limits

The required cloud toolchain was sourced. Setup via `cloud_run npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --non-interactive` exited 0 and built the real Worker. No browser/dev server remains running from this task. Local Node was 24.19.0 under the supplied minimum-pin shim; hosted CI pins application Node 22.20.0. No application version pin was changed.

Syntax checks for the merged runtime and network journey passed; typecheck passed; generated public schema check passed. The touched PORT-060 contract adapter write/check both passed, then generated views were restored whole from main. The source lock was regenerated last and checked successfully. The final committed contract and generated views are identical to origin/main. Staged whitespace check passed. Actual command results and output hashes are in local-receipt.json.

Focused quota probe: a real emitted Worker with native schema/owner setup mints two credentials through the public credential door. It seeds 599 previously spent requests into each current minute to represent earlier fixture traffic, then sends the identical OTLP batch twice through `/v1/logs`. The ordinary 600-request credential returns 200 then 429 (OTLP code 8, credential_quota_exceeded, positive Retry-After); usage remains 600 requests. The fixture budget returns 200 twice and usage reaches 601. Both retain exactly one source batch. Both minute byte totals are far below 10 MiB, isolating the request quota as sufficient to reproduce the refusal. See quota-receipt.json and quota-probe.mjs. An initial diagnostic expected the generic JSON error shape; the probe was corrected to assert the actual OTLP error envelope before the final passing run. No product assertion changed.

No full local Verify, local netem estate or publication scan was run, per this task's scope. Hosted Verify is the required stock network proof. No UI change was authored in the repair; required inherited network/Services journeys remain in hosted Verify.

## Custody and hosted CI

The first real merge/fix commit was pushed immediately through cloud-push.py; first attempt succeeded. Full-history checkout; no rewrite of published history. All 11 candidate commits including side parents have fleet author and committer identities and no co-author trailers. Sources.lock.json is committed. The checkout is clean.

Exact-SHA Verify discovered as run 42616107194: https://github.com/just-every/run-porthole/actions/runs/42616107194 . Final status: completed / failure on the exact product head. One watcher uses REST with at least 300 seconds between polls and a ten-call budget including failures/log/archive commands. The discovery and first two polls (three calls total) still reported in progress; no log/archive reads or reruns have been used. Final status and all actual polls are in ci-state.json. Evidence transport is separate from product custody and publishes only the explicitly selected packet files to evidence/sx-porthole-f466fix1.

## Final hosted result and blocker

Verify run **42616107194**, product SHA **9eff8deeb6a3ad54781dff817213b08c3e12d033**, completed with **failure**. Six GitHub calls total: discovery; three status polls; one completed-run jobs read; one failed-network-job archive read. No rerun, dispatch, new product commit or extra push was used. The known traces address-in-use flake did not occur: traces passed.

Passing jobs: plan, prewarm, follow-up, ingest, runtime, traces, source, migration, analytical and dashboards. Network failed. Typecheck and exports were cancelled; the jobs metadata does not establish their cancellation reason, and neither is reported green. The aggregate verify job failed.

**The named quota assertion now passes in hosted CI.** Execution crossed the unchanged restart replay at parent line 125 (candidate line 129), completed the archive export/restore/restart/re-export proof, and logged `PROBE PORT-060 archive: real native export, inactive empty restore, restart and re-export -> identical same-window evidence; no source session or collection credential restored` at 2026-11-09T12:31:20.6110830Z.

It then exposed a distinct later assertion: the subject-erasure preview for `checkout-kafka` at candidate `tests/porthole/network.mjs:136` returned **409** with `{"error":"erasure_selection_too_large"}` instead of the unchanged expected 200. The existing implementation in `src/porthole/privacy/erasure/http.ts:70` deliberately refuses a matching selection exceeding 100 retained batches. This is not credential quota or missing local netem. The failure occurred after 608.509 seconds of the network runtime command; no full network/analytical success is claimed.

The brief limits this round to the credential quota defect and requires every assertion to remain as strong. Raising/removing the erasure door's product bound or replacing the full-service erasure assertion would broaden that scope. No such change was made. The lane needs a separate scoped resolution for this newly reached erasure-selection failure and the cancelled jobs before this branch can be READY. No contract status or builder claim promotion is requested.

Terminal custody: **BLOCKED**, with the product branch successfully pushed and all finished work preserved remotely. This is a real exact-SHA red-check blocker, not a push rejection. No recovery bundle was necessary. Full actual status is terminal-receipt.json; actual hosted windows, replay/archive progression and failure are in network-failure.txt. GitHub's command environment preamble was excluded from that selected log; the non-secret execution and complete assertion diagnostic remain. Full execution plan is PLAN.md.

