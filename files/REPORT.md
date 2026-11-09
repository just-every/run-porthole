# sx-porthole-f460fix1 · Blocking A

Repository: just-every/run-porthole. Product branch: cloud/sx-porthole-f460fix1.
Product HEAD: a4b8bed320f94b9bbeb1b0e1d21b232fb6b4c9ed. Product tree: e728909e1e87a0bd528edb2fd78f2b45e1fd8d0b.
Started from: d28c08eb267b14c0ec0008349fef31e6149fef34.
Merged main: 4a86b252865d95d341e2a54d5b5b88e98c40bdd4. PR: none; branch custody is for the fleet lander.

## Result

Fixed the UUID-only handover archive decision validator for database sources. The database source configuration API already stores `[a-zA-Z0-9_-]{1,80}`; portable `database-source:` decisions now accept exactly that identifier grammar. Other decision types and the rest of semantic validation are unchanged.

The existing handover journey retains its UUID case and adds `local-postgresql`, a mixed-case identifier with an underscore, and an 80-character identifier. Its original assertion still proves every held source row and enabled collection field remain unchanged after removal. One added substantive assertion reads the real archive chunk door and verifies that every source identifier survives in the portable handover history. Existing inactive restore and re-export assertions additionally retain those decisions without reviving authority. No test or assertion was removed, weakened or skipped.

Before: the original emitted product at d28c08eb, with the extended journey, failed GET `/api/porthole/v1/archive/exports/<job>/chunks/<index>` with HTTP 422 `archive_semantics_invalid`, where 200 was required. See `before-handover.json` and `before-handover.log`.

After: the same focused emitted-Worker journey passed, so archive chunks returned 200 and all four source identifier forms were retained in handover history. The complete focused journey also passed after merging main, including source retention, successor refusal, removal, browser states, restart, inactive restore and re-export. See `after-handover.json` and `merged-handover.json` with their full logs.

## Plan and execution

1. Configured fleet identity before repository work, refreshed the fleet launcher, installed the decrypted-bundle Git helper and push guard, and installed the fleet commit hook with repository hooks preserved. Used a fresh full-history clone and the named branch at the required starting SHA.
2. Read the supplied builder rules, launcher/repository AGENTS.md and relevant contract/archive/handover code. Retrieved the prior report from the same repository's evidence ref solely to preserve the original claim exactly.
3. Extended the existing journey and reproduced the public-door failure before changing the validator. Changed one validator line and regenerated the source lock last.
4. Ran the focused handover journey, build, typecheck, first-party check, contract write/check, and source lock/check. Restored main's generated views after regeneration; no contract judgment or generated view is committed.
5. Fetched newer main before publication. It advanced during the first local run. Preserved the completed fix in a patch outside the clone, merged main cleanly without a commit, reapplied that patch and regenerated the lock last. Repeated build, typecheck, contract/lock checks and the complete focused handover journey on the combined tree. Main's CONTRACT.md and views won whole. ID-MAP.json is absent on both main and the candidate. Main's highest migration is 0062, so existing candidate migration 0063 remains above it with no renumbering needed.
6. Committed the combined candidate using explicit fleet author/committer environment variables and active hooks. Checked every candidate identity/trailer including side parents before the guarded branch push. Product evidence is kept outside product commits. No main/default push, force push, PR, deployment, publication scan, Docker or Services journey was performed.
7. Observed exact-SHA Verify by REST with one watcher, a 300-second minimum interval and a ten-call ceiling. Actual API responses are retained in `github-calls.json`; terminal observation is in `ci.json`. Reports are published separately to the evidence ref and never establish landing.

## Counts and clause status

Contract before: {"done": 10, "missing": 69, "partial": 20, "total": 99}.
Contract after: {"done": 10, "missing": 69, "partial": 20, "total": 99}.
PORT-091 remains missing in CONTRACT.md. Status, Gap and Evidence cells are unchanged. Original builder claim remains PARTIAL, points=none. No additional acceptance point or completion claim is made.

