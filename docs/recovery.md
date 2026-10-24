# Recovering Porthole's own pipeline

Porthole's Base control plane keeps authentication, owner grants, durable ingest envelopes, audit and independent notices in its own Worker/D1. With analytical connections configured, product reads, monitor counts and storage/query health use a separately selected primary or standby Worker and its independent store. Accepted data remains durable in the control-plane journal while an analytical process is down. An installation with no analytical bindings retains its earlier local reader; adding any connection binding or authorizing a connection disables implicit local analytical fallback. A control-plane D1 outage still prevents native authentication and its health door: an external check remains necessary under PORT-094.

## Before an incident

Sign in as a member whose service and team scope includes production and open `/app/health` (JSON: `GET /api/v1/health`). This door does not depend on the audit reader or the telemetry query route. It keeps eight separate components: control plane, collector, ingest, queue, storage, query, monitor evaluation, and delivery. No accepted envelope, no collector registration, stale receipts, paused collection and missing workers remain Unknown. A functioning `/health` deployment probe does not turn product coverage green.

The default freshness window is five minutes. Change it from Pipeline health using a native owner or admin session whose identity was verified within the preceding five minutes. A wider window changes when missing coverage is detected; it does not repair coverage. Scoped readers see only their collector, retained telemetry and monitor evidence, without recipients or provider identifiers. Finance readers see component health and timestamps without retained telemetry or monitor evidence. The view displays accepted/indexed arrival times separately from last-known original event nanoseconds. Failed queries retain earlier durable evidence with Unknown status.

Collectors register and renew a heartbeat through `POST /api/v1/health/heartbeat` with a live ingest bearer credential and JSON `{ "collectorId": "your-collector", "team": "your-team", "service": "your-service", "environment": "production", "signal": "logs" }`. Register each signal/scope covered by the collector and heartbeat more frequently than the freshness window. Credential custody, revocation, scope, expiry, signal grant and rate quotas apply on every heartbeat. A heartbeat proves connectivity only; accepted and queryable telemetry require actual intake and indexing.

For independent failure notices, select the installation's Resend or SendGrid transport (`MAIL_PROVIDER=resend` or `sendgrid`, private `MAIL_API_KEY` and verified `MAIL_FROM`). It sends directly to the provider from the control plane, independently of telemetry queries and storage. This feature supports only the explicitly selected provider; it does not switch transports after a failure. Keep the key in the existing private deployment settings and outside portable archives. Then, in Pipeline health, enter the recipient, enable notices and explicitly check the authorization for automatic external email. Saving requires fresh native owner or admin proof. The configurer’s own verified sign-in address is confirmed immediately. Any other address receives one single-use confirmation link, valid for 24 hours; opening it does not confirm, and only its explicit confirmation POST enables notices. Until confirmation, Pipeline health and setup show “Independent notices off — incomplete coverage.” A failed or expired confirmation is visible; save a new configuration to replace it. Replacing or disabling the configuration removes the old grant and invalidates its link. Grant, confirmation and removal are audited without addresses or tokens. Background delivery rechecks that the configurer is still an active owner or admin and the current recipient is confirmed. Development/demo mail is always suppressed. A dead control plane cannot send its own notice; the external uptime check remains necessary.

Cron calls the actual ingest drain, records its result, evaluates active monitors and runs the health tick. An owner or admin can also invoke `POST /api/v1/health/tick` or “Check health and resume notice work” on the health page. This checks real observations, evaluates up to 100 active count monitors and submits at most one pending independent notice. Missing or stale worker activity stays Unknown; viewing the health page never refreshes a worker's freshness receipt.

## Backend or collector outage during a firing monitor

