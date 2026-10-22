-- These are immutable object references, never bucket credentials or grants.
CREATE TABLE porthole_bucket_history (
 id TEXT PRIMARY KEY,
 source_binding TEXT NOT NULL CHECK(source_binding='ARCHIVE_BUCKET'),
 object_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 1 AND 33554432),
 content_type TEXT NOT NULL,
 source_label TEXT NOT NULL,
 history_label TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined'))
);
CREATE TRIGGER porthole_bucket_history_immutable BEFORE UPDATE ON porthole_bucket_history
 WHEN NEW.id IS NOT OLD.id OR NEW.source_binding IS NOT OLD.source_binding
 OR NEW.object_key IS NOT OLD.object_key OR NEW.sha256 IS NOT OLD.sha256
 OR NEW.byte_count IS NOT OLD.byte_count OR NEW.content_type IS NOT OLD.content_type
 OR NEW.source_label IS NOT OLD.source_label OR NEW.history_label IS NOT OLD.history_label
 OR NEW.created_at IS NOT OLD.created_at
 OR NOT (OLD.state='quarantined' AND NEW.state='active')
 BEGIN SELECT RAISE(ABORT,'bucket_history_immutable'); END;
CREATE TRIGGER porthole_bucket_history_no_delete BEFORE DELETE ON porthole_bucket_history
 BEGIN SELECT RAISE(ABORT,'bucket_history_immutable'); END;

CREATE TRIGGER porthole_bucket_history_fact_insert AFTER INSERT ON porthole_bucket_history WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'storage.history',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER porthole_bucket_history_fact_update AFTER UPDATE ON porthole_bucket_history WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'storage.history',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
