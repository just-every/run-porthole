# Local technology integration packs

Open Settings, Integrations, Technology integration catalog. A current native
owner or admin with proof within five minutes reviews one pack, service,
environment and team, using an existing scoped ingest credential. The catalog
creates a private preset through the existing dashboard writer and returns
configuration for the unmodified Contrib 0.135.0 collector. It starts no remote
process and grants no monitored-service authority.

The versioned catalog is `GET /api/porthole/v1/integrations`. Enable with
`POST /api/porthole/v1/integrations/enable` and the fields `pack`, `service`,
`environment`, `team`, `credentialId`, `revision` (zero initially) and `confirm`
(`review-local-collection`). Get a binding and its setup evidence at
`GET /api/porthole/v1/integrations/{id}` and download its configuration from
`GET /api/porthole/v1/integrations/{id}/configuration`. All doors require a
current native session; enabling and configuration download require current
administrative authority and fresh proof. Bearer credentials cannot administer
packs. Unexpected fields, including passwords, are refused without persistence.

Each declaration in `./src/porthole/integrations/catalog/packs.json` pins its
service image, upstream receiver source, permissions and signals. Set
`PORTHOLE_<PACK>_ENDPOINT`, and where applicable `PORTHOLE_<PACK>_USERNAME`,
`PORTHOLE_<PACK>_PASSWORD` and `PORTHOLE_POSTGRESQL_DATABASE` on the collector
host. Set `PORTHOLE_INGEST_TOKEN` to the existing credential value and
`PORTHOLE_SELF_PORT` to an unused loopback port and `PORTHOLE_DIAGNOSTIC_LOG`
to a private collector-owned writable log file. Set `PORTHOLE_STATE_DIR` to a
private persistent checkpoint directory unique to this setup; this prevents filelog replay when
the collector restarts. The stock filelog receiver
reads scraper errors from that file; the stock transform processor replaces
the raw body and attributes with fixed diagnostic codes before export. Raw
errors and stack traces never enter Porthole. Diagnostic log output requires
a metrics and logs grant even for a metrics-only service receiver. Nginx additionally requires
`PORTHOLE_NGINX_ACCESS_LOG` and `PORTHOLE_NGINX_ERROR_LOG`, readable by the
collector identity. Generated JSON is accepted as YAML by the stock collector.
Run `otelcol-contrib --config <private-config-file>`. For production use secure
service endpoints and configure the stock receiver TLS options for the host.
Local database TLS is disabled explicitly only for these disposable fixtures.
No monitored-service connection value is accepted by a setup request.
Passwords and ingest tokens never belong in Porthole data, audit or archives.
Stock receiver resource labels can include non-secret service endpoint metadata. Restrict filesystem access to the collector host configuration.

The stock Prometheus receiver exports the collector's own scraper counters
alongside the declared preset metrics. The stock filter processor retains only
those declared metrics and setup telemetry; other receiver metrics are not
exported by this initial pack revision. Setup is Collecting only with fresh advancing
success counters and no newly reported errors. Missing evidence, stale input,
revoked ingest credentials and unavailable storage remain Unknown. Scraper
errors identify the pack and its required permission and endpoint checks. A
positive service value alone cannot establish setup health. This is collection
setup evidence and does not establish overall service health or complete data.

Product archives carry reviewed pack and scope history with credential references
removed. Native installation restore also clears these references. Restored setups and dashboards are inactive, and must be reviewed with
new current authority before configuration download. No monitored-service
secrets, collector configuration, monitor activation or provider authority is
archived. The wider catalog, real Windows hosts and value-threshold monitor
engine remain unqualified. No recommended monitor is enabled by these packs.

Recommended value-threshold monitors remain PORT-019 work. A reviewed owner and
service mapping is required before any future monitor enablement. This catalog
supplies no monitor configuration or activation door.
