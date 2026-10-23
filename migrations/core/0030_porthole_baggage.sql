CREATE TABLE porthole_baggage_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 allowed_keys TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(allowed_keys)),
 attribute_keys TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attribute_keys)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO porthole_baggage_policy(singleton) VALUES(1);
CREATE TRIGGER porthole_baggage_audit AFTER UPDATE ON porthole_baggage_policy WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_baggage_policy',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_baggage_policy' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
