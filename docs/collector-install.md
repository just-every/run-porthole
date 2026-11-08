# Docker collection and Kubernetes zero-code instrumentation

The Docker installer runs the official OpenTelemetry Collector Contrib 0.135.0
image by manifest digest. The Helm chart pairs that Collector with official
OpenTelemetry eBPF Instrumentation (OBI) 1.0.0, also pinned by digest. Neither
artifact changes application images, code or manifests. These are opt-in
installations on infrastructure you control; review every privilege first.

This release does not qualify fresh macOS or Windows hosts, the Kubernetes
operator, upgrades or rollback. Docker host and container metrics are exported;
an Infrastructure CPU and memory screen is not included. OBI requires Linux,
readable kernel BTF and a supported application runtime. A recent fleet report
or granted capability does not establish telemetry completeness or health.

## Docker: one command

Use Node 22 or later and Docker with the json-file logging driver. Mint a scoped
ingest credential in native Settings for the intended service, environment and
team, with the logs, metrics and traces signals and telemetry.write action.
Create a private file outside the checkout, mode 0600, using your editor:

```text
PORTHOLE_ENDPOINT=https://your-porthole.example
PORTHOLE_INSTALL_ID=collector-one
PORTHOLE_SERVICE=checkout
PORTHOLE_ENVIRONMENT=production
PORTHOLE_TEAM=commerce
PORTHOLE_INGEST_TOKEN=<paste the scoped credential in this private file>
```

Run from this checkout:

```sh
node packaging/collector/install.mjs install --env-file /absolute/private/collector.env
```

Keep the installer process running for observations every 15 seconds. Its
credential is read from the private file, never from a URL or command argument.
Do not pass a token with a command-line environment assignment. Docker receives
the private file through its env-file option; an administrator of that Docker
daemon can inspect container environment variables. To avoid storing the token
in container configuration, omit PORTHOLE_INGEST_TOKEN and instead set
PORTHOLE_SECRET_FILE to an absolute private token file. The installer mounts it
read-only at the container's secret path and configures the Collector's
bearer-token extension to read that file. The reporter reads the same file. The file-mounted variant requests only
DAC_READ_SEARCH in addition to the root user so a mode-0600 file owned by
the installer remains readable inside the Collector. Review that read privilege;
the env-file variant drops all capabilities.
No credential is written to fleet records, portable archives or installer logs.
For an installation using a private certificate authority, set PORTHOLE_CA_FILE
to its PEM certificate file in the private env file. Both the Collector and
reporter validate TLS using that authority; certificate verification stays on.

The Collector reads host proc and sys files, Docker json-file container logs and
the Docker socket. Socket access grants substantial host control even with a
read-only mount; review it explicitly. The image runs as root to read those
files, with no new privileges and no privileged mode. The env-file variant
drops every capability; the file-mounted secret variant adds only the reviewed
read capability described above. Fleet observations list the root user explicitly among the requested and
observed privileges. Original Docker log
timestamps and container IDs accompany the native log records. Existing logs
are read from the beginning: review scope and volume before installation.
The installer excludes its own container log to prevent diagnostic feedback
when an exporter is refused. File offsets persist in the named Docker volume
`porthole-state-<install-id>` across Collector restarts; uninstall preserves that
offset state. Treat the local file-offset and source-fingerprint volume as
telemetry custody; it is not included in Porthole's portable product archive.
The export queue remains bounded and in memory. The exporter
retries for 60 seconds with a bounded in-memory queue; this is not
a durable, lossless buffer. Delivery and loss accounting remain visible in
Pipeline health, and queue exhaustion must not be interpreted as healthy.

Open **Fleet coverage** under Settings, or GET `/api/porthole/v1/fleet` with your
native owner session. It lists version, node, kernel, runtime limits, requested
and observed grants, actual Docker engine version, configured resource limits,
Collector process state, missing privileges and next actions. A failed or
unobservable Collector has an explicit collection gap; it cannot become empty
healthy data. Removing host proc,
host sys, container-log access or the socket produces a named gap. An absent
reporter becomes stale after 90 seconds. Reports are authenticated collector
observations rather than independent proof of successful telemetry collection.
Native Explore and Services provide the retained evidence.

## Kubernetes: one Helm install

Review the chart's complete rendered privileges first. Create the namespace and
an existing Secret from a private file; the Secret is deliberately not rendered
or created by this chart:

```sh
kubectl create namespace porthole
kubectl -n porthole create secret generic porthole-ingest --from-file=token=/absolute/private/ingest-token
helm install porthole ./charts/porthole -n porthole \
  --set endpoint=https://your-porthole.example \
  --set team=commerce --set environment=production \
  --set-string 'obi.executable=*/checkout'
```

