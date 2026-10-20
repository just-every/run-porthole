# Acceptance requirements

Target edition: **20 October 2026**. All 61 clauses are **missing**: 58 target and 3 push-further, with no published clauses or implementation. This checklist mirrors CONTRACT.md; listing a journey is not evidence it passed. Every browser journey includes 1440 × 900 and 390 × 844, realistic US data, restricted roles, failure states, keyboard/focus and accessible reflow under the contract’s common conventions. Tests use the real application/ingest/storage path, with schema-faithful fakes only at the network/provider edge. Native distribution, live authorization, compliance agreements and performance qualification remain separately required evidence where named.

## Clause journeys

- **PORT-031 — Owner-run Base installation. Status: missing.** From a clean authorized Cloudflare account follow Base setup to a real sign-in, ingest stock OTLP and inspect a service. Break each required binding and verify startup and health diagnose it without secrets. Reinstall into a second account and prove data and authority isolation; inspect setup at 1440 and 390. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-032 — Sign-in and accountable membership. Status: missing.** Through setup, sign-in and Settings invite each role, consume a link once, expire another and sign out. Remove a maintainer with a running investigation and report, verify immediate API/mobile/MCP refusal and handover, and refuse removal of the last owner. Test forged links, CSRF and cross-organization access. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-033 — Durable audit with private contents. Status: missing.** Use UI and versioned API to run a query, refuse a restricted query, change a monitor, approve a repair and export audit. Restart, erase an actor and restore an archive; action order/results and opaque references survive and planted addresses, tokens and restricted literals do not leak. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-034 — Complete inactive archive and restore. Status: missing.** Export a realistic multi-team estate with open alerts, customer-bucket history, a pending rollback and removed actors through Settings/CLI. Interrupt/resume, restore into another owner account, compare counts and samples, re-export, and prove no send, production action or live health occurs. Corrupt a chunk and try nonempty restore; both refuse without partial import. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-035 — Retention and operator-directed erasure. Status: missing.** Plant a US identifier in logs, traces, profiles, RUM and exports; run owner erasure via API, include a locked S3 object, restart and inspect searchable/storage remnants and the outstanding deletion. Restore an older archive with the later journal and prove no resurrection. A preview or unapproved retention change deletes nothing. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-036 — Agents are scoped credentials. Status: missing.** Issue a checkout-only read key through Settings, query via REST/CLI/MCP and attempt another service, write, approval and credential minting; all unauthorized operations refuse server-side. Inject instructions into logs/runbooks, revoke during a job and verify no escalation or new read. Search prompts/audit/archive for planted secrets. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-037 — Recovery of observability itself. Status: missing.** Stop the analytical backend and a collector during a firing monitor; read health and last-known data from a separate authenticated door, receive the configured independent failure notice and inspect Unknown. Restart with pending ingest/delivery and prove bounded backlog reconciliation, original timestamps and no duplicate repair execution. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-038 — US organization defaults and cost commitments. Status: missing.** Set up a US SaaS organization, inspect all cost units, change report zone and run periods across both New York DST transitions. Enable a new paid backend or agent budget and verify the owner sees exact incremental terms and must approve; unauthorized finance-only writes and silent upgrades refuse. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-001 — OpenTelemetry-native ingest. Status: missing.** Use official SDKs/exporters for Node, Python, Java, Go, .NET and Ruby with a stock Collector to send correlated traces, metrics, logs and profiles to the documented ingest endpoints. Through Explore/API read every signal within 10 seconds at PORT-057 load; malformed payloads and foreign keys refuse with protocol-appropriate diagnostics. No simulated ingestion counts. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-002 — Drop-in compatible intake. Status: missing.** Run an unmodified Datadog Agent and Prometheus on the same controlled host against original and Porthole endpoints, with only documented destination/local-key changes. Compare metrics and logs, histogram/tag semantics and service checks; send real Fluent Bit, Vector, StatsD and syslog traffic and inspect queryable originals through public ingest and Explore. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-003 — One-command collector. Status: missing.** On fresh supported Linux/macOS/Windows hosts and Docker follow each documented command. On a fresh kind cluster one Helm install discovers the real application service map and RED metrics without application edits. Remove required privileges and verify explicit gaps, then uninstall cleanly without deleting retained history. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-004 — Language auto-instrumentation. Status: missing.** Instrument a seven-language application through documented install paths, exercise HTTP/gRPC and Kafka producer/consumer hops, and open one unbroken trace through the trace API/browser waterfall. Include async fanout and conflicting IDs; compare known graph/timings and expose a deliberately broken propagation boundary. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-005 — Cloud and serverless integrations. Status: missing.** Authorize AWS with a CloudFormation-created scoped IAM role and see EC2/RDS/ELB/Lambda resources and metrics within five minutes. Use official provider sandboxes or schema-faithful network-edge fixtures for GCP/Azure/Cloudflare/Vercel/Fly.io; replay their real log/metric/trace envelopes through connectors, revoke each grant and verify stopped collection and visible lag. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-006 — Technology integration library. Status: missing.** Enable PostgreSQL through Integrations against a real database and verify a live dashboard plus three default monitors. Run the released catalog matrix for all 100 integrations through actual collectors/connector routes against real test services or provider-edge fakes built from official schemas; prove each dashboard and monitor reads its expected signal and denied setup remains actionable. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-007 — Infrastructure and Kubernetes explorer. Status: missing.** Kill a pod for OOM in a real cluster and within 60 seconds open its event, memory curve, owning workload and logs through Infrastructure. Roll/recreate it, inspect separate old/new identities, stale data and request-versus-usage views at desktop and phone widths. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-008 — APM and service catalog. Status: missing.** Exercise a realistic checkout estate with two teams and a queue; compare catalog owner, percentiles, rates and service map against the actual call graph and request counters through Services and API. Reassign ownership, remove traffic and verify attribution/history and freshness remain truthful. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-009 — Trace explorer. Status: missing.** Query user_id=X through Explore/API and return only authorized matching traces. Generate a slow cohort with a known high-cardinality attribute and show its baseline/outlier difference; inspect a fanout waterfall and partial trace without fabricating spans or exposing restricted user attributes. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-010 — Sampling that keeps what matters. Status: missing.** Send a counted workload with delayed errors, slow spans and healthy traffic through real collectors at a 10% ordinary sample rate. Read every error/slow trace and compare RED counts to unsampled source totals within 1%; restart collectors, exhaust a declared buffer and verify accounted loss/uncertainty and protected-error handling. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-011 — Log management. Status: missing.** Through the log search API and browser search a representative 1 TB corpus for a known term in under five seconds at PORT-057 resources, verify exact counts and facets, tail across reconnect and pivot a line to its real trace. Search restricted and malformed records and inspect explicit denial/parse diagnostics. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-012 — Log pipelines. Status: missing.** Send seeded structured/multiline/malformed logs through ingest, preview and activate a pipeline through its API. Search raw hot/archive/queue custody for planted SSNs/cards, proving masking precedes persistence; compare logs-to-metric totals with the source query. Change a parser and rollback, rejecting an invalid or stale reviewed revision without data deletion. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-013 — Tiered storage and archives. Status: missing.** Archive 90-day-old logs to each provider bucket, remove hot copies under approved policy, and rehydrate/search the selected partition within ten minutes. Open the Parquet in DuckDB without Porthole and reconcile counts/types. Revoke bucket access, corrupt a partition and cancel rehydration; show explicit incomplete outcomes without a false success. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-014 — Metrics engine. Status: missing.** Run the upstream PromQL compliance corpus through the real query API, including resets/staleness/native histograms. At one million active series query a 24-hour range in under two seconds on PORT-057 resources; compare full-resolution and labeled rollup results over 13 months and pivot an exemplar to its trace. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-015 — Continuous profiling. Status: missing.** Drive known CPU and allocation bottlenecks in the seven-language estate using supported stock exporters. From a slow span open the captured profile slice and hottest function, compare fixed release and inspect source attribution. Validate each declared runtime/type pair and an unsupported configuration through the setup and profile API. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-016 — Database monitoring. Status: missing.** Run a missing-index and blocked-transaction drill in PostgreSQL and MySQL. Through Database and trace API find the top slow fingerprint, plan, waits/blocker and affected endpoints. Rotate/read-limit the database role, plant sensitive literals and verify safe capture plus explicit privilege errors. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-017 — Frontend and mobile performance. Status: missing.** In an instrumented browser at 1440/390 click checkout and trace through backend services; compare route LCP/INP to browser PerformanceObserver reports. In real iOS/Android simulators capture launch/network spans and backend context. Refuse foreign-origin ingest and verify opt-out, sensitive URL filtering and read denial for the public key. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-018 — Dashboards and one explore view. Status: missing.** Create and reload a dashboard containing a metric, log count and trace percentile; change a team/environment variable and pivot every panel to its source with preserved range. Use keyboard editing, TV mode and a restricted shared link at 1440 and 390; wrong-scope reads fail in API as well as UI. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-049 — Correct and bounded exploration. Status: missing.** Through Explore and API compare visual, PromQL, SQL and Lucene queries against known source counts and typed attributes. Cancel an expensive join, cross a time boundary, hit a scan limit and resume pages; verify complete/canceled/partial states, matching exports and no cross-team rows or host execution. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-019 — Monitors. Status: missing.** Create every monitor type through UI/API and replay known healthy/firing/recovering/no-data sequences through the ingest door. Validate grouped and multi-window timing, flapping control, scheduled downtime across DST and restart, renotify and immutable revisions. Composite children and missing-data cases must resolve correctly without hiding failures. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-020 — Alert routing. Status: missing.** Fire and recover a monitor through real evaluation; observe one Oncall alert and Slack thread with snapshot/links and a recovered update. Exercise each named adapter against its sandbox or official-schema edge fixture, including duplicates, out-of-order recovery, revoked tokens, 429 and lost response; inspect persisted outcomes after restart. Verify human incidents remain open until Oncall policy/person resolves them. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-021 — SLOs and error budgets. Status: missing.** Replay fast burn through ingest and see the 1-hour/5-minute alert, exact budget spent and matching report/API figures. Send a mapped event to Lamp and observe a component change only with its approved automation rule; remove that rule and prove intake stays private. Include no traffic, missing metrics, late data and a changed SLO definition. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-022 — Change tracking. Status: missing.** Deploy a known 200 ms checkout regression and see the marker and version comparison in Services/Explore. Send each provider documented webhook/API envelope through connectors, replay/reorder and include an unrelated deploy; retain exact attribution and do not claim the unrelated change caused the regression. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-023 — Telemetry cost control. Status: missing.** Explode a tag and identify the source, cardinality and projected USD cost within one hour. Hit a team quota and prove ordinary ingest is capped while all error traces are retained using configured reserve/approved spill capacity; compare usage to bills, exhaust absolute capacity and show explicit backlog/loss/Unknown rather than healthy data. Finance readers can inspect but cannot approve changes. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-024 — Migration from incumbents. Status: missing.** Import a real authorized Datadog export with 20 dashboards and 50 monitors through saved preview; every query is translated or individually flagged. Dual-ship controlled incidents and compare equivalent alerts within one minute, with unsupported rules blocking retirement. Inspect active incidents, paused copies, reconciliation and rollback before accepting cutover. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-025 — Access audit and compliance. Status: missing.** Sign in through Auth and a standards-based IdP, provision/deprovision with official SCIM schemas and test MFA/step-up. A contractor cannot read payment logs, restricted fields or infer them through aggregations, joins, export, shares or agent prose. Export query/config audit and region/retention evidence; review an actual control matrix, processor inventory and BAA execution workflow before a health-tech pilot. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-026 — Observability as code and agent access. Status: missing.** Through a real Terraform provider and public API import/create/update dashboards and monitors, re-plan with no drift, introduce a concurrent UI edit and refuse stale apply. Use CLI pagination and MCP to answer why checkout is slow with cited queries; attempt mutation and another team’s data with the read-only credential and require denial. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-027 — LLM and agent observability. Status: missing.** Instrument a multi-tool OpenAI/Anthropic run with streaming, a retry and a failed call through stock OTel instrumentation. Compare token/cached-token and USD totals with authorized provider usage reports, showing missing/delayed reports distinctly. Query model/feature cost and inspect default traces/archive for absent sensitive prompts. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-039 — Datadog complete account migration. Status: missing.** Use an authorized representative Datadog account export and official API-schema fixtures for denied/limited pages. Preview/apply/restart/re-import/undo with 20 dashboards, 50 monitors, SLOs, a log pipeline, an open alert and restricted team; compare every source object/query and owner, refuse stale mappings and demonstrate repointed unmodified collectors plus reversible alert cutover. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-040 — New Relic complete account migration. Status: missing.** Move a representative New Relic export with multi-page dashboards, NRQL facets, a custom event, streaming alert delays/no-data, SLO and an open incident through Migration. Replay source events and compare query results/evaluation times; require explicit blocker resolution for untranslated NRQL. Restart/reapply without duplicates and undo without destroying a later Porthole edit; prove stock OTel replacement spans reach the same service. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-041 — Grafana and open-stack migration. Status: missing.** Import a real Grafana export with library panels, variables, recording rules, muted alert groups, Loki searches, Tempo queries and a Grafana SLO. Repoint stock Alloy/OTel and Prometheus through the documented connector, compare source queries and alert generations, flag a custom plugin/query blocker, restart and roll back. Demonstrate both Cloud and self-managed source variants. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-042 — Dynatrace migration. Status: missing.** Through Migration import a representative Dynatrace account/export with DQL dashboard, metric selector, management zones, a problem/SLO and service relationships. Dual collect a known fault before retiring OneAgent, compare results and permissions, show an unsupported DQL function as a blocker, and restart/undo retaining original context and open response work. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-043 — Splunk Observability migration. Status: missing.** Import a representative Splunk Observability export with SignalFlow detector, chart variables, APM service and linked log search; compare a replayed detector sequence and retained tags using official export/API schemas. Flag any untranslated SignalFlow/SPL construct, exercise rate-limited extraction/restart and rollback, and verify a security dashboard gets an explicit specialist handoff. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-044 — Challenger and AI-SRE switching. Status: missing.** For each of the seven named products run its export-to-preview/apply path using an authorized export or official-schema network fixture. Reconcile all supported object counts and query/alert meaning, demonstrate a named unsupported construct and required human resolution, exercise resume/undo and open-history references, and prove new correlated telemetry reaches Porthole without a copied credential. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-045 — Historical data and reversible mid-stream cutover. Status: missing.** For each migration family interrupt a paginated export, insert a late event and change a native monitor; resume without lost/duplicated rows, compare source and native counts/time/units and exercise conflict-preserving undo. During an active outage switch destinations once, recover and roll back while comparing both timelines and one provider incident generation. An unresolved translation/history gap blocks a completed-cutover label. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-046 — Native mobile operator access. Status: missing.** On real iOS/Android simulators or test devices install the supported builds, sign in, open an APNs/FCM test-sandbox notification, inspect its chart/trace and approve a current permitted action. Go offline, revoke device/session and retry a stale/deep-linked approval; refuse execution and show stale data. Use equivalent web journeys at 1440 and 390. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-047 — Scheduled reports and exports. Status: missing.** Build a monthly New York SLO and USD-cost report through Reports at 1440/390, compare its dashboard/API/CSV/JSON/PDF totals, source segmentation and scan coverage. Schedule across DST, revoke a recipient’s permissions and delay a provider response; verify contents, one scheduled job, durable outcome and explicit missing data without restricted-field leakage. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-048 — Collaborative notebooks and safe sharing. Status: missing.** From a firing alert save an investigation notebook, attach a chart/query, mention a teammate and rerun after recovery. Open the shared link as an authorized responder, contractor and signed-out browser at both widths; verify scoped results. Publish a reviewed sanitized expiring snapshot, revoke it, restore an archive and confirm sharing authority and old mentions do not replay. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-050 — Spool and Uptime evidence handoffs. Status: missing.** Send a trace with a Spool-linked exception and an Uptime result through authenticated provider routes, pivot both directions and keep time/service context. Replay/reorder/forge events, revoke scopes and remove a source trace; deduplicate, deny foreign data and show unavailable provenance. No Porthole control launches a probe or regroups a Spool issue. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-051 — Oncall and Lamp keep response ownership. Status: missing.** Fire/duplicate/recover an alert through Porthole evaluation into a real sibling installation or its official-schema edge. Inspect one accepted source event/generation, alert recovery and unchanged human incident until Oncall resolves it. With and without a Lamp automation rule, send the same SLO evidence and verify private proposal versus authorized component transition and no unapproved subscriber update. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-052 — Auth and Evidence integrations. Status: missing.** Sign in through Auth, remove the identity and verify revoked access across query and agent doors. Request a restricted period/team evidence export from Evidence, reconcile source audit/retention records and refuse a wider scope. Disconnect either integration and keep clear local recovery and failed-export states without certifying a control as passed. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-053 — Issues and general workflow handoffs. Status: missing.** From an investigation create one issue in each configured tracker and trigger one Crank workflow using provider sandbox/schema fixtures through public adapters. Replay deliveries, lose an acknowledgement and change issue status; retain deduplication/uncertainty and do not mark the SLO recovered from a closed ticket. Revoke credentials and show the named owner’s follow-up. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-054 — Performance scope and neighboring products. Status: missing.** Through Help/Integrations and a runtime service record follow the named sibling/partner handoffs at 1440/390. Export a scoped telemetry-cost and service evidence packet, verify tenant/field filtering and show the buyer’s external system reference. Product routes expose no marketing funnel, CMDB, security case, whole-cloud bill or duplicated compliance-program workflow. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-055 — Dependable integration lifecycle. Status: missing.** Use the real Settings/test/event doors for every adapter with an official-schema provider fake at the network edge or sandbox. Inject 401/403, 429 Retry-After, timeouts before/after acceptance, duplicate webhooks, expired OAuth and rotated keys, then restart. Inspect preserved receipts and next owner action, one external effect and refusal of unauthorized origins/scopes; verify provider availability is disclosed before cutover. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-056 — Telemetry delivery and loss accounting. Status: missing.** Submit counted stock OTLP/remote-write/log batches through public intake, interrupt before/after durable acknowledgement, restart workers, duplicate and reorder batches and inject storage/queue failures. Reconcile accepted, intentionally sampled, rejected, archived and queryable counts exactly; prove no silent loss and show Unknown/incomplete evaluation when a source or buffer loses data. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-057 — Measured switching-buyer capacity. Status: missing.** Run a paced external qualification against the installed real ingest/query/evaluation APIs on dedicated authorized infrastructure, with realistic cardinality, skew, retention and concurrent viewers. Measure p95 ingest-to-query, term-search and metric-range latency against the stated 10s/5s/2s budgets plus monitor lag; record actual resources/USD envelope and all loss. These are future build requirements, not a benchmark run on this shared Mac. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-058 — Safe updates and fleet compatibility. Status: missing.** Using supported setup/update/rollback commands upgrade an installation while stock collectors ingest and a monitor is firing. Interrupt a schema migration, roll one collector version backward and drain/restart a worker; inspect unchanged counts, one alert generation, durable backlog and explicit unsupported rollback diagnostics. Compare archive and restored data after the upgrade. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-059 — Accountable follow-up. Status: missing.** Fail a collector and provider send, leave a repair awaiting approval and remove the assigned owner through public doors. Restart and inspect due work, reviewed handover, one reminder and clear blocker. Recover telemetry but keep the SLO failing, then genuinely recover; only the final measured recovery closes the telemetry task, and a recurrence reopens accountable work. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-060 — Network and messaging performance. Status: missing.** Induce DNS latency, packet loss and consumer backlog in an authorized real application network. Through Services/Infrastructure open affected edges, queue lag and producer/consumer spans with the same time window. Remove collector privileges and private endpoint grants and see explicit coverage gaps/denial rather than an invented clean network. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-061 — Portable signals and open interfaces. Status: missing.** From the authenticated export API/CLI export a multi-team time range larger than one page with all four signals, interrupt/resume and reconcile counts/types/trace relationships. Read Parquet/OTLP/standard profile files using independent tools, compare with Explore, revoke a scoped token mid-job and verify stopped reads. Old archives plus later erasure journals cannot re-export erased subjects. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-028 — Investigation agent. Status: missing.** Through firing-monitor and on-demand API doors replay 20 incidents spanning bad deploy, slow query, OOM, dependency outage and config change. Within five minutes post a top hypothesis correct in at least 16, with reproducible queries and contradictory/absent data identified. Test a restricted service, prompt injection and a budget stop; no forbidden data, false certainty or production mutation reaches the report. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-029 — Approved remediation. Status: missing.** A bad-deploy drill enters via real ingest/evaluation, creates an exact rollback proposal and produces zero production calls before signed person approval. Approve in Slack and app variants, recover the service and verify original SLO burn returns within its objective without erasing spent budget. Exercise scale, flag and PR paths using official provider schemas, stale version, rejected/expired approval, lost execution response and restart; prove one approved effect or explicit uncertainty and a complete audit trail. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

