# sx-porthole-c-f456 — PORT-099

Repository: just-every/run-porthole. Product branch: cloud/sx-porthole-c-f456.

## Full execution plan

1. Establish fleet identity, refresh the launcher bundle, install the bundle-only Git credential helper, push guard and commit-message hook. Clone full history, create the named branch from main, and read the source contract, acceptance points, frozen rubric, repository commands and inline ct riders.
2. Map the four acceptance points and frozen R1–R5 to ordinary visual query and Explore doors. Keep PORT-014 and PORT-049 holds intact. Do not change any Status, Gap or Evidence cell. Choose the explicitly permitted exact-unit preservation and mixed-unit refusal implementation; add no conversion or provider claim.
3. Build bounded grouped scalar-gauge range normalization, evaluation and scoped reads at one completion watermark. Require explicit start, end, step, lookback, group labels and aggregation. Carry each contributing point's unit; reject a group that changes or mixes units anywhere in the range. Preserve missing instants. Recheck live authority and retained custody before release and the single saved snapshot; never save intermediate scan pages for a range.
4. Extend the existing Explore form and result document using the established components. Show completion and each series unit. Expose explicit unit refusal, with no completed result. Document the API, bounds, label semantics, exact-unit policy and replay. Regenerate the public schema.
5. Run the stock OpenTelemetry gauge journey through real OTLP intake and actual local and analytical storage. Reconcile same-unit values, labels and timestamps; refuse producer turnover and incompatible or unsupported combinations; read back prior snapshots, source metrics and dashboards. Check paging, replay, restart, bearer scope, quotas and revocation. Exercise existing dashboard rollup, rate and smoothing. Capture result and refusal screens at 1440 and 390, with functional assertions at 1440.
6. Push substantive intermediate saves with skip-ci messages. Fetch and merge updated main before the final candidate; retain source judgments and generated views whole. Generate and check contract views, restore them, stage all source changes, regenerate the source lock last and check it. Run touched tests, typecheck, first-party and schema checks.
7. Push the final candidate through the fleet guard after checking every candidate commit identity and trailer. Discover and poll exact-SHA Verify only through the approved REST path within the call budget. Leave publication scan, main landing and Run site to the maintained lander. Publish the actual non-secret report, receipt and browser proof only on the evidence ref. Return the clause claim, full SHA, CI identity and lane POST line.

## Implementation boundary

Visual scalar gauges only. All values in a grouped series retain one exact unit string. Mixed units, including ms followed by s, refuse explicitly; distinct producers can instead be grouped separately with correctly declared units. There is no conversion, PromQL evaluation, Datadog dialect, rate or histogram expansion. Query references contain parameters and a completion watermark rather than detached telemetry. No schema migration, outbound effect, configuration authority, erasure authority or retention change is introduced.

## Progress

Implementation and first two substantive saves are published. The local archive regression was corrected before candidate publication. Final candidate validation and exact-SHA CI receipts are being collected.

## Candidate and counts

Candidate: c6e2bdebeed263216b19e48da07bb59fcbf75cfb. Base main: 6f990f7b880684e06e96755b79ee9747630f89f3.
No PR is required: the repository has push Verify on every branch. No default branch was pushed.

Source counts remain 10 DONE, 20 PARTIAL and 69 MISSING, 99 total. The Status table, Gap and Evidence cells and both generated views are unchanged. The functional implementation closes all four PORT-099 points, but this run claims PARTIAL because exact-SHA Verify was cancelled. The sole remaining plan action is a green exact-SHA gate before PORT-099 can be counted DONE. That would make 11 DONE, 20 PARTIAL and 68 MISSING. PORT-014 and PORT-049 receive no progress or status claim; every existing hold remains intact.

## Frozen rubric and acceptance proof

All references below name actual public-door journeys, folded into the existing dashboard and analytical Verify commands. There is no standalone unit-test registration or workflow change.