Select the actual executable path already present in your uninstrumented
application. Use a credential whose current service scope permits all selected
applications plus porthole-collector, without widening team or environment
scope. Executable discovery and runtime support determine what OBI can see;
the selector is installation configuration, not an application manifest edit.

The DaemonSet runs the Collector, OBI and a small pinned Node observer on Linux
nodes. Kubernetes attribute discovery uses get, list and watch permissions for
pods, namespaces, nodes, services and ReplicaSets. The Collector reads the
existing Secret as a mounted token file. OBI exports to the node-local Collector
without receiving an external ingest credential. RBAC is read-only; no app
mutation, exec, secret listing or Kubernetes operator is installed.

OBI requests host PID discovery, BPF, PERFMON, SYS_PTRACE, DAC_READ_SEARCH,
NET_RAW and CHECKPOINT_RESTORE. The chart drops other capabilities and requests
no privileged mode. It mounts tracefs and cgroup for supported tracing and
metadata. Kernel BTF and a kernel at least 5.8 are required by this bounded
configuration; older kernels and Go context injection requiring SYS_ADMIN are
not qualified. Review the official OBI support matrix for each runtime. Some
protocol and context propagation paths have additional limitations. The fleet
observer reads the actual OBI process capability bitmap and checks mounted
paths and Kubernetes discovery access. It never treats the requested pod
security context alone as proof of a granted capability.

The chart uses OBI's documented v1 configuration environment interface, retained
by its 1.0 release. Missing BTF, capabilities, host paths, Kubernetes discovery
rules or absent OBI processes produce explicit gaps. Service eBPF coverage is
resolved from currently authorized retained spans carrying the install identity
and an OBI instrumentation scope. A bounded incomplete scan remains partial;
no spans means unproven coverage, never zero requests or health. Open native
Services to inspect observed service-map edges, server request and error
counts and latency percentiles; retained observations do not establish
full-traffic RED or source parity.

## Stop and uninstall without deleting telemetry

From another shell, use the same private file:

```sh
node packaging/collector/install.mjs uninstall --env-file /absolute/private/collector.env
```

The foreground installer observes the stopped Collector and records a stale
install before exiting. Ctrl-C also stops its own Collector. A revoked credential
can prevent the final report; its existing observation becomes stale and the
fleet read shows the revoked or unavailable credential. After stopping, remove
the named stopped container with `docker rm porthole-collector-one` if desired.
Keep the private credential file until the reporter exits, then remove it using
your normal secret handling process. Revoke the credential in Settings when it
is no longer needed. A revoked Collector cannot submit new loss reports with
that revoked authority. Inspect its actual exporter dropped-item counters; a
current native owner can record the observed count and source time range with
POST `/api/porthole/v1/ingest/loss`, using sourceId, signal, service, environment,
team, kind source_loss, count, from and through. The native delivery view then
shows accounted source loss and Unknown coverage. A responder or revoked ingest
credential cannot make this accounting assertion. This is an explicit owner
report of observed dropped export attempts, not an automatic completeness claim.

For Kubernetes:

```sh
helm uninstall porthole -n porthole
```

The observer attempts a final stopped report on termination; otherwise the last
report ages stale. Helm removes only this release's workloads, configuration
and RBAC. The pre-existing Secret is not owned or deleted by the chart; remove
or rotate it separately after the workloads stop. Neither uninstall command
calls a telemetry deletion API. Retained logs, spans and metrics remain
queryable. Portable installation archives preserve install observations as
inactive, stale context without credential bindings or restarted collection.

## Qualification

`tests/porthole/collector-install.mjs` drives the real digest-pinned Collector
beside a real Docker producer, compares the original json-file timestamp and
container identity with native Explore, removes each mount independently,
restarts and stops collection, revokes the credential and restores an actual
native archive. Run after building:

```sh
PORTHOLE_COLLECTOR_INSTALL_ONLY=1 node tests/runtime.mjs
```

This installation journey requires Docker and runs outside push Verify because
image pulls and installation are slow. The native fleet authority and lifecycle
journey remains in push Verify. Kind qualification is pinned to kind 0.30.0 and
Kubernetes node 1.34.0 with digest
`sha256:7416a61b42b1662ca6ca89f02028ac133a309a2a30ba309614e8ec94d976dc5a`.
A runner without BTF or functioning kubelet cgroups cannot prove zero-code
instrumentation. Do not replace that proof with fabricated spans or equate a
rendered chart with a successful installation.

Official operational references:

- https://opentelemetry.io/docs/zero-code/obi/setup/kubernetes/
- https://opentelemetry.io/docs/zero-code/obi/setup/docker/
- https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/SUPPORT_MATRIX.md