- **PORT-030 — Coverage noise and cost gardener. Status: missing.** On the demo estate trigger the scoped gardener through its job/API, inspect one working instrumentation PR, run its checks and approve deployment. Review and approve two noisy-monitor changes, replay genuine incidents to prove retained detection, then approve a measured telemetry change. Compare post-change bill to projected USD savings within 10%, retaining protected errors and original data-loss accounting; reject a stale or harmful proposal without side effects. Open scope: the entire behavior and acceptance journey; no implementing code or executed test exists.

## Desk coverage

Each of the 30 desk capability IDs maps to the identically numbered contract clause. PORT-001–027 are target; PORT-028–030 remain push-further. The table expands the six row.json missing items and its full pushFurther promise.

| Desk input | Named clauses |
| --- | --- |
| missing 1: OTLP four signals, compatible intake, Helm/host and eBPF | PORT-001–006, PORT-056, PORT-058 |
| missing 2: service catalog/map, RED, trace search and protected tail sampling | PORT-007–010, PORT-049, PORT-060 |
| missing 3: log search/pipelines/PII, tiered customer Parquet archive | PORT-011–013, PORT-035, PORT-061 |
| missing 4: monitor types, burn SLOs, deploy/flag changes and routing | PORT-019–022, PORT-051, PORT-055, PORT-059 |
| missing 5: clouds/Kubernetes/100 integrations, profiler, DBM and Web Vitals | PORT-003–008, PORT-015–017, PORT-055, PORT-057 |
| missing 6: telemetry USD/cardinality/quotas and real incumbent migration | PORT-023–024, PORT-038–045, PORT-047 |
| pushFurther: every-page cited investigation, person-approved rollback/flag/PR and verified SLO recovery, instrumentation/noise/cost maintenance | PORT-028–030, PORT-033, PORT-036, PORT-055–056, PORT-059 |

