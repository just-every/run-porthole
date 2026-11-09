# sx-porthole-f461fix1: credential refusal FIX round

Repository: just-every/run-porthole
Branch: cloud/sx-porthole-f461fix1
Product candidate: 07a6af131788ac851a58d9d824ff8f128276e426
Starting candidate: e2cfaedd2f158ea90c0f0176b9ea43fcee0fdffa
Merged main: 85b79464fa8a79597741711f6689f1b21132cd89
Save commit: 61ddb72549674a7529546fcf7ca3f17932f395fd
PR: none; this repository has a branch-push Verify entrypoint and no PR-only landing requirement.

## Existing builder claim, retained verbatim

CLAIM PORT-054 PARTIAL points=1,3 tests=tests/porthole/handoffs.mjs#handoffJourney; tests/porthole/handoffs.mjs#routeInventory; tests/porthole/archive.mjs#servicesArchiveJourney; tests/porthole/public-docs.mjs#publicDocsJourney

GAP PORT-054: The telemetry-cost half of the packet awaits PORT-023 and the PORT-038 rate-card hold. Deployment and queue record handoffs await PORT-022 and PORT-060. Authorized estate and provider comparison, Evidence-side requests, adapter lifecycle, Base discovery, custody and retention holds remain unchanged. No DONE claim.

## Scope and implementation

Only BLOCKING B from sx-porthole-c-f461-gate-1 is addressed. The destination validator now refuses Azure SAS sig and the registry's credential family, including token, bare key, secret, signature, userinfo, case variants and nested percent encoding. Both the destination and optional template use the shared detector. Refusal is HTTP 400 handoff_credentials_forbidden without the submitted value.

Live registry reads validate stored rows again. Unsafe legacy declarations retain their revision for owner replacement but expose neither URL field and supply no active links. This covers the owner and restricted-contractor registry, Help, Integrations, Settings and service surfaces. Resolved service links are validated after substitution. Fresh archive chunks already use the same semantic validator; cached archive chunks now revalidate handoff rows, and native archive export refuses credential-bearing handoff rows through its configured policy hook.

The merge preserves main's routes, assertions and schema additions together with the existing handoff implementation. Main's CONTRACT.md and generated views remain whole. Main has no docs/contract/ID-MAP.json. Main's 0063 migration is retained and the three candidate migrations are renamed 0064, 0065 and 0066. The API artifact is regenerated after combining both path registries. No Status, Gap or Evidence cell changed, and neither ACCEPTANCE.md nor docs/CLAIMS.md is committed by this round.

## Plan and execution

The complete plan is in PLAN.md. Fleet Git identity, decrypted-bundle helper, push guard, local hooks and pinned toolchain setup were installed. The merge save was pushed through cloud-push.py. The focused regression is one aggregate assertion inside the existing tests/porthole/handoffs.mjs file; handoffJourney calls it and the external probe executes that same function against the emitted Worker. No existing test or assertion was removed or weakened; no new registration was added.

The focused probe uses real local D1 migrations, the emitted Worker, native owner and restricted-contractor sign-in doors, a scoped ingest credential, native OTLP HTTP intake and real service records. Fixtures are synthetic. There are no fake registry responses and no Docker dependency in this proof.

An initial PORTHOLE_SERVICES_ONLY run was stopped with exit 130 when its existing service estate invoked Docker. I missed that dependency before starting it. Its launched processes were terminated, and it is not reported as passing evidence. All subsequent local proof uses the focused Worker/D1 harness. No publication scan, full local Verify, main push, force push or deployment was run.

## Before proof

before-receipt.json records all 28 write attempts and 66 actual legacy reads against the pre-fix merged source tree committed as 61ddb72549674a7529546fcf7ca3f17932f395fd. The baseline build was emitted by setup before that merge commit was created; it is behavioral before-proof, not an exact-SHA baseline build receipt. The after build and browser proof are on the exact final candidate. The regression failed as expected. Twelve writes were accepted (HTTP 201), sixteen were refused, and 42 of 66 reads exposed the synthetic credential marker. Each of sig, %73ig and SIG was accepted in both destination and template; each exposed the marker on seven owner/restricted read surfaces. Those reads returned HTTP 200.

## Validation and counts

Build, typecheck, public-schema freshness, touched PORT-054 contract generation/check and source-lock freshness pass. Generated views and CONTRACT.md are restored from main after generation. The lock was generated last after staging changed sources. archive-policy-receipt.json records 24 direct configured-policy-hook refusals without echo and a preserved safe URL with an empty template; this is a policy-hook smoke, not a complete native CLI export.

Counts before and after: 10 DONE, 20 PARTIAL, 69 MISSING, 99 clauses. PORT-054 remains MISSING in the checked-in contract, with the existing builder PARTIAL claim above preserved. Regression assertion delta: +1; registration delta: 0; existing assertions weakened or removed: 0.

This is a security validation change with no UI creation or layout changes. The focused HTTP proof checks the rendered owner and restricted pages for disclosure. An additional browser proof on the exact candidate uses Chromium at /usr/bin/chromium with --no-sandbox, asserts the absence of a seeded legacy credential at 1440, and captures owner handoff Settings and restricted-contractor Help once at 1440 and 390. browser-receipt.json and its four PNGs record this proof. Existing browser journeys remain intact for CI.

