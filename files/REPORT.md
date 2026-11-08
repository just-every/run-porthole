# sx-porthole-f268fix1 result

Only BLOCKING A (f260 #3) is addressed. The SQL tokenizer now keeps a redaction atom and its contiguous identifier suffix/prefix together, so safe stored SQL stays byte-stable during archive semantic rechecks. Literal/comment/bind stripping and the archive recheck remain enabled.

## Provenance and scope

Repository: just-every/run-porthole. Branch: cloud/sx-porthole-f268fix1.
Starting candidate: 200e231217648e8d28a18fd57161d23b73f84ab7.
Merged main: cd7863ba62bcc0a996d7b1eecbcd89ce592783a8.
Merge save: ef86f415590a2be648522ee6aca2d80512ab503d (skip CI); fix: 60c706e5a2db5024f19ac46bc8f75ada06411e15.
The required merge preserves main's newer services implementation and tests and takes main's entire CONTRACT.md. Main's contract generator was run for PORT-016 and passed, and ACCEPTANCE.md/docs/CLAIMS.md were restored from main. The fix changes only SQL tokenization, the existing stock workload, one existing journey assertion, and the generated source lock. No publication scan, Base refresh, redesign, release, status promotion, or acceptance continuation was performed.

## Exact trigger before and after

Owner activates redaction pattern private_tenant and submits SELECT count(*) FROM private_tenant_orders WHERE customer = ? through each public intake. Each run uses a fresh real emitted Worker and migrated D1, native owner authentication, pipeline preview/activation, scoped credential, public drain and public installation export. These isolated probes use declared synthetic database/OTLP request fixtures; they do not claim real producer provenance. The committed database journey separately uses actual PostgreSQL/MySQL and unmodified official instrumentation/exporter.

| Input | Door | Before chunk / manifest | After chunk / manifest |
| --- | --- | --- | --- |
| private_tenant_orders | database capture | 422 archive_database_content_not_redacted / 409 | all 200 / 200 |
| private_tenant_orders | OTLP traces | 422 archive_database_content_not_redacted / 409 | all 200 / 200 |
| private_tenant (whole-token control) | database capture | all 200 / 200 | all 200 / 200 |
| private_tenant (whole-token control) | OTLP traces | all 200 / 200 | all 200 / 200 |

Before, the stored sample contained [REDACTED]_orders but fingerprint revalidation inserted a space before _orders. After, the stored safe sample is unchanged. The exact complete request/receipt and sanitized stored payloads are in before.json and after.json; trigger-probe.mjs is the executed probe source.

## Test and contract accounting

The FIX adds exactly one regression assertion to tests/porthole/database.mjs#databaseJourney and adds the matching real alias query to its existing stock SQL workload. All existing assertions remain, including whole-token masks, mandatory password masks, ambiguous quoting, erasure/replay refusal and archive restore/re-export. No registrations are added (delta 0); regression assertion delta +1.

Starting candidate summary: 10 done, 20 partial, 68 missing, 98 total. Required main merge summary and final: 10 done, 20 partial, 69 missing, 99 total. PORT-016 on the starting candidate was partial; main's newer whole row is missing and is preserved unchanged. No Status, Gap or Evidence cell was edited by the FIX; neither generated view differs from main. The isolated partial-mask probe failures drop from 2 to 0, with both whole-token controls still passing.

CLAIM PORT-016 PARTIAL points=3 tests=tests/porthole/database.mjs#databaseJourney; tests/porthole/archive.mjs#databaseArchiveJourney
DEFAULT PORT-016: Follow the supplied narrow FIX scope and retain main's entire contract judgment; make no DONE claim.
GAP PORT-016: The complete clause remains subject to its existing main judgment and the lander's independent frozen-rubric gate. This round establishes only the named masking/export correction and regressions.

## Validation

Setup, build, typecheck, public API schema freshness, source-lock regeneration/check, contract generator write/check and all four before/after probe cases completed successfully. Full local Verify was intentionally not run; branch Verify is the full wall. Runtime browser commands use /usr/bin/chromium with --no-sandbox. This is not a UI change.

The touched database runtime journey passed (exit 0), including real PostgreSQL/MySQL native statistics and plans, blocking chains, stock traces, all existing f260 literal/redaction and erased replay refusals, both analytical copies, native installation archive export/import/re-export, and partial-mask product archive restore/re-export. The complete actual output is database.log.
Exact-SHA Verify completed SUCCESS: run 42481564286, https://github.com/just-every/run-porthole/actions/runs/42481564286, head 60c706e5a2db5024f19ac46bc8f75ada06411e15. REST discovery and three observations used four GitHub calls, each observation at least 300 seconds apart. The final receipt is ci-status-4.json; all observations and the call ledger are included. The branch advertises this exact tested commit. No PR was created; this assignment returns the named branch to the fleet. Blockers: none. The independent frozen-rubric gate remains with the fleet; this result makes no DONE claim.

## Plan executed

# sx-porthole-f268fix1 plan

Scope: BLOCKING A only: f260 #3 safe database telemetry must survive installation export with owner mask private_tenant applied inside private_tenant_orders. No status promotion, campaign continuation, publication scan, or release.

1. Start at full-history 200e231217648e8d28a18fd57161d23b73f84ab7 and merge current main; retain main's full CONTRACT.md and newer tests and services behavior. Regenerate PORT-016 contract views for validation, restore main's views, regenerate source lock. Preserve merge as a skip-CI product save.
2. Probe whole-token and partial-token masks through public database-capture and OTLP intake, then public installation export chunks and manifest, before changes. Use synthetic request fixtures and real emitted Worker/D1, without claiming production telemetry evidence.
3. Make SQL fingerprint tokenization preserve a mask and contiguous identifier characters as one token, preserving mandatory literal redaction and archive validation. Extend the existing real database workload with a partial-identifier alias and add one assertion to the existing database journey; retain every original assertion and journey.
4. Commit the narrow change, build via rer, rerun the same trigger probe, run typecheck and the touched database journey with real PostgreSQL/MySQL and stock instrumentation. Existing database journey covers masking, f260 literal redaction and replay refusal, restore/re-export and regressions.
5. Regenerate source lock last, inspect every candidate commit identity/trailer, push only cloud/sx-porthole-f268fix1 through the fleet guard, and obtain exact-SHA Verify through REST (one watcher, calls at least 300 seconds apart per run, ten-call ceiling).
6. Save complete non-secret results/receipts in this packet, publish explicitly selected files through evidence/sx-porthole-f268fix1, and relay terminal provenance and lane POST. No DONE claim or contract status/evidence/gap edits.

## Terminal product custody

READY branch=cloud/sx-porthole-f268fix1 head=60c706e5a2db5024f19ac46bc8f75ada06411e15

Evidence publication is separate report transport; it is not acceptance or landing.
