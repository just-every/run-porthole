<!-- Generated from CONTRACT.md. -->
# Porthole homepage claims

| Claim | Section | Clauses | Status |
| --- | --- | --- | --- |
| Porthole collects every trace, metric, log and profile | 01 hero | `PORT-001` partial; `PORT-009` missing; `PORT-011` missing; `PORT-014` missing; `PORT-015` missing | partial |
| It follows each slow request to the query or deploy behind it | 01, 03 | `PORT-009` missing; `PORT-016` missing; `PORT-022` missing | missing |
| It readies the fix (a rollback a named person approves) and proves recovery against the SLO | 01, 04 | `PORT-028` missing; `PORT-029` missing; `PORT-021` partial | partial |
| Logs are archived in the customer's own bucket (R2, Parquet), readable without Porthole | 01, 09, 11 | `PORT-013` missing; `PORT-061` partial | partial |
| An alternative to Datadog, New Relic and Grafana Cloud | 01 | `PORT-024` missing; `PORT-039` missing; `PORT-040` missing; `PORT-041` missing | missing |
| Every service is discovered from its own traffic with owner, rate, p95 and errors, on one service map | 02 | `PORT-008` missing; `PORT-001` partial | partial |
| Services keep their OpenTelemetry SDKs and the Datadog Agent unchanged | 02, 10 | `PORT-001` partial; `PORT-002` missing | partial |
| A trace opens down to its slow span, the query, its plan (Seq Scan, rows removed) and the deploy that changed it | 03 | `PORT-009` missing; `PORT-016` missing; `PORT-022` missing | missing |
| A log line is linked to its trace by traceparent | 03, 09 | `PORT-011` missing | missing |
| A profile shows where the slow span's time went (off-CPU, pgx Query) | 03 | `PORT-015` missing | missing |
| Slow traces are compared with the baseline by attribute (db.statement, service.version) | 03 | `PORT-009` missing; `PORT-085` missing | missing |
| A p95 monitor fires and pages the on-call through Oncall and Slack | 04 | `PORT-019` missing; `PORT-020` missing; `PORT-051` missing; `PORT-066` missing | missing |
| The agent tests causes and posts the one that held with its cited queries, Spool errors included | 04 | `PORT-028` missing; `PORT-050` missing | missing |
| The readied rollback rebuilds the index without changing data, after a person approves it in Slack | 04 | `PORT-029` missing; `PORT-077` missing | missing |
| SLO error budget is tracked (43.2 min budget, 11.4 used, 31.8 left) | 04 | `PORT-021` partial; `PORT-084` missing | partial |
| Lamp's status component and Vector's follow-up get the incident's evidence | 04 | `PORT-051` missing; `PORT-053` missing; `PORT-059` done | partial |
| Kubernetes OOM kills arrive as events with pod memory, owner and cluster | 05 | `PORT-007` missing | missing |
| The agent explains a quiet failure without paging and opens the resize pull request a team merges | 05, 06 | `PORT-020` missing; `PORT-028` missing; `PORT-029` missing; `PORT-082` missing | missing |
| The agent instruments an untraced service by pull request; coverage goes to 46 of 46 | 07 | `PORT-030` missing; `PORT-004` done; `PORT-008` missing | partial |
| Noisy monitors are retuned by pull request after a replay against history | 07 | `PORT-030` missing; `PORT-019` missing; `PORT-026` partial | partial |
| A tag that multiplies a metric's series is caught and fixed by a merged pull request | 08 | `PORT-023` missing; `PORT-083` missing; `PORT-014` missing | missing |
| A debug log nobody reads is dropped by an approved rule, error lines kept | 08 | `PORT-023` missing; `PORT-012` missing; `PORT-030` missing | missing |
| Logs a day by team are shown against the old total | 08 | `PORT-023` missing | missing |
| Card numbers and SSNs are masked before indexing, with raw storage searched to prove it | 09 | `PORT-012` missing; `PORT-025` missing | missing |
| Fifteen days stay hot; older logs are rehydrated from the archive and searchable in minutes | 09 | `PORT-013` missing; `PORT-073` missing | missing |
| An auditor gets a read-only role over auth logs, and the answer is sent to Evidence | 09 | `PORT-025` missing; `PORT-052` missing | missing |
| Datadog dashboards, monitors and SLOs come across, with the ones that cannot translate flagged | 10 | `PORT-024` missing; `PORT-039` missing; `PORT-086` missing | missing |
| The Datadog Agent dual-ships metrics, logs and traces to Porthole by three Helm values entries | 10 | `PORT-002` missing; `PORT-045` missing; `PORT-062` missing | missing |
| Every alert fired in both tools during the dual-ship week | 10 | `PORT-024` missing; `PORT-045` missing; `PORT-080` missing | missing |
| New Relic and Grafana move the same way | 10 | `PORT-040` missing; `PORT-041` missing | missing |
| Every service stays in view on the busiest day | 11 | `PORT-057` missing; `PORT-072` missing | missing |
| 100% free and open source | 01, 11 | — | code: `LICENSE` (MIT) |
| One line starts Porthole on your computer (`npx -y @runeditrun/rer dev just-every/run-porthole` → ready) | 10 | `PORT-031` missing | missing |

