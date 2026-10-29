-- Host identity is explicit and bound to one authenticated collector scope.
CREATE TABLE porthole_host_sources (
 credential_id TEXT NOT NULL REFERENCES porthole_credentials(id), collector_id TEXT NOT NULL,
 team TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, signal TEXT NOT NULL,
 host_id TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
 PRIMARY KEY(credential_id,collector_id,team,service,environment,signal)
);
CREATE TABLE porthole_host_heartbeats (
 id TEXT PRIMARY KEY, credential_id TEXT NOT NULL, collector_id TEXT NOT NULL,
 team TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, signal TEXT NOT NULL,
 host_id TEXT NOT NULL, observed_at INTEGER NOT NULL
);
CREATE INDEX porthole_host_heartbeat_window ON porthole_host_heartbeats(host_id,signal,observed_at);
CREATE TABLE porthole_host_monitor_versions (
 object_id TEXT NOT NULL REFERENCES porthole_objects(id), revision INTEGER NOT NULL,
 name TEXT NOT NULL, scope TEXT NOT NULL CHECK(json_valid(scope)), body TEXT NOT NULL CHECK(json_valid(body)),
 created_at INTEGER NOT NULL, PRIMARY KEY(object_id,revision)
);
CREATE TABLE porthole_host_monitor_state (
 object_id TEXT NOT NULL REFERENCES porthole_objects(id), revision INTEGER NOT NULL, host_id TEXT NOT NULL,
 evaluated_at INTEGER NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 PRIMARY KEY(object_id,host_id)
);
CREATE TABLE porthole_host_monitor_evaluations (
 id TEXT PRIMARY KEY, object_id TEXT NOT NULL REFERENCES porthole_objects(id), revision INTEGER NOT NULL,
 host_id TEXT NOT NULL, evaluated_at INTEGER NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence))
);
CREATE INDEX porthole_host_monitor_history ON porthole_host_monitor_evaluations(object_id,evaluated_at);
