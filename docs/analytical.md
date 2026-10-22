# Separate analytical workers

The analytical kernel lives in `workers/analytics/`. It is native Worker ESM,
with one D1 binding named `DB` per deployment. The primary and standby are
different owner-deployed products, with different Workers, databases and deploy
state files. Neither analytical Worker has a binding to the Base control-plane
database. Stopping either Worker leaves the other Worker and Base running.

`workers/analytics/manifest.json` names the two new product identities and their
control-plane service bindings. The existing Porthole product, Worker and D1
identities stay as declared by the application. This implementation supplies the
kernel and lifecycle seams; the application must bind the services, replicate
completed ingest, authorize callers and select the analytical target.

## Private protocol

All `/v1/` routes require `Authorization: Bearer <ANALYTICS_TOKEN>`. The owner
supplies the same private secret to the control plane and both analytical
Workers. Deployment sets `workersDev: false`; calls use private Cloudflare
service bindings. No bearer credentials, native sessions or arbitrary SQL are
accepted as analytical query authority. The application verifies its current
native session or delegated credential and passes only the resulting scope.
The shared analytical token is a trusted service capability and must never be
released to a client.

The only unauthenticated route is `GET /health`. It checks the actual analytical
D1 schema and reports deploy-kit source, fingerprint and version metadata. This
is deployment readiness, not complete/fresh product coverage. With the deployed
workers.dev route disabled, owner-cli health checks provider readback; an
authenticated service call must separately establish analytical runtime health.

`POST /v1/replicate` accepts JSON with `sourceIdentity` and `batches`. The source
identity is a stable installation lineage; do not generate another one on a
restart. Each batch contains:

```json
{
 "id": "synthetic-porthole-1",
 "completionSequence": 1,
 "sourceId": "synthetic-porthole-2",
 "signal": "logs",
 "digest": "synthetic-porthole-3",
 "acceptedAt": 1,
 "completedAt": 2,
 "records": [{
  "id": "synthetic-porthole-1:0", "ordinal": 0,
  "team": "checkout", "service": "payments", "environment": "production",
  "eventTimeNs": "01791300000123456789", "traceId": null, "spanId": null,
  "payload": { "record": { "body": "synthetic-porthole-4" } },
  "indexedAt": 2, "late": 0, "outOfOrder": 0
 }]
}
```

Replicate only completed immutable control-plane ingest batches and their actual
normalized records, retaining the source `completion_sequence`, batch/source
IDs, digest, ordinal, payload, indexed time, late/out-of-order flags and original
event nanoseconds. Timestamps remain zero-padded decimal strings, never floating
point numbers or arrival times. A source batch with zero records remains a real
batch and advances coverage. An empty `batches` array initializes the lineage at
watermark zero without inventing telemetry.

Each request is bounded to 2 MiB of actual streamed UTF-8 bytes, 20 batches and
10,000 records. The caller must bound the serialized representation as well as
the batch count; metadata added to a source envelope consumes this budget.
The whole request is validated before writes, then batch manifests and records
are committed in one D1 transaction. Record identity is the original
`batch_id:ordinal`. Repeating an identical batch is idempotent. Changing content
under an existing batch ID, reusing a completion sequence or changing the source
lineage refuses. The original source digest is retained; a separate SHA-256 of
the canonical complete normalized batch fences any conflicting replay. Failed
or lost acknowledgements are safe to retry with the same contents.

`GET /v1/health` and `GET /v1/manifest` return the lineage, contiguous watermark,
highest received sequence, batch/record counts, last replication/acceptance/queryable
times and independent stop state. A replica may have a high received sequence
with a lower contiguous watermark; receiving sequence two without one covers
watermark zero. The manifest is an inventory summary, not a backup archive.

`POST /v1/coverage` accepts `{ "sourceIdentity": "…", "requiredWatermark": 12 }`.
It refuses a foreign lineage, an independently stopped backend or any missing
sequence up to the required watermark. `requiredWatermark` comes from the
authoritative completed-ingest watermark in Base at the time of the decision.
An old cached watermark must not authorize failover. Base must also report
pending accepted ingest, source loss and collector freshness independently;
completed-batch coverage does not prove live collection or a complete monitor
event-time window.

`POST /v1/query` accepts `sourceIdentity`, `requiredWatermark`, `signal`, `from`,
`through`, and `scope: { teams: [], services: [], environments: [] }`. All three
scope arrays are mandatory, each with at most 100 entries; an empty array grants
nothing and `"*"` grants that dimension. Optional `team`, `service` and
`environment` filters must already be granted. The supported modes are default
`records` and explicit `count`; there is no SQL, expression or provider proxy.

Record queries support `limit` (1–200), an opaque `cursor`, `snapshot` and the
boolean `archive` label. Carry the original scope, range and returned snapshot
on subsequent pages. A snapshot cannot exceed the required watermark. Count
queries count complete records in that exact snapshot and original inclusive
event-time range; they do not aggregate metric values. Responses carry explicit
coverage and a stable event-time/ID cursor. Both selected rows and payload bytes
are bounded before D1 returns a page, and the final JSON is limited to 2 MiB.
A single unpageable record refuses instead of reporting an empty result.
`archive` reads the same immutable replicated complete records; this kernel
does not implement a separate cold-storage lifecycle.

