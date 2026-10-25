CREATE TABLE porthole_retention_policies (
 id TEXT PRIMARY KEY, selection TEXT NOT NULL CHECK(json_valid(selection)), days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 730),
 revision INTEGER NOT NULL, changed_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE TRIGGER porthole_retention_fact AFTER INSERT ON porthole_retention_policies WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'retention.policy',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_retention_update_fact AFTER UPDATE ON porthole_retention_policies WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'retention.policy',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
