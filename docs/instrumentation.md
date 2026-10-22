# Runtime instrumentation and retained traces

Porthole receives stock OpenTelemetry OTLP HTTP/protobuf and HTTP/JSON at
`/v1/traces`. Use the installation's HTTPS origin in production. Mint an ingest
credential in Settings with only the application's named services, environments,
teams, `traces` signal and `telemetry.write` action. Keep the credential in the
process supervisor's private environment or secret store; never put it in code,
URLs, command arguments, images or shared logs. A collector forwarding several
services needs that explicit union of service grants and has no read authority.

Set `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` (including
`service.version`, `deployment.environment.name` and `team.name`),
`OTEL_EXPORTER_OTLP_ENDPOINT` to the origin and
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the origin plus `/v1/traces`, and
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`. Configure exporter authentication
through its private `OTEL_EXPORTER_OTLP_HEADERS` setting. Do not copy the value
into a support packet. Preserve the original source code/release identifier in
resource attributes; Porthole does not infer one from arrival time.

Use W3C `tracecontext`. The conservative default in the supplied paths is
`OTEL_PROPAGATORS=tracecontext`: they do not forward baggage or automatically
copy baggage/request headers into span attributes. This is the adopted default
pending ct's PORT-004 baggage-policy ruling. It does not remove the contract's
baggage obligation. Do not enable baggage forwarding or content capture without
the owner's approved policy. Telemetry already emitted by an application remains
subject to its existing ingestion/data scope; this guide adds no wider reader.

## Seven install paths

The executable examples under `instrumentation/polyglot` are ordinary services,
not a Porthole-specific telemetry generator. They call each other over real
HTTP. The stock libraries create the spans and inject/extract context.

- **Node 22, HTTP and gRPC:** install the exact `@opentelemetry/sdk-node`,
  `@opentelemetry/exporter-trace-otlp-proto`,
  `@opentelemetry/instrumentation-http` and
  `@opentelemetry/instrumentation-grpc` versions in the root package manifest
  (0.300.0), plus `@opentelemetry/api` 1.10.0. Load
  `instrumentation/node/register.cjs` before importing `node:http`, `node:https`
  or `@grpc/grpc-js`, for example with Node's `--require` flag. Applications with
  an ESM dependency graph must use OpenTelemetry's supported ESM instrumentation
  loader before those libraries load. The example and qualification use CJS.
- **Python 3.12, Flask and Requests:** create a virtual environment, install
  `instrumentation/polyglot/python/requirements.txt`, then launch with
  `opentelemetry-instrument python app.py`. Flask server and Requests client
  instrumentation is configured before the application imports either library.
  No custom span payloads are needed.
- **Java 21, HttpServer and HttpClient:** fetch OpenTelemetry Java agent 2.32.0
  from Maven Central, verify SHA-256
  `f787eb6c7f3d18e69a431e108a15278d25ee37f83d68b678f621e063f3988f82`,
  and add `-javaagent:/absolute/path/opentelemetry-javaagent.jar` to the real
  Java process. The example's `jdk.httpserver` module and normal JDK HTTP client
  are instrumented by the agent. No exporter implementation is copied into the
  application.
- **Go 1.25, net/http:** use the pinned modules and initialization in
  `instrumentation/polyglot/go`. Go requires a rebuild: wrap the server handler
  with stock `otelhttp.NewHandler`, the outbound transport with
  `otelhttp.NewTransport`, and use the inbound request's context for outbound
  calls. Start the stock OTLP exporter/tracer provider and shut it down on a
  graceful application exit. Omitting the context is a visible broken boundary,
  not a reason to merge traces by time.
- **.NET 8, ASP.NET Core and HttpClient:** add the 1.20.1 package references in
  `instrumentation/polyglot/dotnet/Polyglot.csproj`, register
  `AddOpenTelemetry()`, explicitly set the service resource with `AddService`, and use `WithTracing(...)` with `AddAspNetCoreInstrumentation`,
  `AddHttpClientInstrumentation` and `AddOtlpExporter`, then rebuild. Use the general OTLP endpoint setting as well: this exporter registration reads `OTEL_EXPORTER_OTLP_ENDPOINT`, then adds the HTTP trace path. Hosting
  starts/stops the provider. The example uses the actual framework middleware
  and HttpClient diagnostic listeners, with no hand-built spans.
- **Ruby 3.3, Rack and Net::HTTP:** install the pinned Gemfile, require the SDK,
  exporter and instrumentation before the application, configure both stock
  integrations, and mount the Rack tracer middleware as in `ruby/app.rb`.
  Install a C compiler, make and libc headers when Bundler builds numeric
  dependencies; these are build prerequisites, not a silent unsupported path.
- **PHP 8.3, Slim:** install the stock `opentelemetry` extension 1.4.2 and the
  pinned Composer dependencies in `php/composer.json`. Enable
  `OTEL_PHP_AUTOLOAD_ENABLED=true` and load Composer's autoloader before creating
  Slim. The extension hooks the framework; the SDK/exporter auto-configuration
  consumes the same OTLP resource/export settings. PHP requires the extension's
  normal native build tooling and Composer's archive tools.

For KafkaJS 2.2.4 install `@opentelemetry/instrumentation-kafkajs` 0.33.0 and
load the supplied Node register module before importing KafkaJS. Keep the
instrumentation's context headers on actual producer messages and consumer
processing. Do not create unrelated timestamp-based parent links. The
qualification uses Apache Kafka 3.9.1 with a real topic and consumer group, plus
HTTP/gRPC and asynchronous fanout. This does not claim compatibility with every
Kafka client or deployment; missing framework/context boundaries remain gaps.

## Read and diagnose

Open `/app/traces`, paste an original 32-hex trace ID, and open its retained
waterfall. `/api/porthole/v1/traces/<trace-id>` exposes the same graph to native
sessions or scoped read credentials. Both enforce current service, environment
and team grants and immediate credential revocation. Finance readers cannot
read telemetry. Trace reads are privately audited without copying query contents.

Original start/end nanoseconds, durations, status/errors, resource/version,
instrumentation scope, attributes, events and causal links remain inspectable.
Bars show offsets and durations against the observed trace window. Async work
may overlap or outlive its producer; it is never shortened to fit a parent.
Identical re-deliveries are counted as copies. Different content under the same
span ID remains separate conflicting variants, and cannot be selected as an
unambiguous parent. Missing/out-of-scope parents have the same diagnostic so a
restricted reader cannot infer hidden services. Cycles are never attached.
A connected retained graph is not a claim of complete upstream instrumentation
or sampling coverage. Empty, incomplete and unavailable states remain explicit.

One transaction reads at most 2,000 authorized retained records. More records
produce `truncated: true` and an Incomplete graph. The generic records/query
API accepts the same trace filter and bounded limit. A completion-sequence
`snapshot` freezes the read and survives restart; the trace's JSON link repeats
it. Later deliveries never alter an earlier snapshot. Current scope still
applies to every replay. The graph derives from the existing archived telemetry;
it adds no separate durable domain or restore authority.

## Qualification

Push Verify's parallel `traces` shard runs `traceJourney` in
`tests/porthole/traces.mjs` through the emitted Worker and native auth. It drives
stock Node HTTP/gRPC, real overlapping operations and a real TCP forwarder with
a deliberately incorrect parent, plus schema-edge conflicting/cyclic identities.
It checks original timing/restart/snapshot, role/scope/revocation and all changed
screen states at 1440 and 390. It does not stand in for the seven-runtime drill.

For that drill, on a dedicated Docker-capable machine, build the six examples
with `bash instrumentation/polyglot/build.sh` (set `PORTHOLE_CA_FILE` when the
host's trust bundle is elsewhere), build the product, commit the candidate,
and run:

```sh
PORTHOLE_TRACE_ONLY=1 PORTHOLE_POLYGLOT=1 \
PORTHOLE_CANDIDATE_SHA="$(git rev-parse HEAD)" node tests/runtime.mjs
```

The journey starts only its own named containers, a disposable Kafka and a local
OTLP forwarding gateway. It creates a native scoped ingest credential, executes
one Node/Python/Java/Go/.NET/Ruby/PHP trace and asserts the whole returned graph.
Warm-up calls have different trace identities. The gateway forwards stock bytes
to the real intake and supplies no telemetry or product/storage responses. It
holds the test's credential so the containers do not need a persistent secret.
The journey removes its own containers and closes its own listener, including on
failure. Screenshots, when requested with `PORTHOLE_EVIDENCE_DIR`, belong outside
the product repository. A recorded pass on the exact candidate is required;
successfully building an image alone proves no application clause.