| Item | Outcome reached and observed | Proof |
| --- | --- | --- |
| Requirement sentence 1 | Each evaluation preserves physical meaning and labels, including producer turnover. | ./tests/porthole/metric-units.mjs, metricUnitsJourney, lines 45–62: two stock SDK producers, original 400 ms and 3 s intake rows, explicit 20-second step and 10-second lookback; same-unit values, typed labels, instants and contributor counts. |
| Requirement sentence 2 | A completed series cannot carry the first unit onto differently scaled later values. | metricUnitsJourney, lines 62 and 70–75: separated series retain ms and s; grouped turnover refuses with no range or saved query reference. |
| Requirement sentence 3 | Supported local and analytical semantics agree. | ./tests/porthole/analytics.mjs, metricRangeAnalyticalProof, lines 375–382: identical source clocks and independent stock producers; complete range objects deep-equal across both actual backends. |
| Acceptance 1, sentence 1; R1 | Nonoverlapping 400 ms and 3 s producers in one group are explicitly refused. | metricUnitsJourney, lines 48–53 and 70–75; real OTLP intake and original source rows are inspected before executing the grouped range. |
| Acceptance 1, sentence 2; R1 | The forbidden completed [400, 3] ms series cannot be released. | metricUnitsJourney, line 71: HTTP 400, incompatible_metric_range_units, no range and no queryRef. Same-unit completion prevents an always-refuse implementation passing. |
| Acceptance 2; R2 | Same-unit grouped ranges complete with correct values, labels and timestamps. | metricUnitsJourney, lines 50 and 54–61: [400, 3000] ms at the independently fixed instants; 205 contributing points across storage pages; sum, average, min, max and absent lookbacks. |
| Acceptance 3, sentence 1; R3 | Simultaneous ms and By are refused. | metricUnitsJourney, lines 70–75, after both stock producers submit their gauge measurements. |
| Acceptance 3, sentence 2; R3 | Unsupported unit combinations produce no misleading complete result. | metricUnitsJourney, lines 70–75: unsupported declared unit combination refuses; lines 63–64 also exercise invalid ranges and unsupported counter type. |
| Acceptance 3, sentence 3; R3 | Refusal changes no saved result or source metric, and no dashboard. | metricUnitsJourney, lines 65–75: exact saved snapshot rows, native dashboard read-back and original source metric rows are unchanged; a prior saved range still reproduces. |
| Acceptance 3, sentence 4; R4 | Equivalent supported local and analytical outcomes agree. | metricRangeAnalyticalProof deep-equals complete values, units, labels, instants and state; metricUnitsJourney independently requires identical unit-refusal codes on both backends. |
| Acceptance 4; R5 | Explore accurately shows complete results and units, and refusal without a false complete display. | ./tests/porthole/metric-units.mjs, metricUnitsBrowser; ./tests/runtime.mjs loads the range journey in the existing dashboard shard. Functional checks run at 1440. Actual result and refusal images are captured at 1440 and 390, and inspected. |
| Existing dashboard behavior | Rollup, rank, smoothing, rate, counter reset, original source ranges, reload, restart and empty scopes retain exact values. | ./tests/porthole/widgets.mjs, widgetJourney; unchanged assertions passed in the dashboard repeat. Final full journey receipt is recorded below. |
| Native custody regression | A saved range remains a valid portable snapshot, with no restored authority. | metricUnitsJourney reads every native export chunk and manifest; ./tests/porthole/archive.mjs, clusterArchiveJourney, reads back the earlier saved range after inactive restore and checks values, units, labels, instants, completion and snapshot. Existing zero-credential and paused-intake assertions remain in place. |

## DONE-RIDERS

