# Native SLO calculation and report API

This is a partial native surface. It does not qualify source migration,
monitor uptime, time slices, scheduling, delivery, or complete unsampled traffic.
The follow-up monitor recovery guard remains independent and unchanged.

Use a native session at the installation origin. Create an immutable revision
with POST to `/api/porthole/v1/slos`. A current owner with identity proof from
the last five minutes supplies `name`, `confirm: "save-slo"`, and `definition`:

- `type`: `event-ratio` or `metric-ratio`.
- `scope`: exactly one service, environment and team, with no wildcard.
- `sourceId`: the original ingest credential reference, not its secret.
- `targetPpm`: an integer between 1 and 999999.
- `latencyMs`: a positive integer for an event latency threshold, or null.
- `goodMetric` and `totalMetric`: distinct metric names for a metric ratio;
  both null for event ratios.
- `exclusions`: up to 32 nonoverlapping half-open intervals, each with numeric
  UTC epoch milliseconds `from`, `through`, and a reviewed `reason`.

To revise, supply the original `id` and current `revision` alongside the new
definition. Stale writes fail. GET on the same endpoint lists visible revisions.
Every read and calculation rechecks current native membership and complete scope.
Only current owners create definitions; ownership is an opaque original actor
reference, never transferred approval authority. This conservative creation
policy awaits ct approval; later SLO and report creation doors inherit it until
ruled otherwise. No destination or outbound authority is granted by this API.

POST to `/api/porthole/v1/slos/evaluate` or
`/api/porthole/v1/reports/slo` with `slos: [{id, revision}]`, `from`, and
`through`. The fixed half-open window is at most 31 days and cannot end in the
future. Select up to 20 distinct SLOs; the whole request fails if any selected
revision is unavailable or outside the current scope. The report uses UTC and
explicit +00:00 offset; local calendar windows and DST schedules are not built.
JSON is the default. Report requests also accept `format: "csv"`; PDF is refused.
JSON retains full definitions, exclusions and coverage counters. CSV contains
the identifying revision, original bounds, source, type, exact good, total and
bad counts, exact allowed and remaining budget numerators, common denominator,
coverage, health and calculated 75 percent crossing. CSV is a compact projection,
not a substitute for the full JSON coverage detail. Labels are quoted and
formula-prefixed labels are escaped.

Event ratios count retained OTLP SERVER spans from the exact source and scope.
An event is good when its status is not ERROR and its duration is at most the
optional latency threshold. Exclusions use original start time. Metric ratios
accept only nonnegative integer, monotonic DELTA sums without point dimensions.
Good and total must have exactly one matching interval; good cannot exceed total.
Overlapping intervals, missing pairs, cumulative sums, gauges, nonzero point
flags, and intervals partly crossing a window or exclusion boundary are incomplete.
A fully excluded metric interval contributes no events. Unsupported records
never become good by interpolation. The scan refuses more than 20000 retained
records per SLO rather than returning truncated totals.

With target T in parts per million and eligible total N, allowed budget is
N * (1000000 - T) / 1000000. Spent budget is the bad event count B; remaining
budget is allowed minus B, including negative values. Consumed budget is
B * 1000000 / (N * (1000000 - T)). Fractions and event counts use integer
strings so values above the JavaScript safe integer limit remain exact.
The 75 percent calculation compares integer cross products. Zero traffic has
no consumed fraction. This is a calculated crossing, not an alert delivery.

Each calculation reads original retained evidence again, including late arrivals;
no persisted report can survive erasure as a stale healthy summary. Pending
intake, loss events and unsupported records disclose incomplete coverage.
Otherwise coverage remains unverified: the source has no independent manifest
proving full unsampled traffic. Health always remains Unknown. Exact coverage
intervals, full source segmentation, fast and slow burn alerts, calendar periods,
and source-compatible uptime remain open obligations of PORT-021 and PORT-084.
No Lamp event is sent. PORT-047 retains scheduled recipient authorization,
provider reconciliation, revocation, capacity and USD-cost reporting obligations.

The product archive retains every SLO revision. Independent restore quarantines
all revisions; it does not transfer the old owner's authority, activate a
definition, or start reports or outbound delivery. Quarantined revisions remain
portable history and cannot be evaluated or revised through the active API.
