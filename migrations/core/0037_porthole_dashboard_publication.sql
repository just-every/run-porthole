CREATE TABLE porthole_dashboard_publications(
 id TEXT PRIMARY KEY,dashboard_id TEXT NOT NULL,source_revision INTEGER NOT NULL CHECK(source_revision>0),
 owner_id TEXT NOT NULL,owner_revision INTEGER NOT NULL CHECK(owner_revision>0),operator_version INTEGER NOT NULL CHECK(operator_version>0),
 projection TEXT NOT NULL CHECK(json_valid(projection)),source_review TEXT NOT NULL CHECK(json_valid(source_review)),allowed_origins TEXT NOT NULL CHECK(json_valid(allowed_origins)),
 expires_at INTEGER NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('draft','published','revoked','quarantined')),
 revision INTEGER NOT NULL CHECK(revision>0),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,approved_at INTEGER,revoked_at INTEGER
);
CREATE INDEX porthole_publication_dashboard ON porthole_dashboard_publications(dashboard_id,created_at);
CREATE TRIGGER porthole_publication_immutable BEFORE UPDATE ON porthole_dashboard_publications
 WHEN NEW.id!=OLD.id OR NEW.dashboard_id!=OLD.dashboard_id OR NEW.source_revision!=OLD.source_revision
 OR NEW.owner_id!=OLD.owner_id OR NEW.owner_revision!=OLD.owner_revision OR NEW.operator_version!=OLD.operator_version
 OR NEW.projection!=OLD.projection OR NEW.source_review!=OLD.source_review OR NEW.allowed_origins!=OLD.allowed_origins
 OR NEW.expires_at!=OLD.expires_at OR NEW.digest!=OLD.digest OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'immutable_publication'); END;
CREATE TRIGGER porthole_publication_insert AFTER INSERT ON porthole_dashboard_publications BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'dashboards.publication-preview',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_publication_update AFTER UPDATE ON porthole_dashboard_publications BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,CASE WHEN NEW.state='published' THEN 'dashboards.publication-approve' ELSE 'dashboards.publication-revoke' END,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
