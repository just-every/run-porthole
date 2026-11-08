-- Local collection authority is deliberately excluded from portable telemetry.
CREATE TABLE porthole_database_sources (
 id TEXT PRIMARY KEY,
 credential_id TEXT NOT NULL,
 service TEXT NOT NULL,
 environment TEXT NOT NULL,
 team TEXT NOT NULL,
 engine TEXT NOT NULL CHECK(engine IN ('postgresql','mysql')),
 plan_digest TEXT NOT NULL,
 revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 reviewed_at INTEGER NOT NULL,
 owner_id TEXT NOT NULL
);

CREATE TRIGGER porthole_database_source_insert AFTER INSERT ON porthole_database_sources WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'database.review',NEW.owner_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_database_source_update AFTER UPDATE ON porthole_database_sources WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'database.review',NEW.owner_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
