-- Prior typed addresses were never recipient confirmation. Keep their history,
-- but require the ruled verified-address grant before any further delivery.
UPDATE porthole_health_configuration SET notices_enabled=0;
UPDATE porthole_health_notices SET state='cancelled' WHERE state='pending';
CREATE TABLE porthole_health_recipients (
 id TEXT PRIMARY KEY, configuration_revision INTEGER NOT NULL UNIQUE,
 recipient TEXT NOT NULL, configured_by TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 token_hash TEXT, confirmed_at INTEGER, removed_at INTEGER,
 confirmation_delivery TEXT NOT NULL CHECK(confirmation_delivery IN ('self','pending','accepted','development','failed'))
);
CREATE TRIGGER porthole_recipient_grant AFTER INSERT ON porthole_health_recipients
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'health.recipient-grant',NEW.id,NEW.configuration_revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_recipient_confirm AFTER UPDATE OF confirmed_at ON porthole_health_recipients
 WHEN OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'health.recipient-confirm',NEW.id,NEW.configuration_revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_recipient_self_confirm AFTER INSERT ON porthole_health_recipients
 WHEN NEW.confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'health.recipient-confirm',NEW.id,NEW.configuration_revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_recipient_remove AFTER UPDATE OF removed_at ON porthole_health_recipients
 WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'health.recipient-remove',NEW.id,NEW.configuration_revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