## Custody

Product publication and report publication are separate. The packet contains no credentials, environment dump or private held-out gate material. Evidence will be published only to refs/heads/evidence/sx-porthole-f461fix1 with the task-side report-only entrypoint. The independent gate and Mac lander own acceptance and landing. No other clause or held dependency is advanced.

## After proof

after-receipt.json records the same probe on 07a6af131788ac851a58d9d824ff8f128276e426: exit 0. All 28 writes refuse with HTTP 400 handoff_credentials_forbidden, no response echoes the marker, and all refused writes preserve registry storage. All 66 owner/restricted reads return HTTP 200 without exposing the legacy credential marker. The six named SAS destination/template cases change from HTTP 201 to HTTP 400. Exposing reads change from 42/66 to 0/66. No acceptance status changes.

## Initial CI failure and required merge repair

Verify 42559157780 on aae559bd25c456dd069dadc511a8654fa65eb7bb failed. Source job 128971553803 failed while the official trace protobuf reader decoded capture-1.pb from the shared stock service fixture: the candidate's new log exporter had added log packets to main's trace-only capture loop. This is a merge interaction. The source contract generator check had passed; this is not the generated-view exception. The typecheck job 128971553763 was cancelled at 04:10:00 after its credential matrix had passed at 04:07:58. All other shard jobs succeeded. The aggregate verify job then failed.

The fixture now defaults to its original trace-only stream; the handoff/services journey explicitly opts into logs. No trace, log or other assertion was removed or weakened. The credential regression reuses its initial clean storage snapshot but still compares actual storage after every case, and cleans up only unexpectedly accepted baseline writes. It retains all 28 cases, 66 read checks and one aggregate assertion while avoiding redundant Wrangler subprocesses.

The repair is e4d2f871df5494c69221c2d50be81a0c94b107b3. Build, typecheck, syntax checks, source-lock check, the unchanged credential matrix and the 1440/390 browser proof pass again. after-initial-receipt.json and ci-initial-receipt.json retain the first candidate's actual results; after-receipt.json and browser-receipt.json name the final head.

GitHub calls used before the final watched candidate: 7 (four run discovery/status calls, one jobs listing, one failed-source-job archive log, and one cancelled-typecheck-job archive log). The final watcher reserves its remaining three calls for discovery/status at five-minute intervals, starting five minutes after push. No workflow rerun or dispatch was requested for a SHA that already had a run.

## Final integration

The cancelled shard's run window also justified removing CLI startup from handoff storage snapshots. Commit 0e83e14c9d58e2e82cf82c4b8d5715fdf8b89c57 supplies an optional snapshot read using the emitted Worker's actual D1 binding. The identical SQL and every per-case mutation/read assertion remain; synthetic mutation setup keeps the existing Wrangler path. The focused probe exercises the live-binding snapshot path successfully. No mock database or skipped case is introduced.

Main then advanced with newer standard-read and inactive-restore qualification. The final merge retains all of those assertions and documentation, main's contract and generated views whole, and regenerates the lock last. No additional migration renumbering is needed: main's highest remains 0063 and the candidate's migrations remain 0064–0066. The final merge head is 07a6af131788ac851a58d9d824ff8f128276e426. Its build, typecheck, schema/source checks, 28-case/66-read proof and 1440/390 screenshots pass. The interim e4d2f8 watcher was stopped before its first API call; the global API budget remains seven calls used before the final watcher.

## Final-head CI watch

Verify 42561706552 is the final-head run: https://github.com/just-every/run-porthole/actions/runs/42561706552. Its first scheduled discovery reports in_progress on 07a6af131788ac851a58d9d824ff8f128276e426. The global call count is eight; two calls remain. No READY claim is made while it is in progress.

## Terminal outcome: BLOCKED on required CI

Product branch cloud/sx-porthole-f461fix1 is pushed at 07a6af131788ac851a58d9d824ff8f128276e426, and the remote ref was verified. Final Verify 42561706552 completed with conclusion cancelled on that exact SHA at the tenth permitted GitHub call. This is not success and is not the generated-view exception. The cancellation reason has not been established within the allowed API budget. No additional GitHub API call, same-SHA rerun/dispatch, empty CI-trigger commit or main push is made.

The local implementation checks, 28 write refusals, 66 disclosure-free reads and owner/contractor browser proof pass on the final head. The initial failing source fixture interaction was repaired without deleting or weakening assertions. All product work is committed and pushed; no product changes remain unpublished. The plan is complete through implementation, local verification and product/report publication; required exact-SHA green CI remains unresolved and is the sole terminal blocker. No PR was created or required.

Contract counts remain 10 DONE, 20 PARTIAL, 69 MISSING, 99 total. PORT-054's Status, Gap and Evidence cells are unchanged; its existing PARTIAL builder claim is retained verbatim above. The fleet owns independent gate, publication scan and landing. This run emits no READY signal and does not claim acceptance or landing.
