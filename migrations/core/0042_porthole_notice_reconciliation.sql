-- Receipt acceptance and its private audit fact commit atomically.
CREATE TRIGGER porthole_notice_reconciled AFTER UPDATE OF state ON porthole_health_notices
 WHEN OLD.state='uncertain' AND NEW.state='accepted' AND EXISTS(SELECT 1 FROM porthole_audit_context WHERE action='integration.notice-reconcile') BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.configuration_revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
