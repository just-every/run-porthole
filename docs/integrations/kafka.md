# Kafka collection pack

Pack revision 1. Service image: `apache/kafka:3.9.1`.
Collector: unmodified OpenTelemetry Collector Contrib 0.135.0.
Stock receiver: `kafkametrics`. Pinned source: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.135.0/receiver/kafkametricsreceiver.

Required monitored-service permissions: Describe topics and brokers, Describe groups and Read group offsets; no topic writes.
Service signals: metrics. Collector diagnostics additionally
require a logs ingest grant. All values remain scoped to the reviewed service,
environment and team. A heartbeat is not proof of successful collection.

1. Create the dedicated read-only monitoring role with the declared permissions.
2. Keep endpoint and monitored-service credentials on the collector host in the named environment variables.
3. Review one service, environment and team with fresh owner or admin proof, then download configuration.
4. Set PORTHOLE_INGEST_TOKEN to the existing scoped credential on the host; start the unmodified pinned collector.
5. Inspect collector scraper telemetry and the preset; absent data is Unknown.

The private preset uses native timeseries widgets for these original receiver
metrics, preserving their emitted units:

- `kafka.partition.current_offset` (1).
- `kafka.consumer_group.lag` (1).

Unavailable: value-threshold engine and reviewed owner and service mapping remain required. No monitor is activated.

Read the common [host setup and secret boundary](./README.md). Never submit a
monitored-service password or endpoint value to Porthole. The configuration
contains host environment references and uses an existing scoped ingest token.
Denied collection shows sanitized collector diagnostic codes and the required
permission or endpoint check. Missing input is Unknown. Restore keeps the pack
inactive and removes its credential reference; a current fresh review is due.
