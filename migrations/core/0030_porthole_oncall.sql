-- Owner-approved monitor handoffs. No source key is persisted here.
CREATE TABLE porthole_oncall_routes (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES porthole_objects(id), monitor_revision INTEGER NOT NULL,
 source TEXT NOT NULL, destination_service TEXT NOT NULL, environment TEXT NOT NULL,
 configured_by TEXT NOT NULL, member_revision INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX porthole_oncall_active_route ON porthole_oncall_routes(monitor_id) WHERE enabled=1;
CREATE TABLE porthole_oncall_events (
 id TEXT PRIMARY KEY, route_id TEXT NOT NULL REFERENCES porthole_oncall_routes(id), generation TEXT NOT NULL,
 intent TEXT NOT NULL CHECK(intent IN ('trigger','recover')), created_at INTEGER NOT NULL,
 message TEXT NOT NULL CHECK(json_valid(message)), state TEXT NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','sending','accepted','uncertain','rejected','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_id TEXT, lease_until INTEGER,
 provider_id TEXT, reason TEXT NOT NULL DEFAULT 'Awaiting scoped Oncall intake',
 UNIQUE(route_id,generation,intent)
);
CREATE INDEX porthole_oncall_due ON porthole_oncall_events(state,next_attempt_at);

CREATE TRIGGER porthole_oncall_routes_insert_fact AFTER INSERT ON porthole_oncall_routes
WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER porthole_oncall_routes_update_fact AFTER UPDATE ON porthole_oncall_routes
WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER porthole_oncall_events_insert_fact AFTER INSERT ON porthole_oncall_events
WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.route_id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER porthole_oncall_events_update_fact AFTER UPDATE ON porthole_oncall_events
WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.route_id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
