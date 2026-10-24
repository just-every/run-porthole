CREATE TABLE porthole_dashboards(id TEXT PRIMARY KEY,name TEXT NOT NULL,scope TEXT NOT NULL CHECK(json_valid(scope)),body TEXT NOT NULL CHECK(json_valid(body)),revision INTEGER NOT NULL CHECK(revision>0),state TEXT NOT NULL CHECK(state IN ('active','archived','quarantined')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE porthole_dashboard_versions(id TEXT NOT NULL,name TEXT NOT NULL,scope TEXT NOT NULL CHECK(json_valid(scope)),body TEXT NOT NULL CHECK(json_valid(body)),revision INTEGER NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(id,revision));
CREATE TRIGGER porthole_dashboard_insert AFTER INSERT ON porthole_dashboards BEGIN
 INSERT OR IGNORE INTO porthole_dashboard_versions SELECT NEW.id,NEW.name,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'dashboards.create',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_dashboard_update AFTER UPDATE ON porthole_dashboards BEGIN
 INSERT OR IGNORE INTO porthole_dashboard_versions SELECT NEW.id,NEW.name,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'dashboards.change',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
