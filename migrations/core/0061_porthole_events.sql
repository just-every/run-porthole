CREATE TABLE porthole_custom_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, source_id TEXT NOT NULL,
 service TEXT NOT NULL, environment TEXT NOT NULL, team TEXT NOT NULL,
 occurred_ns TEXT NOT NULL, received_at INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 actor_ref TEXT NOT NULL, actor_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 UNIQUE(source,source_id)
);
CREATE INDEX porthole_events_timeline ON porthole_custom_events(occurred_ns,id);
CREATE TRIGGER porthole_events_immutable BEFORE UPDATE ON porthole_custom_events BEGIN
 SELECT RAISE(ABORT,'event_provenance_immutable');
END;
CREATE TABLE porthole_event_filters (
 id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')), created_at INTEGER NOT NULL
);
CREATE TRIGGER porthole_events_created AFTER INSERT ON porthole_custom_events BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'events.create',NEW.id,1,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
