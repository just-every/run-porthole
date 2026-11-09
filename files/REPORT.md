# sx-porthole-f462fix1 results

Repository: just-every/run-porthole. Product branch: cloud/sx-porthole-f462fix1.
Product head: 79ab0f32d5464d1e61ad17498761d09eafabb2b5.
Base candidate: 843cefdeab89ace4ed4543f1ffdb55d0e22b3495.
Merged main: 85b79464fa8a79597741711f6689f1b21132cd89.
No PR was opened; this brief uses the fleet's branch landing path.

## Scope and implementation

Only blocking B was addressed: a transient fleet-report failure must not stop the Collector or terminate the foreground installer. CONTRACT.md, its Status/Gap/Evidence cells, and generated acceptance/claim views equal main. No clause judgment changed. Counts before and after are 10 done, 20 partial, 69 missing, 99 total. PORT-003 remains missing in the contract, with the builder's partial implementation claim retained verbatim below.

The installer classifies temporary HTTP and transport errors as retryable. The foreground observation loop remains alive, increments the observation sequence on each attempt, and leaves the independently running Collector alone. It retries indefinitely with exponential delay ceilings of 1, 2, 4, 8, 16 and 30 seconds and random jitter between half and all of each ceiling. Retry-After on 429/503 is a minimum, accepting both delta seconds and HTTP dates, including waits longer than the ordinary ceiling. Long waits are split into safe Node timer chunks. No backlog of report payloads accumulates.

Each report request has a ten-second absolute deadline, including its response body. Connection resets and timeouts retry. A lost acknowledgement followed by a sequence conflict also retries with a new observation. Permanent HTTP configuration/auth/scope errors and TLS configuration failures retain explicit sanitized error codes and may stop the installer. Malformed endpoint URLs produce https_origin_required. SIGINT/SIGTERM abort the active request or retry wait; normal explicit shutdown still stops the Collector and attempts a final stopped observation.

The existing file_storage volume now also backs the export queue, bounded to 100 queued export requests, with no elapsed-time expiry on retries. Telemetry export is independent of fleet reporting. The spool and offsets survive uninstall/restart. The bound is a request count, not unlimited retention or a losslessness claim under arbitrary outages; exhaustion can still lose telemetry and must remain visible.

## Before/after proof

Both CLI reproduction and real Collector runs use a local TLS fake fleet endpoint with a temporary test certificate. No Docker engine or container was used. The CLI command-boundary fixture supplies container inspection/lifecycle responses; it does not replace an application backend or claim an installed Docker environment. For telemetry proof, that fixture starts/stops the official host OpenTelemetry Collector Contrib 0.135.0 binary. Its exporter/retry/queue block is taken directly from the product configuration. Only host receiver paths, the local TLS endpoint and JSON wire encoding are adapted. Synthetic OTLP log records are sent through the real Collector during the report outage; the endpoint also refuses exports until report recovery.

The official archive came from https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.135.0/otelcol-contrib_0.135.0_linux_amd64.tar.gz, SHA-256 43132748eb0effb56b9d508ca789149684bf7ab6ade5d65cd0b22c4d265a30c0. This records the downloaded archive's hash; no separate signature qualification is claimed.

| Fault | Before active report attempts | Before records delivered | After active report attempts | After records delivered | After installer |
| --- | --- | --- | --- | --- | --- |
| HTTP 503 | 1 | 0 | 2 | 1 | Alive through delivery, then clean operator stop |
| HTTP 429 | 1 | 0 | 2 | 1 | Alive through delivery, then clean operator stop |
| Timeout | 1 | 0 | 2 | 1 | Alive through delivery, then clean operator stop |

Before: all three inputs were accepted by the real Collector during failure, but the installer exited 1 and stopped it, preventing recovery. After: all three were delivered exactly once after recovery with the same original nanosecond timestamp. The total recovered record count changes from 0/3 to 3/3. The independent CLI regression additionally proves connection-reset recovery, delta-seconds and HTTP-date Retry-After, explicit 400/401/403 refusal, malformed configuration, and clean operator shutdown. All eight rows pass under Node 22.20.0 on the exact product head.