| Row | Result and evidence |
| --- | --- |
| 1 | Functional outcomes PASS locally through the native query, Explore, real OTLP intake and actual analytical door. Recorded green Verify remains UNMET: exact-SHA run 42489688457 completed cancelled. |
| 2 | PASS. Independently enumerated nonempty producer values and timestamps, distinct physical units, actual refusals and exact no-effect read-back. There is no mocked application backend. |
| 3 | NOT YET SATISFIED: Verify 42489688457 (push) completed cancelled on the exact candidate. No successful run is claimed. The local range journey is called by the existing dashboards push shard; analytical parity is called by analyticalConnectionJourney in the existing analytical push shard. Exact-SHA event and conclusion are recorded in VALIDATION.json. The phone artifact is browser proof at 390; functional assertions run once at 1440 under the cloud UI rule. |
| 4 | Candidate build and range proof run on c6e2bdebeed263216b19e48da07bb59fcbf75cfb. The full dashboard and inactive-restore journey passed on 28b8f434847d7636674252bbd14f3a9a1e9a9907. Main subsequently added database functionality; the merge retained both validator imports and all range behavior. The merged candidate rebuilds and repeats both range backend and export probes. No widget implementation or existing widget assertion changed. |
| 5 | INSPECTED. PORT-099 adds no inherited Base duty or new permission surface. It reuses current native and bearer authority and the existing archive projection. No unrelated duty is claimed. |
| 6 | Mechanical PASS. Contract write and check for PORT-099 pass, generated views are restored whole from main, and source lock generation and check pass. Status cells remain lander-owned. |
| 7 | PASS, INSPECTED. CONTRACT.md has zero diff. No acceptance point, rider, coverage mapping or judgment is changed. |
| 8 | PASS for this read-only surface. Current scoped owner and bearer queries work; a forbidden bearer scope, exhausted quota and revoked reader refuse. Range refusal changes neither dashboards nor source metrics. No correction or refund action is added. |
| 9 | Not applicable. No provider, legal, capacity, history or retention qualification is claimed. Existing holds remain explicit and unchanged. |
| 10 | Not applicable. Exact-unit preservation and explicit refusal are expressly permitted by PORT-099 and the frozen rubric. No custody, consent, spending or authority default is adopted. |
| 11 | Pending the guarded lander. This cloud does not update main, run the fleet publication scanner or claim candidate Run site. Preexisting main was green: Verify 42488138801 and Run site 42488138805 on 6f990f7b880684e06e96755b79ee9747630f89f3. |

## Pre-ready self-check

1. Each named outcome is exercised by the public-door journeys above; exact-SHA Verify is reported in the receipt, not inferred from another SHA.
2. No existing assertion is removed, narrowed or moved behind a condition. The only conditional restore assertion is newly added for the new range proof. No workflow, Base pin, dependency, test cap or source clause is changed.
3. Revoked read authority and saved snapshot replay are exercised. Range snapshots contain parameters and a watermark rather than detached telemetry; release rechecks live authority, selected analytical configuration and exact retained rows against erasure. This custody fence is INSPECTED in ./src/porthole/query/range/read.ts. The change grants no new erasure or capture-replay authority and does not release existing erasure holds.
4. The changed native Explore screens use the established frame. The browser journey checks readable text, reflow, keyboard entry and nonempty text on all controls. There are no new icon-only controls or configuration settings.
5. Source lock, schema, contract generation, first-party and touched checks are recorded in the receipt. Publication scan is deliberately delegated: commit c6e2bdebeed263216b19e48da07bb59fcbf75cfb; complete=not-run-in-cloud; historyScanned=not-established-in-cloud; findings=not-established-in-cloud. No zero-findings result is fabricated. Candidate main equality and Run site remain pending landing.

## Public-door probes

PROBE PORT-099 1: stock OTLP gauges -> versioned visual range with step=20 and lookback=10 -> original 400 ms at T and 3 s at T+20 confirmed; grouped range HTTP 400, no completed or saved result; separate producer groups retain the correct units.
PROBE PORT-099 2: same-unit grouped scalar gauges -> versioned visual range -> complete [400,3000] ms with exact labels, timestamps and one contributor at each instant; 205-point paging yields 205 ms.
PROBE PORT-099 3: simultaneous incompatible and unsupported units -> native range query -> explicit refusal; saved snapshots, source metrics and dashboard read-back unchanged; both query backends obey the same outcomes.
PROBE PORT-099 4: Explore query form, result and refusal -> 1440 functional journey plus 1440 and 390 browser proof -> correct status and units, no completed refusal, readable native controls and reflow.

MECHANICAL lock=pnpm source:lock and pnpm source:check exit=0; views=node scripts/porthole/contract-docs.mjs write PORT-099 and check PORT-099 exit=0, generated views restored from origin/main; ledger=none exit=0.