## Inventory feature coverage

All table-stakes rows are assigned named clauses; specialist/differentiator rows are included as well. Repeated product observations share one capability mapping.

| Area / capability | Tier | Clauses |
| --- | --- | --- |
| Collection: OpenTelemetry intake | table-stakes | PORT-001 |
| Collection: Collector pipeline configuration | table-stakes | PORT-001, PORT-012, PORT-056 |
| Collection: Kubernetes operator and automatic instrumentation | table-stakes | PORT-003 |
| Collection: Seven-language APM agents | table-stakes | PORT-004 |
| Collection: Zero-code eBPF discovery | differentiator | PORT-003 |
| Collection: Technology dashboards and recommended rules | table-stakes | PORT-006 |
| Collection: Cloud and serverless monitoring | table-stakes | PORT-005 |
| Infrastructure: Hosts and containers | table-stakes | PORT-007 |
| Infrastructure: Kubernetes workload health | table-stakes | PORT-007 |
| Infrastructure: Automatic dependency topology | table-stakes | PORT-008 |
| Infrastructure: Network performance telemetry | premium | PORT-060 |
| Infrastructure: GPU monitoring | premium | PORT-006 |
| APM: Distributed tracing and signal correlation | table-stakes | PORT-008, PORT-009 |
| APM: Service maps | table-stakes | PORT-008 |
| APM: High-cardinality exploration | table-stakes | PORT-009 |
| APM: Baseline and outlier comparison | differentiator | PORT-009 |
| APM: Continuous CPU memory and IO profiling | premium | PORT-015 |
| APM: Span-to-profile navigation | premium | PORT-015 |
| APM: Database query statistics waits and locks | premium | PORT-016 |
| APM: Database explain plans linked to traces | premium | PORT-016 |
| Logs: Full-text and structured log search | table-stakes | PORT-011 |
| Logs: Live tail | table-stakes | PORT-011 |
| Logs: Log pattern clustering | differentiator | PORT-011 |
| Logs: Parsing enrichment and routing | table-stakes | PORT-012 |
| Logs: Log privacy and parsing | table-stakes | PORT-012, PORT-025 |
| Logs: Logs-to-metrics | table-stakes | PORT-012 |
| Logs: Archive and rehydration | table-stakes | PORT-013 |
| Logs: Independent retention and query capacity | differentiator | PORT-013, PORT-049 |
| Metrics: PromQL and reusable Prometheus alert rules | table-stakes | PORT-014, PORT-019 |
| Metrics: Long-term metric retention | table-stakes | PORT-014 |
| Metrics: Unused-metric aggregation recommendations | differentiator | PORT-023, PORT-030 |
| Metrics: Log reduction recommendations | differentiator | PORT-012, PORT-030 |
| Experience: Browser performance monitoring | table-stakes | PORT-017 |
| Experience: Web Vitals and backend correlation | table-stakes | PORT-017 |
| Experience: Native mobile application performance | premium | PORT-017 |
| Explore: Cross-signal dashboards and variables | table-stakes | PORT-018 |
| Explore: SQL and Lucene-style search | table-stakes | PORT-018, PORT-049 |
| Explore: Visual query builder and data explorer | table-stakes | PORT-018, PORT-049 |
| Explore: Historical query export API | table-stakes | PORT-026, PORT-061 |
| Explore: Deep links into filtered exploration | table-stakes | PORT-018 |
| Explore: Scheduled PDF reports to email and Slack | table-stakes | PORT-047 |
| Detection: Threshold change anomaly forecast composite and log monitors | table-stakes | PORT-019 |
| Detection: SLO budgets and burn-rate monitoring | table-stakes | PORT-021 |
| Detection: Deploy and feature-flag comparisons | table-stakes | PORT-022 |
| Detection: Provider incident and graph handoff | table-stakes | PORT-020, PORT-051 |
| Administration: RBAC and custom roles | table-stakes | PORT-025, PORT-032 |
| Administration: SAML identity | premium | PORT-025 |
| Administration: Native iOS and Android operator apps | table-stakes | PORT-046 |
| Administration: Migration guides for Datadog Grafana and New Relic | table-stakes | PORT-024, PORT-039, PORT-040, PORT-041 |
| Administration: Self-managed deployment | table-stakes | PORT-031 |
| Administration: Configuration as code | table-stakes | PORT-026 |
| Administration: MCP and CLI access | differentiator | PORT-026, PORT-036 |
| Cost: Per-signal usage metering | table-stakes | PORT-023, PORT-038 |
| Cost: Monthly budgets and bill forecasting | table-stakes | PORT-023 |
| Cost: User and data pricing alternatives | differentiator | PORT-023, PORT-038 |
| Agents: GenAI and agent call observability | differentiator | PORT-027 |
| Agents: Cited cross-tool alert investigations | differentiator | PORT-028 |
| Agents: Post-deploy verification and reviewed fix PRs | differentiator | PORT-029 |
| Agents: Read-only integrations with owner query limits | differentiator | PORT-028, PORT-036 |
| Agents: AI investigations within the observability platform | differentiator | PORT-028 |

