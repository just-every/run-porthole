# Native count monitors

Open `/app/monitors` for Manage and Triggered, and `/app/settings/monitors` to configure a definition. Log and trace count thresholds are implemented. This subset does not qualify the complete PORT-019 catalog or its imported-list and bulk-operation requirements.

Create an inactive definition through `/api/porthole/v1/configuration/monitors` with a native session, the same-origin Origin header and an Idempotency-Key. Supply name, scope and body. Replace an exact revision with PUT and its If-Match tag. Existing definition doors share the same validator. The private OpenAPI document is `/api/porthole/v1/openapi.json`; its MonitorCountBody schema describes these fields:

```json
{
  "signal": "logs",
  "operator": "above",
  "threshold": 3,
  "windowSeconds": 60,
  "windows": [60, 300],
  "pendingSeconds": 30,
  "recoveryThreshold": 1,
  "groupBy": ["service", "environment", "team"],
  "noDataPolicy": "unknown"
}
```

The primary window must appear in windows. Omitted windows uses the primary window alone. Every window must breach the strict threshold throughout the pending interval before firing. A firing episode resolves only when every window reaches the inclusive recovery threshold. Interrupted or incomplete pending evidence restarts the pending interval. Group identities, measured decisions and firing episodes persist across process restart. Editing creates an immutable inactive revision with independent evaluation state.

POST `/api/porthole/v1/monitors/state` with id, revision, state and matching confirm to activate or disable. POST `/api/porthole/v1/monitors/evaluate` with id and revision to evaluate an active definition. GET `/api/porthole/v1/monitors?id=...` returns scoped definitions, revisions and the latest 30 evaluations. Current members can read only definitions whose entire scope they hold; historical revisions and evaluations require that revision's scope too. Mutations retain the existing owner, admin and maintainer definition authority. Revoked and narrowed native sessions are checked on the next request. No credential can mutate these doors.

Each group reports original event-time windows, counts, completeness, pending time and episode identity. One completion watermark binds all counts in an evaluation, in both local and separate analytical storage. The evaluator refuses complete coverage beyond 100 groups, four windows or the existing 100-active-monitor cron pass.

- `measured`: authenticated fresh source coverage and real accepted input establish a count. An empty window can be a measured zero.
- `absent`: a source has not established actual input. A heartbeat alone is insufficient.
- `source-loss`: a stale or revoked registered source, or overlapping recorded source or buffer loss.
- `uncertain-time`: received input cannot establish its original event-time window.
- `unavailable`: the selected analytical backend cannot answer. No local substitute is used.
- `incomplete`: other pipeline coverage or bounded evaluation limits prevent a complete measurement.

The unknown policy exposes Unknown. The alert policy records NoData for absent input with a null count. Keep-last exposes the last measured group decision as last-known only. Source loss, unavailable storage and other incomplete evidence always keep the overall evaluation Unknown; no policy turns these into recovery. Counts and firing episodes remain last-known evidence until new complete measurements support recovery.

Disable retains history and changes no measurements. Archived restores quarantine definitions and retain evaluation history only as inert archive custody. They restore no live evaluator state, credential or activation authority. Existing subject erasure invalidates derived evaluation runs; its source-loss journal and replay fences still apply.

Evaluation changes local state only. Outbound alert routing, paging, Lamp, scheduled delivery and SLO mutation are outside this subset. Numeric metric queries, distinct change and composite engines, statistical types, the remaining monitor families, service defaults, downtime, renotification and full priority parity remain contract gaps.

Disabling a monitor preserves its history. Re-enabling starts a fresh pending
interval and never counts disabled time as a sustained breach. Subject erasure
invalidates count history only for monitor revisions covering the erased signal
and scope; unrelated monitor history remains intact. Native installation exports
retain detailed runs as quarantined history, with no restored evaluation authority.
Archived run custody remains immutable and inactive when a later erasure journal
removes the original telemetry. Those retained facts never feed live evaluation.
