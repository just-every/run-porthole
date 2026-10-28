<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Porthole homepage claims

A claim is done when every clause behind it is done, missing when every one is missing, and partial otherwise.

| # | Claim | Section | Clauses | Status |
| --- | --- | --- | --- | --- |
| 1 | Porthole collects every trace, metric, log and profile | 01 hero | `PORT-001` partial; `PORT-009` missing; `PORT-011` missing; `PORT-014` missing; `PORT-015` missing | partial |
| 2 | It follows each slow request to the query or deploy behind it | 01, 03 | `PORT-009` missing; `PORT-016` missing; `PORT-022` missing | missing |
| 3 | It readies the fix (a rollback a named person approves) and proves recovery against the SLO | 01, 04 | `PORT-028` missing; `PORT-029` missing; `PORT-021` partial | partial |
| 4 | Logs are archived in the customer's own bucket (R2, Parquet), readable without Porthole | 01, 09, 11 | `PORT-013` missing; `PORT-061` partial | partial |
| 5 | An alternative to Datadog, New Relic and Grafana Cloud | 01 | `PORT-024` missing; `PORT-039` missing; `PORT-040` missing; `PORT-041` missing | missing |
| 6 | Every service is discovered from its own traffic with owner, rate, p95 and errors, on one service map | 02 | `PORT-008` missing; `PORT-001` partial | partial |
| 7 | Services keep their OpenTelemetry SDKs and the Datadog Agent unchanged | 02, 10 | `PORT-001` partial; `PORT-002` missing | partial |
| 8 | A trace opens down to its slow span, the query, its plan (Seq Scan, rows removed) and the deploy that changed it | 03 | `PORT-009` missing; `PORT-016` missing; `PORT-022` missing | missing |
| 9 | A log line is linked to its trace by traceparent | 03, 09 | `PORT-011` missing | missing |
| 10 | A profile shows where the slow span's time went (off-CPU, pgx Query) | 03 | `PORT-015` missing | missing |
| 11 | Slow traces are compared with the baseline by attribute (db.statement, service.version) | 03 | `PORT-009` missing; `PORT-085` missing | missing |
| 12 | A p95 monitor fires and pages the on-call through Oncall and Slack | 04 | `PORT-019` missing; `PORT-020` missing; `PORT-051` missing; `PORT-066` missing | missing |
| 13 | The agent tests causes and posts the one that held with its cited queries, Spool errors included | 04 | `PORT-028` missing; `PORT-050` missing | missing |
| 14 | The readied rollback rebuilds the index without changing data, after a person approves it in Slack | 04 | `PORT-029` missing; `PORT-077` missing | missing |
| 15 | SLO error budget is tracked (43.2 min budget, 11.4 used, 31.8 left) | 04 | `PORT-021` partial; `PORT-084` missing | partial |
| 16 | Lamp's status component and Vector's follow-up get the incident's evidence | 04 | `PORT-051` missing; `PORT-053` missing; `PORT-059` done | partial |
| 17 | Kubernetes OOM kills arrive as events with pod memory, owner and cluster | 05 | `PORT-007` missing | missing |
| 18 | The agent explains a quiet failure without paging and opens the resize pull request a team merges | 05, 06 | `PORT-020` missing; `PORT-028` missing; `PORT-029` missing; `PORT-082` missing | missing |
| 19 | The agent instruments an untraced service by pull request; coverage goes to 46 of 46 | 07 | `PORT-030` missing; `PORT-004` done; `PORT-008` missing | partial |
| 20 | Noisy monitors are retuned by pull request after a replay against history | 07 | `PORT-030` missing; `PORT-019` missing; `PORT-026` partial | partial |
| 21 | A tag that multiplies a metric's series is caught and fixed by a merged pull request | 08 | `PORT-023` missing; `PORT-083` missing; `PORT-014` missing | missing |
| 22 | A debug log nobody reads is dropped by an approved rule, error lines kept | 08 | `PORT-023` missing; `PORT-012` missing; `PORT-030` missing | missing |
| 23 | Logs a day by team are shown against the old total | 08 | `PORT-023` missing | missing |
| 24 | Card numbers and SSNs are masked before indexing, with raw storage searched to prove it | 09 | `PORT-012` missing; `PORT-025` missing | missing |
| 25 | Fifteen days stay hot; older logs are rehydrated from the archive and searchable in minutes | 09 | `PORT-013` missing; `PORT-073` missing | missing |
| 26 | An auditor gets a read-only role over auth logs, and the answer is sent to Evidence | 09 | `PORT-025` missing; `PORT-052` missing | missing |
| 27 | Datadog dashboards, monitors and SLOs come across, with the ones that cannot translate flagged | 10 | `PORT-024` missing; `PORT-039` missing; `PORT-086` missing | missing |
| 28 | The Datadog Agent dual-ships metrics, logs and traces to Porthole by three Helm values entries | 10 | `PORT-002` missing; `PORT-045` missing; `PORT-062` missing | missing |
| 29 | Every alert fired in both tools during the dual-ship week | 10 | `PORT-024` missing; `PORT-045` missing; `PORT-080` missing | missing |
| 30 | New Relic and Grafana move the same way | 10 | `PORT-040` missing; `PORT-041` missing | missing |
| 31 | Every service stays in view on the busiest day | 11 | `PORT-057` missing; `PORT-072` missing | missing |
| 32 | 100% free and open source | 01, 11 | — | done |
| 33 | One line starts Porthole on your computer (`npx -y @runeditrun/rer dev just-every/run-porthole` → ready) | 10 | `PORT-031` missing | missing |

Claims: 33; 1 done, 9 partial, 23 missing.