1. Read Pipeline health before stopping the selected component. Activate a reviewed count monitor through Operations. Its definition counts complete retained records in the original event-time window; `above` and `below` compare that count, including for metrics. It is not a metric-value aggregation. Confirm real ingest, a recent authenticated collector heartbeat, a completed drain, and a firing evaluation with a stable episode identity.
2. Stop the collector or deny the analytical query/storage path in the owner-controlled environment. Do not delete accepted envelopes, normalized records, archive rows, monitor state, notice state or audit history. A collector becomes stale after the configured window. A failing backend read becomes Unknown immediately; earlier event metadata and the monitor's last-known count remain visible. Unknown does not resolve a firing episode. Recorded source/buffer loss also makes the monitor window incomplete.
3. Read `GET /api/v1/health` using a production-scope member’s native session. Inspect the affected components, their last accepted/queryable timestamps, collector freshness and the monitor-evaluation evidence. If configured, inspect the independent failure notice and the durable notice status. “Accepted” means the provider accepted submission, not that the recipient's mailbox delivered it.
4. Restart the collector with the same live credential and original event timestamps. Restore access to the same retained D1 data and resume bounded draining. Keep the monitor threshold and original event window unchanged. A fresh complete evaluation can become Healthy or Firing from actual data; an incomplete window stays Unknown. A recovery notice follows a provider-accepted failure notice once that component becomes Healthy.

The current product records exact human approval for a repair definition but has no production repair executor. Health ticks and replayed monitor evaluations never execute that definition. An outage drill here cannot establish PORT-095's real production repair-execution idempotency requirement.

## Resume accepted ingest and notice work

Owners inspect `GET /api/porthole/v1/ingest/status`. Use the native owner controls at `/app/ingest` or `POST /api/porthole/v1/ingest/control` to unpause collection, then `POST /api/porthole/v1/ingest/drain`. Each pass processes at most 20 envelopes (internal worker limit may be explicitly bounded up to 100). A failed manual or scheduled drain immediately records queue health as Unknown, and reading health never refreshes the worker receipt. Repeat while the displayed pending count decreases; do not acknowledge unpersisted intake or rewrite source timestamps. If storage remains unavailable, leave envelopes pending and repair the binding/access instead. A complete envelope's normalized/archive row identity is `(batch_id, ordinal)`; repeated or concurrent drains cannot create another copy. Duplicate source batch identity is checked against the original digest.

