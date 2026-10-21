CREATE TABLE porthole_objects(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('monitor','repair')),name TEXT NOT NULL,scope TEXT NOT NULL CHECK(json_valid(scope)),body TEXT NOT NULL CHECK(json_valid(body)),revision INTEGER NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE porthole_object_approvals(id TEXT PRIMARY KEY,object_id TEXT NOT NULL REFERENCES porthole_objects(id),revision INTEGER NOT NULL,actor_ref TEXT NOT NULL,approved_at INTEGER NOT NULL);
CREATE UNIQUE INDEX porthole_approval_version ON porthole_object_approvals(object_id,revision);
CREATE TABLE porthole_query_snapshots(id TEXT PRIMARY KEY,actor_ref TEXT NOT NULL,scope TEXT NOT NULL CHECK(json_valid(scope)),signal TEXT NOT NULL,from_ns TEXT NOT NULL,through_ns TEXT NOT NULL,through_batch INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER porthole_objects_fact_insert AFTER INSERT ON porthole_objects WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'objects.'||NEW.kind,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_objects_fact_update AFTER UPDATE ON porthole_objects WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'objects.'||NEW.kind,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_approval_fact AFTER INSERT ON porthole_object_approvals WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'repair.approve',NEW.object_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_query_fact AFTER INSERT ON porthole_query_snapshots WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,NEW.actor_ref,actor_revision,'telemetry.query',NEW.id,NULL,created_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
