CREATE TABLE porthole_integration_bindings (
 id TEXT PRIMARY KEY, pack TEXT NOT NULL, service TEXT NOT NULL,
 environment TEXT NOT NULL, team TEXT NOT NULL, credential_id TEXT,
 dashboard_id TEXT, state TEXT NOT NULL CHECK(state IN ('enabled','quarantined')),
 revision INTEGER NOT NULL, created_at INTEGER NOT NULL, owner_id TEXT NOT NULL,
 UNIQUE(pack,service,environment,team)
);
CREATE TRIGGER porthole_integration_created AFTER INSERT ON porthole_integration_bindings WHEN NEW.state='enabled' BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'integration.enable',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_integration_reviewed AFTER UPDATE ON porthole_integration_bindings
WHEN NEW.state='enabled' AND NEW.revision<>OLD.revision BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'integration.enable',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
