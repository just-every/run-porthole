CREATE TABLE porthole_analytical_configuration (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),source_identity TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),active_role TEXT NOT NULL DEFAULT 'primary' CHECK(active_role IN('primary','standby')),
 revision INTEGER NOT NULL DEFAULT 1,changed_at INTEGER NOT NULL DEFAULT 0,configured_by TEXT,configurer_revision INTEGER NOT NULL DEFAULT 0,configurer_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO porthole_analytical_configuration(singleton,source_identity) VALUES(1,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6))));
CREATE TRIGGER porthole_analytical_configuration_fact AFTER UPDATE ON porthole_analytical_configuration WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_entity_refs(kind,key_ref,entity_ref) VALUES('porthole_analytical_configuration',NEW.singleton,lower(hex(randomblob(16)))) ON CONFLICT DO NOTHING;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,(SELECT entity_ref FROM porthole_entity_refs WHERE kind='porthole_analytical_configuration' AND key_ref=NEW.singleton),NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
