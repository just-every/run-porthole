# sx-porthole-shard-time-1 — Verify shard timing repair

Final repository: just-every/run-porthole. Final product branch: cloud/sx-porthole-shard-time-1. Final pushed SHA: bb8d1e70d3a4c5ced856773fa2d6ab25939fdbb2. Product checkout is clean. No PR is required by the supplied landing rules; the fleet owns landing and the publication scan.

The final candidate is PUSHED, not READY. Its exact-SHA Verify was not observed because the ten-call GitHub budget was exhausted. Do not transfer the prior candidate's green result to this SHA. The fleet must check the final exact-SHA run before landing.

## Result and qualification

The first repair, f4294d59a12a45667efc788c6a7f63f80bfd46f7, passed exact-SHA Verify 42631085363 on its first attempt, including every shard. Typecheck fell from cancellation at 12m16s to a successful 8m12s. Exports completed in 11m12s; source, after receiving handover, completed in 11m35s. Thus cancellation was fixed, but exports remained above the requested ten-minute target and source had too little margin.

A final scheduling-only commit uses that measured headroom: move native backup/erasure from exports to follow-up (the first repair's follow-up job took 4m18s), move handover from source to ingest, and move pipelines from ingest to source. This keeps standard-reader setup and its Python/native client dependencies together, preserves browser installation for all moved journeys and balances both the receiving and donating shards. These final durations are estimates until hosted Verify runs; no final sub-ten-minute result is claimed.

## Implementation

The runtime harness already exposed sql.read using the actual running emitted Worker's D1 binding for handoff snapshots. General storage assertions and native-session fixture reads still launched Wrangler/Miniflare for each SELECT, including when the fixture wrapper hid sql.read. The repair routes SELECT observations through that existing live binding. Offline CLI writes, prior-schema migrations, storage-failure injections and every explicit stop/restart remain. Disposal clears the worker reference so queries in offline restart callbacks use the offline path. No database fake, product response substitution or assertion change was introduced.

Final command moves relative to the requested starting candidate:

- Fleet: typecheck to traces.
- Host-heartbeat: exports to typecheck.
- Handover: typecheck to ingest.
- Pipelines: ingest to source; source now declares browser=true.
- Native backup/erasure: exports to follow-up.

The complete multiset of push commands is unchanged. Build sharing, hosted checks, timeout values and nightly classification are unchanged. Only tests/runtime.mjs, verification.json and sources.lock.json changed in the product. The source lock was regenerated last and its check passed after each final staging.

## Evidence and counts

All 48 push command entries are retained, with identical multiplicities. All 4,205 tracked JavaScript/TypeScript assertion call sites are retained. Assertion sites are not a logical test count. Zero tests, registrations or assertions were added, removed, skipped or weakened; no cap increase was requested. The inherited plan has eleven shards before and after; this scoped repair adds none. All clause judgments, including PORT-060, remain unchanged. No CONTRACT.md Status/Gap/Evidence or generated contract view edits were made.

Actual receipts include the successful prior candidate's run and jobs, per-shard before/after timings, initial cancelled-job timing extracts, local focused journey logs, final static/lock checks and final product custody. local-receipt.json records tests run on the first repair's final runtime source, which is identical in the final candidate. final-local-receipt.json records the final scheduling checks. ci-receipt.json records the final unobserved qualification separately from qualified-candidate-ci-receipt.json.

## Validation

Syntax, reusable workflow permissions, matrix generation, unchanged command/assertion inventories and typecheck passed. Fresh-clone typecheck initially needed generated routes; setup generated them and the subsequent typecheck passed. Focused handover and erasure journeys passed through the real emitted Worker, including native access refusals, no-write checks, offline fixture writes, restarts and independent inactive archive restore. The first erasure run reached browser proof but lacked Playwright's downloaded executable; a local adapter outside the product tree then launched /usr/bin/chromium with --no-sandbox, and the retry passed. No product or assertion was changed for this adaptation. Local Node was 24.19.0; hosted Verify used its pinned Node 22.20.0.

Full local Verify and publication scans were not run, as instructed. No credentials, environment dumps, unfiltered workflow logs or held-out gate material are selected for evidence publication. Unfiltered diagnostic logs remain outside this packet in local-debug.

## Custody and limits

A fresh full-history clone started at 0753f87d72f2377f16ea3c4ba1256b002b7c51b5. origin/main f51e701 was already an ancestor; required merges before both pushes were no-ops. All fifteen candidate commits, including side parents, passed independent allowed-name/email/trailer checks. Active fleet hooks were retained. Both product pushes succeeded on their first guarded transport attempt, without force or published-history rewrites. No push rejection or rescue bundle was needed.

The remaining qualification is the final exact-SHA hosted Verify and its measured shard times. The API budget is fully accounted for in github-usage.json. No real red check or external ruling blocks the final candidate; its CI result is simply unobserved. A PUSHED custody line is used accordingly. The full plan is in PLAN.md, and the complete selected packet is published only on evidence/sx-porthole-shard-time-1.