Existing source fixtures: 1 → 4 identifier forms within one existing journey. Added test registrations: 0. Added substantive regression assertions: 1. Deleted or weakened assertions: 0. The same focused journey fails before the fix and passes after it; no cap increase was requested.

CLAIM PORT-091 PARTIAL points=none tests=tests/porthole/handover.mjs#handoverJourney; tests/porthole/membership.mjs#membershipJourney; tests/porthole/archive.mjs#handoverArchiveJourney

DEFAULT PORT-091: Retain the builder's existing conservative native scope and owner-only domain boundaries; this FIX changes only accepted database source identifiers in inert handover archive validation.
GAP PORT-091: The builder's existing held and unproved remainder is unchanged; this FIX makes no new completion claim.

## Actual local receipts

| Check | Exit | Seconds | Complete log |
| --- | --- | --- | --- |
| before-handover | 1 | not recorded | `before-handover.log` |
| after-build | 0 | 6.35 | `after-build.log` |
| after-typecheck | 0 | 6.37 | `after-typecheck.log` |
| after-handover | 0 | 208.39 | `after-handover.log` |
| first-party | 0 | 1.14 | `first-party.log` |
| contract-write | 0 | 0.07 | `contract-write.log` |
| contract-check | 0 | 0.08 | `contract-check.log` |
| source-lock | 0 | 0.53 | `source-lock.log` |
| source-check | 0 | 0.52 | `source-check.log` |
| merged-build | 0 | 6.58 | `merged-build.log` |
| merged-typecheck | 0 | 2.67 | `merged-typecheck.log` |
| merged-handover | 0 | 209.09 | `merged-handover.log` |
| merged-contract-write | 0 | 0.08 | `merged-contract-write.log` |
| merged-contract-check | 0 | 0.08 | `merged-contract-check.log` |
| merged-source-lock | 0 | 0.59 | `merged-source-lock.log` |
| merged-source-check | 0 | 0.55 | `merged-source-check.log` |

The before failure is intentional regression evidence. Initial and merged local commands ran before the final merge commit existed; their receipts state the actual base HEAD and exact file hashes. `merge-context.json` binds the combined staged tree to the final product tree, and `product-receipt.json` verifies that those bytes match the terminal commit. Local receipts are distinct from exact-SHA CI and landing.

## CI and custody

Verify run: 42539499708. Status: completed. Conclusion: cancelled.
Exact observed SHA: a4b8bed320f94b9bbeb1b0e1d21b232fb6b4c9ed. URL: https://github.com/just-every/run-porthole/actions/runs/42539499708.
GitHub calls used: 6/10.

Ten of eleven shards succeeded. Analytical job 128911084846 was cancelled between 00:19:00Z and 00:31:16Z (12 minutes 16 seconds). Aggregate job 128914505351 failed its `Require every shard` step because not every shard succeeded. The job results do not identify a failed product assertion. The cancelled analytical run is outside this archive-validator FIX; its cancellation reason is not established solely by the job timestamps. Full job results are in `ci-jobs.json`; the single required failed-job archive invocation and its actual result are in `ci-failed-log.json` and `ci-verify-failed.log`.
Product push: successful; see `product-push.log`. Identity inspection: see `identities.log`. Completed-job detail, when available, is retained in `ci-jobs.json`.
Blockers: Required Verify completed/cancelled on this exact SHA. No exact-SHA success is available; rerunning a SHA that already has a run is prohibited by the supplied rules.

This packet contains explicitly selected non-secret reports and actual receipts. Private installer state, credentials, environment dumps and held gate material are excluded. Product custody, evidence transfer, independent gate acceptance and landing are separate.

## Failed-job archive receipt

Command: `gh run view 42539499708 --repo just-every/run-porthole --job 128914505351 --log-failed`. Exit: 0.

The archive log is retained in `ci-verify-failed.log`; the aggregate shell check reports that every shard must succeed.