One aggregate table-driven regression assertion was added to the existing tests/porthole/collector-install.mjs and invoked from its existing fleetJourney CI door. No existing test or assertion was removed, skipped or weakened. Regression assertion delta: +1; removed/weakened: 0. Test files added: 0. Real Docker/Services qualification is NOT RUN in this FIX round, as instructed. No UI was changed by this fix, so no new browser journey is claimed.

## Integration and checks

A fresh full-history clone began at the named candidate, then merged current main. Main's contract and generated views were retained whole. docs/contract/ID-MAP.json is absent on main. Independent fleet and handover archive/restore additions and their assertions were combined; main's newer standard-read and handover tests remain intact. Main owns migration 0063_porthole_handover.sql; the candidate fleet migration was renumbered to 0064_porthole_fleet.sql. No unrelated feature work was added.

The documented PORT-003 contract write and check passed before restoring ACCEPTANCE.md and docs/CLAIMS.md from main. A subsequent view-only mismatch is expected, and neither view was committed. The source lock was regenerated last after staging all source edits and its check passed. Typecheck, first-party profile, public schema, JavaScript syntax and whitespace checks passed. Setup/build completed through cloud_run with the pinned RER runtime and fleet owner. Initial setup attempts were refused while our own proof processes were active; those processes were stopped and setup completed. An initial typecheck lacked the generated route tree; the actual setup build generated it and the final typecheck passed. These temporary setup issues are resolved.

The product branch was pushed at the first real commit through the supplied cloud push guard. All six candidate commits, including side-parent ancestry, have fleet author and committer identity and no co-author trailers. Published history was not rewritten. No main/default-branch push or publication scan was run. Publication scanning and independent acceptance remain with the fleet lander/gate per the brief.

## CI custody

Exact-SHA Verify: run 42565710026, https://github.com/just-every/run-porthole/actions/runs/42565710026.
Terminal status: completed/cancelled, observed at 2026-11-09T05:25:57Z on the exact product SHA. This is not green CI and no READY claim is made. ci-observations.jsonl and ci-receipt.json preserve the actual REST result; ci-jobs.json preserves the completed job results. The builder did not request a rerun or dispatch because the brief forbids rerunning Verify for a SHA that already has a run. A single watcher used four REST calls at five-minute intervals, plus one earlier AGENTS content call and one post-completion jobs call: seven calls total including the one required failed-job archive read, within ten. Nine of eleven shard jobs passed; typecheck and analytical were cancelled during their shard command. The final verify job 128995351705 failed because not every shard succeeded; its one failed-log archive read is preserved in ci-verify-failed.log. No failing product assertion was established by those cancelled jobs. The required exact-SHA green Verify remains the terminal blocker; the fleet must resolve CI custody before landing. No product code change was manufactured to trigger another run.

## Existing claim and remaining qualification

CLAIM PORT-003 PARTIAL points=none tests=tests/porthole/collector-install.mjs#collectorInstallJourney; tests/porthole/collector-install.mjs#fleetJourney; tests/porthole/analytics.mjs#collectorAnalyticalJourney; tests/porthole/archive.mjs#fleetArchiveJourney

DEFAULT PORT-003: Preserve the prior native-owner-only fleet authority and current scoped ingest authority. Observations do not establish telemetry completeness or grant authority. Restored installs remain inactive and credential-free.

GAP PORT-003: The original live kind/OBI, supported host matrix, Infrastructure display, operator, upgrade/rollback and real-cluster qualifications remain outside this FIX. No full acceptance point is closed. No Services journey or Docker install qualification was run here. The independent gate decides whether this blocking item is resolved; this report does not promote the clause.

## Actual packet

PLAN.md contains the full plan. before-cli.json and before-telemetry.json preserve the pre-fix results. after-cli.json and after-telemetry.json preserve exact-head Node 22 results. telemetry-proof.mjs preserves the complete non-secret reproduction driver. source-provenance.json records source hashes and ancestry, touched-checks.json records final commands/results, commit-identities.txt records the required all-candidate identity check, push-receipt.json confirms the advertised remote product ref, and the CI observation/receipt/job files record REST custody. Evidence is published separately to evidence/sx-porthole-f462fix1 and does not signal acceptance or landing.

Local recovery: the pushed product branch also has a verified bundle outside the clone. recovery-receipt.json records its absolute path, SHA-256 and verification. The bundle itself is not selected for public evidence publication.
