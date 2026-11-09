-- Owner declarations and digest-bound selections contain no partner credentials or detached telemetry.
CREATE TABLE porthole_handoff_versions (
 product TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), destination TEXT NOT NULL,
 template TEXT NOT NULL, author_ref TEXT NOT NULL, created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')), PRIMARY KEY(product,revision)
);
CREATE TABLE porthole_service_packets (
 id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, owner_revision INTEGER NOT NULL,
 selection TEXT NOT NULL, snapshot INTEGER NOT NULL, captured_at INTEGER NOT NULL,
 digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('preview','approved','cancelled','quarantined')),
 approved_at INTEGER
);
CREATE TRIGGER porthole_handoff_fact AFTER INSERT ON porthole_handoff_versions WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'handoffs.revise',NULL,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_service_packet_fact AFTER INSERT ON porthole_service_packets WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'evidence.preview',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_service_packet_update_fact AFTER UPDATE ON porthole_service_packets WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'evidence.change',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