## Local failures and corrections

The first dashboard run hit an unchanged widget navigation failure at page.reload (ERR_ABORTED). An unchanged repeat passed every widget assertion; no assertion or product behavior was changed for that failure. The repeat then exposed archive_semantics_invalid from newly saved range descriptors. The candidate was not published with that failure. The fix projects duplicate signal and snapshot fields into their existing columns and explicitly validates portable range settings and time bounds. Export and inactive-restore checks now exercise the same public custody doors. LOCAL-FAILURES.json retains the actual nonzero results. There has been no failed CI repair or third repair round.

## Handoff

Final exact-SHA CI identity, actual command exits, artifact hashes and publication custody are recorded in VALIDATION.json. There are no remaining locally observed PORT-099 functional gaps; the recorded green Verify bar is still open. Product acceptance and landing remain independent of evidence publication. Only the PORT-099 plan row is proposed to change; the full seed plan is not rebuilt.

## Main integration

Main advanced to 6f990f7b880684e06e96755b79ee9747630f89f3 with the separately built database domain. Its exact Verify 42488138801 and Run site 42488138805 are green. The merge conflict was limited to the two new validator imports and the generated source lock. Both imports were retained, every main source change and assertion was preserved, CONTRACT.md and generated views were taken whole, new pinned dependencies were installed, commit hooks were reinstalled, and the source lock was regenerated last. Main's migration and database work are inherited changes, not PORT-099 progress. No migration is added relative to current main.

The pre-merge head 28b8f434847d7636674252bbd14f3a9a1e9a9907 was published when a shell continued after the merge conflict. It is preserved in history; no published commit was amended or force pushed. The intended handoff head is the subsequent merge. LOCAL-FAILURES.json records the mechanical failure and correction.

## Published merged candidate

The product branch now holds c6e2bdebeed263216b19e48da07bb59fcbf75cfb. Verify 42489688457 was discovered on event push with that exact head and queued status. The final REST conclusion will be appended after the permitted polling interval. All local processes have completed. The merged range build and both backend journeys, including complete installation exports, exit 0. The full pre-merge dashboard journey, including the added inactive-restored range assertion, exits 0. Current source counts and all 99 Status rows remain unchanged.

## Final result

Product: cloud/sx-porthole-c-f456 at c6e2bdebeed263216b19e48da07bb59fcbf75cfb, pushed and independently confirmed with ls-remote. No PR was created. Exact-SHA Verify 42489688457, event push, completed cancelled. A later exact-SHA discovery found no replacement run. Eight GitHub calls were used. No workflow was dispatched or rerun, and no green result is inferred from main. Cancellation alone is not reported as a reproduced application failure or a BLOCKED verdict.

The handoff is PUSHED, not READY. PORT-099 is claimed PARTIAL solely because DONE-RIDERS row 3 still requires a recorded green exact-SHA Verify. All four functional acceptance points and frozen R1–R5 have local public-door proof. Row 11 remains the guarded lander's publication, main equality and Run site duty. No clause Status, Gap or Evidence cell is changed. Actual before and after counts remain 10 DONE, 20 PARTIAL, 69 MISSING (99 total). The hypothetical 11 DONE, 20 PARTIAL, 68 MISSING counts apply only after a later successful gate and owner-written judgment; they are not counted by this report.

CLAIM PORT-099 PARTIAL points=1,2,3,4 tests=tests/porthole/metric-units.mjs#metricUnitsJourney; tests/porthole/analytics.mjs#metricRangeAnalyticalProof; tests/porthole/metric-units.mjs#metricUnitsBrowser
GAP PORT-099: Exact-SHA Verify 42489688457 was cancelled; recorded green Verify is required before DONE. No functional implementation gap was observed in the completed local proof.

The complete plan, per-sentence acceptance map, frozen rubric, all eleven riders, pre-ready checks, local failures, corrected merge, actual receipts and browser images are in this report packet. Product custody and evidence publication remain separate. This report does not authorize landing or claim a publication scan.
