-- Independent control-plane observations, never synthetic backend liveness.
CREATE TABLE porthole_health_receipts (
 component TEXT NOT NULL CHECK(component IN ('control-plane','collector','ingest','queue','storage','query','monitor-evaluation','delivery')),
 source TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Healthy','Unknown')),
 reason TEXT NOT NULL, observed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 last_accepted_at INTEGER, last_queryable_at INTEGER,
 evidence TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence)),
 PRIMARY KEY(component,source)
);
CREATE TABLE porthole_health_collectors (
 credential_id TEXT NOT NULL REFERENCES porthole_credentials(id), collector_id TEXT NOT NULL,
 team TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, signal TEXT NOT NULL,
 observed_at INTEGER NOT NULL, PRIMARY KEY(credential_id,collector_id,team,service,environment,signal)
);
CREATE TABLE porthole_health_configuration (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL DEFAULT 1,
 freshness_ms INTEGER NOT NULL DEFAULT 300000 CHECK(freshness_ms BETWEEN 10000 AND 3600000),
 notices_enabled INTEGER NOT NULL DEFAULT 0 CHECK(notices_enabled IN (0,1)),
 recipient TEXT, configured_by TEXT, changed_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO porthole_health_configuration(singleton) VALUES(1);
CREATE TABLE porthole_health_incidents (
 component TEXT PRIMARY KEY, episode TEXT NOT NULL UNIQUE,
 opened_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE porthole_health_notices (
 id TEXT PRIMARY KEY, episode TEXT NOT NULL, component TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('failure','recovery')),
 configuration_revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
 first_attempt_at INTEGER, next_attempt_at INTEGER NOT NULL, lease_id TEXT, lease_until INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','uncertain','rejected','cancelled')),
 -- Freeze the exact provider request across crash/retry. No secrets here.
 message TEXT NOT NULL CHECK(json_valid(message)), provider_id TEXT,
 UNIQUE(episode,phase)
);
CREATE INDEX porthole_health_notice_work ON porthole_health_notices(state,next_attempt_at);
-- Evaluation is real retained-record counting, never a simulated repair.
CREATE TABLE porthole_monitor_state (
 object_id TEXT PRIMARY KEY REFERENCES porthole_objects(id), revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Healthy','Firing','Unknown')),
 evaluated_at INTEGER NOT NULL, last_known_count INTEGER, last_known_at INTEGER,
 firing_episode TEXT, reason TEXT NOT NULL
);
CREATE TABLE porthole_monitor_evaluations (
 id TEXT PRIMARY KEY, object_id TEXT NOT NULL REFERENCES porthole_objects(id), revision INTEGER NOT NULL,
 evaluated_at INTEGER NOT NULL, window_start_ns TEXT NOT NULL, window_end_ns TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Healthy','Firing','Unknown')), observed_count INTEGER,
 firing_episode TEXT, reason TEXT NOT NULL
);
