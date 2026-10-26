# Splunk collector OTLP repointing

The committed [collector configuration](../collectors/splunk/collector.yaml)
uses the unchanged Splunk OpenTelemetry Collector, an OTLP HTTP receiver and
its supported `otlphttp` exporter for traces, metrics and logs. It can change
destination and authorization through private environment inputs while the
SDK endpoint, receiver and pipeline configuration stay the same. The exporter
appends `/v1/traces`, `/v1/metrics` and `/v1/logs` to the destination origin.
[Splunk's component inventory](https://github.com/signalfx/splunk-otel-collector/blob/v0.135.0/docs/components.md)
includes these components. The [official exporter configuration](https://github.com/open-telemetry/opentelemetry-collector/blob/v0.135.0/exporter/otlphttpexporter/README.md)
documents the endpoint, JSON encoding and compression settings;
[Splunk's HTTP settings](https://help.splunk.com/en/splunk-observability-cloud/manage-data/splunk-distribution-of-the-opentelemetry-collector/get-started-with-the-splunk-distribution-of-the-opentelemetry-collector/get-started-understand-and-use-the-collector/common-configuration-options/http-settings)
document exporter headers.

This is a supported OTLP pipeline in the Splunk distribution. Splunk's default
`signalfx` metric exporter and `splunk_hec` log exporter use different wire
protocols. Their destination cannot simply be changed to Porthole's OTLP
origin. Replacing those exporters requires a separately reviewed pipeline
change and a matching source comparison. This qualification does not establish
their compatibility, a real Splunk account's ingestion, SignalFlow parity,
historical continuity, application performance coverage or source retirement.

## Explicit acquisition

The executable is pinned to the official
[v0.135.0 release](https://github.com/signalfx/splunk-otel-collector/releases/tag/v0.135.0).
The [acquisition helper](../collectors/splunk/release.mjs) pins each asset's
size and SHA-256 from the official GitHub release metadata. It streams the
download to a private temporary file, verifies integrity before making it
executable and atomically publishes the cache entry. It rechecks cached files;
a corrupt cache fails. There is no package installer, substitute executable or
automatic acquisition inside the migration test.

Supported assets are macOS arm64 and Linux x64. The download is approximately
383 MB or 395 MB respectively. Acquire it explicitly when a heavy-work slot is
available, subject to the home's load limit:

```sh
nice -n 15 node collectors/splunk/release.mjs
```

The command prints only the verified local executable path. The default cache
is `./.cache/splunk-collector`; set `PORTHOLE_SPLUNK_COLLECTOR_CACHE` to choose
another private directory. Set `PORTHOLE_SPLUNK_COLLECTOR_BIN` to the resulting
path for qualification. The journey verifies supplied executable bytes too.
It fails when the executable is absent or has a different digest.

## Owner-applied private configuration

No migration import changes a running collector or grants collection authority.
Review the actual receiver and processors before applying this OTLP example;
it is not a replacement for an installation's complete agent configuration.
Retain the source collector configuration and source monitoring until the
required coverage and query checks pass.

Mint a new **ingest** credential in Porthole Settings, scoped to the actual
services, environments, teams and these three signals, with only
`telemetry.write`. Preserve the resource attributes `service.name`,
`deployment.environment.name` and `team.name`. The source extraction credential
is not this identity and is never copied into the new authorization input.

Have the service manager load these inputs from a private file outside the
checkout with mode 0600. This is a template, not a command containing a secret:

```sh
PORTHOLE_COLLECTOR_LISTEN=127.0.0.1:4318
PORTHOLE_COLLECTOR_HEALTH_LISTEN=127.0.0.1:13133
PORTHOLE_COLLECTOR_DESTINATION=https://your-installation.example
PORTHOLE_COLLECTOR_AUTHORIZATION='Bearer <new scoped Porthole ingest credential>'
```

The destination is an origin with no credentials, query or signal suffix.
The authorization value stays in the private service environment, never a
command argument or URL. Start the verified executable with
`--config=collectors/splunk/collector.yaml`. Keep the SDK's existing local OTLP
receiver address. For an already equivalent OTLP pipeline, the reviewed cutover
changes only `PORTHOLE_COLLECTOR_DESTINATION` and
`PORTHOLE_COLLECTOR_AUTHORIZATION`, then restarts that collector instance.
Roll back by restoring the prior private destination and its own source
credential. Do not send the new Porthole identity to the source destination.

This small configuration disables the asynchronous sending queue and uses a
bounded exporter retry. Receiver failures therefore expose downstream refusal
to the sender. It does not establish durable collector buffering across a
collector crash. The restart check below concerns Porthole's durably accepted
envelopes and replay of identical stock telemetry.

## Executable qualification

The explicit helper is
`splunkCollectorJourney({origin, cookie, restartWorker, freshOwner, collectorBinary})`
in [migration-collector.mjs](../tests/porthole/migration-collector.mjs).
It requires a real local Porthole installation and native owner fixture. The
binary defaults to `PORTHOLE_SPLUNK_COLLECTOR_BIN`. It does not skip a missing
binary or start a substitute application. Call it from the named migration
qualification harness outside the ordinary push verification wall.

The journey asserts the following through real public HTTP doors:

1. The existing stock Node SDK producer makes a real local request and emits
   its correlated span, log and cumulative request counter through the official
   collector into a local provider-edge capture. That edge returns one 503 per
   original envelope; the official exporter must retry identical bytes itself.
2. A freshly minted scoped Porthole credential replaces the source-edge
   identity. The unchanged collector configuration receives only new private
   destination and authorization inputs. Original stock envelopes enter the
   collector's supported OTLP receiver again, preserving an exactly matched
   source cohort through Porthole's three real intake endpoints.
3. With native indexing paused, durable acceptance counts match every captured
   span, log and metric point. Both the collector and Worker restart. Replaying
   those envelopes through the stock collector adds no accepted records.
4. Native records and their archive copies match the captured source cohort's
   full resource and record attributes, exact nanosecond timestamps, metric
   values, metadata, record counts and trace and span correlation. Each metric
   point contains the exact cumulative count of one request; SDK flushes can
   emit more than one point for that same counter.
5. A second real local request from the unchanged SDK reaches the repointed
   collector and Porthole. Per-signal counts, the exact counter value and fresh
   trace and log correlation reconcile. The old source edge receives nothing.
6. Revoking the new identity makes all three stock export paths fail, including
   replay of already accepted bytes, while retained records stay unchanged.

The source capture is solely a provider network fixture; it does not implement
a collector, native intake, indexing or authentication. The collector runs at
low priority with two Go execution threads and a 120-second hard lifetime per
instance. The helper stops only its own processes and closes its local capture.
Execution evidence must name the committed candidate and successful run; the
presence of this helper alone is not a passed acceptance result.
