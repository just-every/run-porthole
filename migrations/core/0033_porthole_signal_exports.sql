-- Export approvals are installation-local authority and are never restored.
CREATE TABLE porthole_signal_exports (
 id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, owner_revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL, approved_at INTEGER, state TEXT NOT NULL CHECK(state IN ('preview','approved','cancelled')),
 selection TEXT NOT NULL CHECK(json_valid(selection)), snapshot INTEGER NOT NULL,
 estimate TEXT NOT NULL CHECK(json_valid(estimate)), credential_ref TEXT
);
CREATE TRIGGER porthole_signal_export_fact_insert AFTER INSERT ON porthole_signal_exports WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'signals.export-preview',NEW.id,0,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_signal_export_fact_update AFTER UPDATE ON porthole_signal_exports WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'signals.export-'||NEW.state,NEW.id,1,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