## Clause status

These are contract statuses, not a claim that a partial or missing capability is complete. Read the [product contract](/docs/contract) for requirements, named journeys and remaining work.

10 done, 17 partial, 71 missing; 98 total.

| Clause | Capability | Status |
| --- | --- | --- |
| PORT-031 | Owner-run Base installation | missing |
| PORT-032 | Sign-in and accountable membership: roles, links and removal | done |
| PORT-091 | Sign-in and accountable membership: devices, running work and handover | missing |
| PORT-033 | Durable audit with private contents | done |
| PORT-034 | Complete inactive archive and restore | done |
| PORT-096 | Mixed-subject erasure, analytical custody and retention expiry | missing |
| PORT-097 | Erasing a log subject after a native backup erases every batch holding that subject, including backed-up custody, and never fails with history_immutable | done |
| PORT-035 | Retention and operator-directed erasure | partial |
| PORT-036 | Agents are scoped credentials: identity, grants and custody | done |
| PORT-092 | Agents are scoped credentials: jobs, untrusted data and secret exclusion | partial |
| PORT-037 | Recovery of observability itself: pipeline health, collector outage and durable resume | done |
| PORT-093 | Recovery of observability itself: separate analytical backend and failover | done |
| PORT-094 | Recovery of observability itself: deployed Base control-plane outage and restore | missing |
| PORT-095 | Recovery of observability itself: no duplicate repair execution | missing |
| PORT-038 | US organization defaults and cost commitments | missing |
| PORT-001 | OpenTelemetry-native ingest | partial |
| PORT-002 | Drop-in compatible intake | missing |
| PORT-003 | One-command collector | missing |
| PORT-004 | Language auto-instrumentation | done |
| PORT-005 | Cloud and serverless integrations | missing |
| PORT-006 | Technology integration library | missing |
| PORT-007 | Infrastructure and Kubernetes explorer | missing |
| PORT-008 | APM and service catalog | missing |
| PORT-009 | Trace explorer | missing |
| PORT-010 | Sampling that keeps what matters | partial |
| PORT-011 | Log management | missing |
| PORT-012 | Log pipelines | missing |
| PORT-013 | Tiered storage and archives | missing |
| PORT-014 | Metrics engine | missing |
| PORT-015 | Continuous profiling | missing |
| PORT-016 | Database monitoring | missing |
| PORT-017 | Frontend and mobile performance | missing |
| PORT-018 | Dashboards and one explore view | partial |
| PORT-049 | Correct and bounded exploration | partial |
| PORT-019 | Monitors | missing |
| PORT-020 | Alert routing | missing |
| PORT-021 | SLOs and error budgets | partial |
| PORT-022 | Change tracking | missing |
| PORT-023 | Telemetry cost control | missing |
| PORT-024 | Migration from incumbents | missing |
| PORT-025 | Access audit and compliance | missing |
| PORT-026 | Observability as code and agent access | partial |
| PORT-027 | LLM and agent observability | partial |
| PORT-098 | Prompt and response content events are refused by event name, with or without provider metadata, and never stored or exported | missing |
| PORT-039 | Datadog complete account migration | missing |
| PORT-040 | New Relic complete account migration | missing |
| PORT-041 | Grafana and open-stack migration | missing |
| PORT-042 | Dynatrace migration | missing |
| PORT-043 | Splunk Observability migration | partial |
| PORT-044 | Challenger and AI-SRE switching | partial |
| PORT-045 | Historical data and reversible mid-stream cutover | missing |
| PORT-046 | Native mobile operator access | missing |
| PORT-047 | Scheduled reports and exports | partial |
| PORT-048 | Collaborative notebooks and safe sharing | partial |
| PORT-050 | Spool and Uptime evidence handoffs | missing |
| PORT-051 | Oncall and Lamp keep response ownership | missing |
| PORT-052 | Auth and Evidence integrations | missing |
| PORT-053 | Issues and general workflow handoffs | missing |
| PORT-054 | Performance scope and neighboring products | missing |
| PORT-055 | Dependable integration lifecycle | partial |
| PORT-056 | Telemetry delivery and loss accounting | done |
| PORT-057 | Measured switching-buyer capacity | missing |
| PORT-058 | Safe updates and fleet compatibility | missing |
| PORT-059 | Accountable follow-up | done |
| PORT-060 | Network and messaging performance | missing |
| PORT-061 | Portable signals and open interfaces | partial |
| PORT-028 | Investigation agent | missing |
| PORT-029 | Approved remediation | missing |
| PORT-030 | Coverage noise and cost gardener | missing |
| PORT-062 | Datadog trace and direct API continuity | missing |
| PORT-063 | Terraform and repository ownership cutover | missing |
| PORT-064 | Estate integration and custom-check coverage | missing |
| PORT-065 | Measured switching-cost projection | missing |
| PORT-066 | Notification templates handles and Slack controls | missing |
| PORT-067 | Complete monitor type catalog | missing |
| PORT-068 | Dashboard widget function and publishing catalog | missing |
| PORT-069 | General events explorer and overlays | missing |
| PORT-070 | Detection on newly discovered services | missing |
| PORT-071 | Named cloud coverage and Lambda performance | missing |
| PORT-072 | Automatic incident burst capacity | missing |
| PORT-073 | Full hot retention at sustained ingest | missing |
| PORT-074 | Backend operation burden and support | missing |
| PORT-075 | Public documentation and guided first service | partial |
| PORT-076 | Defined anomaly forecast and outlier quality | missing |
| PORT-077 | Executable approved repair targets | missing |
| PORT-078 | Custom span-derived metrics before sampling | partial |
| PORT-079 | Guard releases before monitors fire | missing |
| PORT-080 | Run and explain the Datadog switch | missing |
| PORT-081 | Learn incidents and audit missed detections | missing |
| PORT-082 | Prepare saturation fixes before breach | missing |
| PORT-083 | Trace telemetry bill spikes to source commits | missing |
| PORT-084 | All SLO types with source-exact budgets | missing |
| PORT-085 | Qualified retained and live trace search | missing |
| PORT-086 | Required multi-vendor query translation floor | missing |
| PORT-087 | Loki and Pyroscope shipper continuity | missing |
| PORT-088 | Read existing Datadog log archives | missing |
| PORT-089 | Backfill useful metric history | missing |
| PORT-090 | Keep investigation traces beyond hot retention | missing |