## Integration coverage

| Inventory service entry | Clauses |
| --- | --- |
| OpenTelemetry SDKs and Collector | PORT-001, PORT-002, PORT-055, PORT-056 |
| Prometheus | PORT-001, PORT-002, PORT-055, PORT-056 |
| StatsD / DogStatsD | PORT-001, PORT-002, PORT-055, PORT-056 |
| Datadog Agent | PORT-001, PORT-002, PORT-055, PORT-056 |
| Fluent Bit | PORT-001, PORT-002, PORT-055, PORT-056 |
| Vector collector | PORT-001, PORT-002, PORT-055, PORT-056 |
| Syslog / syslog-ng | PORT-001, PORT-002, PORT-055, PORT-056 |
| AWS CloudWatch / Lambda / EC2 / RDS / ELB / ECS / EKS | PORT-005, PORT-055 |
| Google Cloud / GKE | PORT-005, PORT-055 |
| Microsoft Azure / AKS | PORT-005, PORT-055 |
| Cloudflare Workers | PORT-005, PORT-055 |
| Vercel | PORT-005, PORT-055 |
| Fly.io | PORT-005, PORT-055 |
| Kubernetes / Docker | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| Nomad | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| PostgreSQL / MySQL | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| Redis / Kafka / Nginx / RabbitMQ | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| MongoDB / Elasticsearch | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| NVIDIA DCGM | PORT-006, PORT-007, PORT-016, PORT-055, PORT-060 |
| OpenAI / Anthropic | PORT-027, PORT-055 |
| GitHub / GitLab / Bitbucket | PORT-022, PORT-029, PORT-055 |
| GitHub Actions | PORT-022, PORT-029, PORT-055 |
| Argo CD | PORT-022, PORT-029, PORT-055 |
| Terraform | PORT-026, PORT-055 |
| LaunchDarkly | PORT-022, PORT-029, PORT-055 |
| Statsig | PORT-022, PORT-029, PORT-055 |
| Unleash | PORT-022, PORT-029, PORT-055 |
| PagerDuty | PORT-020, PORT-051, PORT-055 |
| Opsgenie | PORT-020, PORT-051, PORT-055 |
| incident.io | PORT-020, PORT-051, PORT-055 |
| Rootly | PORT-020, PORT-051, PORT-055 |
| Slack / Microsoft Teams / email / signed webhooks | PORT-020, PORT-051, PORT-055 |
| Jira / Linear | PORT-053, PORT-055 |
| S3 / Cloudflare R2 | PORT-013, PORT-034, PORT-035, PORT-061 |
| Auth / Okta / Microsoft Entra ID / Google Workspace | PORT-025, PORT-032, PORT-052, PORT-055 |
| Oncall / Lamp / Spool / Uptime / Vector / Crank / Evidence | PORT-050, PORT-051, PORT-052, PORT-053, PORT-055 |

## Source boundaries and current limitations

No provider trial, implementation, UI, load qualification or compliance certification was performed by this documentation task. Inventory source links describe current published capability, while these acceptance journeys define the complete destination. Operator/provider acknowledgement and verified recovery remain separate; Oncall incident resolution and Lamp publication stay under their own authority. The literal draft Status SHA placeholder is required until a repository exists; the fresh Base parser currently accepts only hexadecimal SHAs. Parser diagnostics and the transparent in-memory shape qualification are reported separately; no placeholder is represented as a real commit.
