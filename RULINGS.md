# Porthole ct rulings

Read-only main: `549227b7cfa5247a4a9abf3cccbfa7395a77cacd`. Date: 2026-10-28. These rulings change no clause status; missing implementation and proof remain required. Cleanup has not landed (main retains the legacy contract and has no RULINGS.md).

### RL-101 — Sampling that keeps what matters

Date: 2026-10-28 · Ruled by: ct · Governs: `PORT-010`.

**Question.** May the metric and sampling configuration door initially restrict mutation to a current scoped owner?

**Proposed and adopted default.** Scoped owner-only metric-rule creation with full-input RED, explicit sampling completeness and protected error evidence.

**Outcome: adopt with rider.** Approve current owner mutation of sampling and metric rules only within the permitted service, environment and field scope; configuration cannot imply full unsampled input or hide exhausted buffer or late span loss.

**Why.** Datadog requires an explicit metric-generation permission and distinguishes full-traffic trace metrics from sampled OTel inputs. Its capability model does not establish a permanent owner-only rule.

**Rider.** Keep metric administration and data visibility separate, retain future authorized-role access, and compute metrics before sampling only when the actual accepted input supports that completeness claim; collector restart, late-span and protected-error proof remain required.

**Place once.** PORT-010 cites the metric authorization and preview rule owned by PORT-078, rather than duplicate it.

**Incumbent and source behavior.**

- [Datadog requires the apm_generate_metrics permission to create a span-derived metric.](https://docs.datadoghq.com/api/latest/spans-metrics/create-a-span-based-metric/)
- [Datadog trace metrics use full application traffic; OpenTelemetry SDK sampling reduces that input, and collector metrics must be computed before sampling.](https://docs.datadoghq.com/tracing/metrics/metrics_namespace/)

**Engineering and proof distinction.** Collector buffering, distributed routing, physical retention and official Agent full-traffic schemas are engineering/proof gaps.

Main reference: `CONTRACT.md:87` at `549227b7cfa5247a4a9abf3cccbfa7395a77cacd`; current Status Gap was read in full. Route: `round`.

### RL-102 — Challenger and AI-SRE switching

Date: 2026-10-28 · Ruled by: ct · Governs: `PORT-044`.

**Question.** May the inherited imported-target erasure default remove local imported custody after fresh exact owner consent without deleting the external vendor source?

**Proposed and adopted default.** PORT-043 inheritance: unrestricted native owner, proof within five minutes, exact inventory consent, withdraw opaque artifacts and history, later-journal archive refusal, no external deletion or automatic expiry.

**Outcome: adopt with rider.** Approve fresh exact-inventory owner consent for local imported-target erasure, withdrawing controlled opaque artifacts and inactive history and preventing an older archive from silently resurrecting erased content; external source deletion and cutover require separate authority.

**Why.** No common norm: Datadog uses permissioned query deletion with product-specific behavior and leaves derived metrics independent, while Splunk publishes distinct signal retention. Neither establishes Porthole’s five-minute consent or whole-archive policy; minimal authorized local destruction without source-side effects is the chosen default.

**Rider.** State once in the import-custody door rule that ordinary supported erasure must identify affected imported artifacts and hold conflicts, and that rejected stale staging is withdrawn; fresh source uploads require new reviewed custody, not automatic expiry or old authority revival.

**Place once.** One import-custody door rule owned with PORT-043; PORT-044 and PORT-034/035/045/061 cite it.

**Incumbent and source behavior.**

- [Datadog enables log deletion administratively with a separate deletion permission, exact query confirmation and history; derived metrics are not implicitly deleted.](https://docs.datadoghq.com/account_management/delete_data/)
- [Splunk Observability publishes differing retention periods by signal and data type rather than one universal deletion period.](https://help.splunk.com/en/splunk-observability-cloud/administer/org-reference-info/data-retention-in-splunk-observability-cloud)

**Engineering and proof distinction.** This row mixes a real inherited erasure question with false-positive policy holds: omitted import-kit files, Base ownership regeneration, official vendor execution and query parity and the 26 Oct Base hold are engineering dependencies, not ct discretion. Actual collector cutover remains owner-reserved.

Main reference: `CONTRACT.md:161` at `549227b7cfa5247a4a9abf3cccbfa7395a77cacd`; current Status Gap was read in full. Route: `round`.

### RL-103 — Custom span-derived metrics before sampling

Date: 2026-10-28 · Ruled by: ct · Governs: `PORT-078`.

**Question.** May custom span-metric changes require current owner scope, fresh proof and exact cardinality and cost preview?

**Proposed and adopted default.** Owner-only fresh-proof and exact-preview metric policy; agents propose only.

**Outcome: adopt with rider.** Approve human-reviewed metric definitions bound to exact predicate, numeric aggregation, dimensions, source scope and cost and cardinality preview; only current permitted source and field data contributes and agents cannot activate their own proposal.

**Why.** Datadog previews span filters, aggregations and dimensions and requires a generation permission. No common norm mandates an owner-only and fresh-proof interval; this is Porthole’s chosen bounded configuration control.

**Rider.** Keep the same rule for creation and changes, require a new preview on changed inputs, and reject forbidden or high-cardinality scope without a hidden charge; future delegated metric administrators remain due, and input completeness, export and monitoring are separate acceptance.

**Place once.** PORT-078 owns one metric authorization and preview point; PORT-010 cites it.

**Incumbent and source behavior.**

- [Datadog lets users filter spans, select counts or numeric aggregations, choose dimensions and preview before creating billable custom metrics.](https://docs.datadoghq.com/tracing/trace_pipeline/generate_metrics/)
- [Datadog requires the apm_generate_metrics permission to create a span-derived metric.](https://docs.datadoghq.com/api/latest/spans-metrics/create-a-span-based-metric/)

**Engineering and proof distinction.** Full pre-decision computation, arbitrary permitted attributes, cost estimates and monitoring, export and custody qualification remain engineering proof.

Main reference: `CONTRACT.md:109` at `549227b7cfa5247a4a9abf3cccbfa7395a77cacd`; current Status Gap was read in full. Route: `round`.
