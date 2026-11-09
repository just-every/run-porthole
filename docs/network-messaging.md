# Native network and messaging evidence

Open Services, select an observed runtime and keep an absolute window. Network
and messaging details use that window and the same completed intake sequence as
the catalog. The versioned read is `GET /api/porthole/v1/network-messaging`.
It accepts the Services `from`, `through`, `snapshot` and `budget` parameters.
Bounds are inclusive Unix nanoseconds. A remaining trace or metric page makes
the result partial. Each signal has its own bounded scan budget, up to 2,000
retained records. No collector, request or probe starts when this door is read.

DNS lookup and TCP connection observations come from unmodified stock Node
instrumentation. Failures and timeouts retain their source evidence. Timings
use original nanoseconds and nearest-rank p95; no observation means unavailable
latency. These are retained spans, not full application traffic or a network
health claim. Source trace and span pivots apply current authorization again.

The stock Prometheus receiver scrapes an official node exporter netstat
collector in the affected container network namespace. Retransmission and TCP
timeout samples keep their original timestamps. The stock docker_stats receiver
supplies interface drop and error counters. Counter deltas require at least two
unambiguous samples with a consistent source and start time, without a reset.
A namespace counter does not identify a particular edge's packet-loss rate.

The stock kafkametrics receiver supplies partition end offsets, committed
consumer offsets and consumer-group lag. The stock rabbitmq receiver supplies
queue depth and cumulative published, delivered and acknowledged messages.
Samples retain topic, partition, group, queue, virtual host, unit and original
record references. Application throughput counts retained producer and consumer
spans over the selected absolute window; it is distinct from broker counters.
Consumer processing duration comes from actual stock consume spans. Producer
and consumer trace links require retained, currently visible span identities.
Select a window containing both sides of a delayed delivery to inspect its link.

## Explicit resource correlation

A network metric joins a service only when both have the same declared
`container.id`, `host.id`, service, environment and team. A messaging metric
also needs the application's declared `porthole.messaging.broker.container.id`
matching the broker metric's container identity, plus the topic or queue.
Application names, destination names, IP proximity and timestamps alone do not
establish identity. The configuration generators accept explicitly reviewed
identities; they do not discover or grant authority. A caller needs current
native-session access to every input before correlation. Unknown identities
remain unknown. A service with no retained spans gains no detached metric row.

Stock AMQP instrumentation can identify a default-exchange queue through its
routing key. Broker samples preserve the virtual host as an additional dimension.
These observations do not establish cross-account, cloud-queue or arbitrary
routing-topology qualification.

## Missing evidence and privileges

Counter age is measured against the selected window's end. A sample more than
15 seconds behind that end is stale. Missing metrics and unsuccessful collection
are not converted to zero. Each gap names the collection source, required
namespace access, Docker socket access, BPF and PERFMON capabilities, Kafka
consumer-group read grant or RabbitMQ monitoring permissions, and a next action.
Absence alone cannot establish which permission was denied; inspect the actual
stock collector diagnostic. Old samples keep their timestamps and stale label.
Restored collection supplies new samples without rewriting earlier evidence.

The generated configurations under `./collectors/network/` and
`./collectors/messaging/` configure unmodified official components. Credentials
belong in the collector's private runtime environment or headers, never in an
archive or generated committed configuration. The official Contrib release is
0.135.0, the same version already pinned for sampling. Distribution digests,
CoreDNS, node exporter, OBI and disposable broker pins are in the release modules.
The disposable fixture's sidecar uses stock `tc` inside the owned namespace.
It never scans ports or initiates collection-time DNS requests.

## Custody and limitations

No network or messaging aggregate table exists. Reads reconstruct evidence from
ordinary retained telemetry. Current scope applies to each input page; final
session and source-existence fences run before release. Erased inputs cannot
leave a separate network aggregate behind. Restart uses the same original
records. Inactive installation restore transfers telemetry, not source sessions
or collection credentials; it starts no collector or workload.

The native journey creates and owns a disposable user-defined bridge, counted
checkout producers and consumers, Kafka, RabbitMQ and CoreDNS. It records
independent resolver-delay, pair-restricted packet-loss and paused-consumer
backlog windows and compares source namespace and broker state with retained
stock telemetry. OBI executes only from the official pinned digest. A kernel
or capability failure is a coverage gap, never fabricated eBPF evidence.

This fixture is not the authorized real application network required by
PORT-060. Real private estates, ECS, Nomad, supported cloud queues, infrastructure
inventory, external device operations and the full real-network privilege and
route-access journey remain unqualified. It authorizes no external probing,
security scanning, alert, outbound delivery, retention or deletion policy.

Validated opaque Docker digests and opaque host IDs are preserved as structural
resource identities, alongside trace and span IDs. This exception is limited to
those resource keys and their declared hexadecimal formats. Ordinary resource
payload values retain mandatory masks. An explicit custom masking rule prevents
this restoration, leaving correlation unknown when the identity is masked.

Collector configuration also requires the reviewed topic and consumer group, or
RabbitMQ virtual host and queue. Stock receiver and filter settings remove other
namespaces before assigning the application's telemetry scope. The application
must declare `porthole.messaging.rabbitmq.vhost` for RabbitMQ correlation; an
absent or masked virtual host remains unknown. Queue names alone are insufficient,
even on the same broker. The fixture independently sends seven messages to a
same-name queue in another virtual host and asserts those metrics never enter
the application's intake.

Dependency details resolve DNS and connection spans through their HTTP client
ancestor and the actual propagated server span. Both runtime resource identities
must be present. Missing, hidden or ambiguous peers remain unknown. Counter
samples retain first and last sample times; their sample delta does not include
unobserved boundaries of the selected window. The fault journey compares this
delta with independently read namespace counters, within two increments, and
records the actual traffic-control statistics before removing each fault.

Retained stock OBI network flow metrics are distinct from eBPF application spans.
Only flows whose declared source container, host and current scope match a
visible runtime are shown. Raw peer-name labels do not establish a permitted
peer and are withheld from this projection; the peer remains unknown without
declared identity evidence. Original metric reads apply current authority again.
An application span alone cannot establish network-flow coverage.

Each service association keeps its own producer and consumer observations. Its
visible queue summary and propagated links combine only currently authorized
spans with the same declared broker identity, namespace and destination. Missing
producer or consumer observations yield unknown throughput on that side. Current
scope is applied before this join, and every contributing input is fenced again
before release.
