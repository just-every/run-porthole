-- Stable identities survive installation archives. Exclusions only accumulate.
CREATE TABLE porthole_export_exclusions (
 record_id TEXT PRIMARY KEY, excluded_at INTEGER NOT NULL CHECK(excluded_at>=0)
);
CREATE TRIGGER porthole_export_exclusion_fact AFTER INSERT ON porthole_export_exclusions WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'signals.export-excluded',substr(NEW.record_id,1,36),0,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_export_exclusions_no_delete BEFORE DELETE ON porthole_export_exclusions BEGIN
 SELECT RAISE(ABORT,'export_exclusions_append_only');
END;
CREATE TRIGGER porthole_export_exclusions_no_rollback BEFORE UPDATE ON porthole_export_exclusions WHEN NEW.record_id!=OLD.record_id OR NEW.excluded_at<OLD.excluded_at BEGIN
 SELECT RAISE(ABORT,'export_exclusions_append_only');
END;
