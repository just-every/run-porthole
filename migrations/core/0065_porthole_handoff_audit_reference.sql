-- Fixed catalog product identifiers are encoded as private audit target references.
DROP TRIGGER porthole_handoff_fact;
CREATE TRIGGER porthole_handoff_fact AFTER INSERT ON porthole_handoff_versions WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'handoffs.revise',lower(hex(NEW.product)),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