Independent notices retain one failure and one recovery record per component episode. Worker restarts reuse the stored message, lease and provider idempotency key. The exact message remains frozen through retries. Resend documents a 24-hour deduplication period; its worker retries stop after 23 hours from the first attempt. See [Resend's idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys). SendGrid does not guarantee equivalent deduplication, so an ambiguous submission or expired in-flight lease becomes uncertain without automatic resubmission. A documented HTTP 429 is a definite refusal: the same frozen notice retries no earlier than Retry-After (delta seconds or HTTP date), with a one-minute fallback for a missing or invalid deadline. A definite SendGrid refusal clears only its uncertainty marker; attempt counts and audit history remain. Crashes before recording that refusal stay uncertain. Resend retains its original deduplication-window fence. Both paths retain the frozen request and original notice identity. Each new notice privately binds its transport grant with an installation-keyed HMAC, in a private outbox column excluded from native and product archives, without storing the API key in the message. A changed key, sender, provider account binding or installation key holds old work before any external request; work from before this binding also requires review. Known-unaccepted work remains rejected; prior unknown acceptance remains uncertain. This prevents a rotation from silently changing the provider deduplication namespace and is not a replacement for a grant vault or account reconciliation. A rejected Resend retry after an earlier unknown attempt is held as uncertain: the latest refusal cannot disprove an earlier unknown acceptance. Reconcile that original notice before considering another message. A sequence of definite refusals remains known unaccepted; it does not acquire false acceptance uncertainty. Rejected and expired-uncertain submissions require owner investigation at the provider; there is no automatic resend with a new identity. Inspect the provider event against the retained notice ID before authorizing any manual message. Reconfiguring notices cancels older pending work and begins new monitoring episodes; an already in-flight request may finish. Background attempt and result audit entries contain only opaque notice identities and status, never recipients, message bodies or transport credentials.


## Separate analytical workers, failover and failback

Stage the edition-owned analytical products with `node scripts/analytical/cli.mjs stage`.
The supported owner lifecycle also accepts `dry-run`, `deploy`, `health`, `inspect`
and `remove` with `--environment` and optional `--role primary|standby`. Keep the
existing project/Worker identifiers and each role's separate owner state file.
Deployment requires the owner's provider authority; a staged artifact alone
proves no deployed installation. PORT-031 still owns the whole installation's
infrastructure and account qualification.

Bind `ANALYTICS_PRIMARY` and `ANALYTICS_STANDBY` to the selected Worker services,
or supply their HTTPS origins through `ANALYTICS_PRIMARY_URL` and
`ANALYTICS_STANDBY_URL`. URL connections require normal TLS verification and
refuse redirects. Give each worker a different private `ANALYTICS_TOKEN`, and
supply the matching value only to the control plane as
`ANALYTICS_PRIMARY_TOKEN` or `ANALYTICS_STANDBY_TOKEN`. Keep these installation
connection secrets out of URLs, logs, browser fields and archives. Collector or
read credentials are not connection credentials. Each worker pins replication
to one installation identity; a different source is refused. Product readers'
current service, environment and team grants are applied on the worker and
rechecked before results leave the control plane, including after revocation.

A native owner with proof from the preceding five minutes opens
`/app/settings/analytics`, reviews the selected primary and explicitly authorizes
replication. Admins and bearer credentials cannot configure it. The corresponding
JSON door is `POST /api/porthole/v1/analytics/configuration` with the current
revision, `role`, `enabled` and `confirm: "connect-analytical-workers"`. The
connection remains suspended if its configurer stops being a current owner or
changes revision; a current owner must explicitly reauthorize it. Changes commit
private audit facts in the same transaction and never expose the secret values.

1. Use **Resume bounded replication**, or the owner reconciliation API
   `POST /api/porthole/v1/analytics/reconcile`. Scheduled/manual ingest drains do
   the same work. Each role copies at most 20 completed envelopes per pass,
   additionally bounded by encoded bytes. Replication preserves event/index
   timestamps, distinct archive receipts and immutable record IDs. Retries check exact content identity. Missing source records or archive receipts are refused, never invented from an indexing time.
2. Inspect both workers' contiguous coverage watermarks in Settings and the
   selected worker's watermark in product query replies. A high sequence above
   a missing prefix does not constitute coverage. Queries and monitor evaluation
   refuse missing coverage rather than reading local analytical copies.
3. During an outage, keep reading authenticated Pipeline health and its scoped
   last-known evidence. Authentication and independent mail submissions remain
   on the Base control plane. Stopped/unreachable analytical workers produce
   Unknown and preserve firing episodes. Accepted intake and pending notices
   remain durable; there is no automatic failover or repair execution.
4. Reconcile the standby until it covers every completed control-plane envelope,
   then select standby and submit the reviewed connection change. A behind
   standby is refused and the selected role remains unchanged, including after a pause. Pausing cannot change the selected role. If new completion
   work races the coverage check, the transaction refuses the change for retry.
   Query through the normal product door and inspect its standby watermark.
5. Restart the primary, resume the actual collector, and run bounded drains and
   reconciliation until the primary catches up. Select primary through the same
   reviewed owner door to fail back. Repeat reads and monitor evaluations under
   the original definition/window; check exact counts and original timestamps.
   Accepted notice identities never acquire a new send just because health is
   ticked again or a role changes.

Whole-product and native Base archives retain connection configuration as
quarantined history, with no connection token or live connection authority.
A restored destination has its own installation identity and starts paused.
Its owner selects separate destination workers and explicitly reconnects before
replaying retained data. Reauthorizing historical storage alone does not create
fresh collector or telemetry coverage. PORT-035's future retention/erasure and
PORT-058's upgrade work inherit this identity, coverage and inactive-restore
boundary before adding destructive maintenance.

`tests/porthole/analytics.mjs` analyticalKernelJourney and
analyticalConnectionJourney exercise separate real Worker/D1 processes through
`tests/runtime.mjs`: product reads/evaluation/health, a collector and primary
process stop, the documented provider-edge independent notice, behind refusal,
manual failover/failback, original nanoseconds, bounded backlog and duplicate
protection. Owner authority changes and an independently owned inactive archive
restore are included. This is separate-backend functional recovery proof; it is
not a deployed Base control-plane outage/restore or repair-provider receipt.

## Back up and restore

Use the supported Base installation commands from the checkout associated with this installation:

```sh
rer export --output exports/installation.rer
```

Protect the installation archive as private owner material. Keep a separate known-good copy and the corresponding source/migration revision. Restore only into an empty, explicitly selected destination:

```sh
rer import --input exports/installation.rer --yes
```

Follow Base's empty-destination and confirmation checks. These installation commands differ from product move-in and product portability. A command description is not evidence that a provider failover or Base restore drill has run. If the destination or data-retention requirement is uncertain, preserve the original installation and obtain the owner's destination decision before import/reset.

For a portable product backup, use Settings → Archive or `node scripts/porthole/archive.mjs export ORIGIN DIRECTORY`, with a fresh native owner session supplied through `PORTHOLE_ARCHIVE_COOKIE` in the private environment. Preserve the completed manifest digest independently. The export freezes actual normalized telemetry, retained archive rows, current product definitions and historical audit chains. Raw intake wire bytes are retained; native authentication and approval authority are excluded. Resume the same export job's sequential chunk door after interruption; do not mix chunks from different jobs.

Product restore uses `node scripts/porthole/archive.mjs restore ORIGIN DIRECTORY --confirm` or Settings → Archive. It stages and validates every manifest/chunk and commits only to an empty product beside the destination's bootstrapped native owner and current audit/erasure history. The commit requires the exact manifest root hash. Restored historical actors are inactive; definitions are quarantined, approvals are not executable, and collection remains paused. Imported event/index times do not assert current live health. Review configuration, activate only approved definitions, establish new destination credentials/collector heartbeats, resume intake and compare retained counts/event times before handing traffic over. Source cleanup is a separate owner decision.

The executed local Base export/import journey qualifies inactive data transfer and an independently bootstrapped destination owner. The held-key production-mode mail journey qualifies native consent, collector-loss notification, controlled-mailbox delivery and restart without duplicate submission. Separate analytical workers are connected to product query, monitor evaluation and health, with the combined process-stop/failover journey under PORT-093 above. A deployed Base control-plane outage/restore remains unqualified under PORT-094. Real production repair execution remains unqualified under PORT-095 and requires an owner-authorized repair-provider estate and scoped execution credentials. PORT-037 now covers pipeline health, collector outage, analytical read failure and durable ingest/notice resume; its production-mode Worker recovery journey proves those current doors with a SendGrid network-edge fixture. Separate-backend, deployed-restore and repair-execution proof is not inferred from this journey.

Independent notices follow ct's approved 22 October 2026 policy: owner and admin configure them from a native session with fresh step-up. The configurer's own verified sign-in address is confirmed immediately; any other recipient must use its single-use confirmation link before receiving notices. Grants, confirmations and removals are audited. Until a recipient is confirmed, Pipeline health and setup show 'Independent notices off' as incomplete coverage, never Healthy.

PORT-020, PORT-047, PORT-051 and PORT-059 inherit these accepted/refused/uncertain distinctions and provider-deadline handling before adding their own delivery adapters. This independent-mail proof does not establish those future adapters or the full PORT-055 lifecycle.

The focused independent-mail drill runs the actual emitted Worker with only the
provider network edge replaced. After building, run `PORTHOLE_MAIL_ONLY=1 node
tests/runtime.mjs` for SendGrid and repeat with `PORTHOLE_MAIL_PROVIDER=resend`
for the documented Resend JSON and idempotency contract. The journeys use actual
retry deadlines and process restarts; preserve their output and screenshots
outside the product checkout. These are provider-edge proofs, not live mailbox
receipts or qualification of the still-incomplete connector registry.