Failures return JSON `{ "error": "…" }`, with 401 for authentication, 400 for
invalid input, 409 for source/identity/incomplete coverage, 413 for bounded input
or output limits and 503 for stopped or unavailable storage. Unknown storage
errors never return an empty successful query. There is no automatic fallback
to Base telemetry or an unqualified stale replica.

`POST /v1/control` accepts `{ "stopped": true }` or `{ "stopped": false }`.
It persists an explicit maintenance stop in only that Worker's D1, preserving
all records. Replication, coverage and queries refuse while stopped. Health,
manifest and control remain accessible to the authenticated service. For an
actual process outage proof, stop only the supervised Wrangler PID instead.

## Supported lifecycle

`scripts/analytical/lifecycle.mjs` uses only published rer package seams:
`commandAdapter` from `@runeditrun/rer/adapter`, `localInstaller` from
`@runeditrun/rer/local-installer`, and the deploy-kit `owner-cli` export.
The exported adapter supplies a staging build hook. The application composes
`analyticsLifecycle` into its deployment workflow before deploying its service
bindings. This module does not replace Porthole's root adapter or command marker.

`stageAnalytics(root)` returns each role's product directory, declaration,
service binding and local Wrangler config. It writes actual ESM modules, the
analytical SQL migrations and the deploy-kit's supported `no_bundle` module
inventory under `workers/analytics/.staged/{primary,standby}`. It runs no build
subprocess, dependency installer or tests. Staging both roles is also available
through:

```sh
node scripts/analytical/cli.mjs stage
```

The current pinned rer packages only `migrations/core/*.sql` into binding `DB`.
Each analytical role is therefore its own product with its own `DB`; placing a
secondary analytical D1 in the root product would not apply these migrations.
Deploy-kit handles D1 creation/migration, exact committed-source verification,
resource custody, resumable provisioning, secret binding, upload identity and
drift checks. Each role uses its own state file at
`workers/analytics/.state/ENVIRONMENT-ROLE.json`. Preserve and back up those
private custody files alongside Base's deployment state.

From a committed checkout, supply owner-approved provider credentials and
`ANALYTICS_TOKEN` through the process environment, without printing their values.
Then run:

```sh
node scripts/analytical/cli.mjs dry-run --environment production
node scripts/analytical/cli.mjs deploy --environment production
node scripts/analytical/cli.mjs health --environment production
```

Use `--role primary` or `--role standby` to act on one product. Dry run still
needs provider credentials because the supported owner-cli reads the selected
target's secret bindings. Both products must exist before deploying a control
plane with their service bindings. `analyticalServices(root)` returns the two
supported deploy-declaration service entries. The root declaration must also
declare `ANALYTICS_TOKEN` as a secret; the scripts never copy it into a staged
config or a deploy receipt.

`inspect` and `remove` delegate to the same role-specific owner-cli state.
Removal deletes that role's owned Worker and database; it is not an outage stop
or a recovery step. Do not use removal to test failover. Secret rotation uses
owner-cli's explicit `secret --set ANALYTICS_TOKEN` with the staged declaration,
same environment and exact role state file; coordinate the shared service
capability across all three Workers.

## Local outage evidence

Stage first. Apply each role's real migrations with a different persistence
directory, then run each as a separately supervised Wrangler process on a free
port. For example, the primary's commands are:

```sh
pnpm exec wrangler d1 migrations apply DB --local \
 --config workers/analytics/.staged/primary/wrangler.json \
 --persist-to workers/analytics/.state/local-primary
pnpm exec wrangler dev \
 --config workers/analytics/.staged/primary/wrangler.json \
 --persist-to workers/analytics/.state/local-primary \
 --ip 127.0.0.1 --port 8791 --var ANALYTICS_TOKEN:synthetic-porthole-1
```

Use the standby config, `local-standby` persistence and another free port for
the second process. The displayed token above is synthetic test input only.
Real secrets belong in private inputs. Record each process PID, stop only the
selected owned PID and restart it with the same persistence directory. Do not
kill shared Wrangler processes or delete D1 files.

The application outage journey must show that a stale/incomplete standby is
refused, then replicate every missing completed sequence and qualify it against
the current Base watermark before switching. Restart the original primary,
replay identical batches and query the same snapshot to prove stable IDs,
counts and original nanoseconds. Base's authenticated health and independent
notice delivery must continue while the selected analytical process is down.

Separate Workers and D1 databases protect against one analytical process or
database being stopped. They do not establish independence from an account-wide
Cloudflare outage, replace Base backup/restore, implement a production repair
executor, establish capacity qualification or supply a complete installation
archive. Those obligations require their own actual public-door evidence.
