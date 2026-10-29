CREATE TABLE porthole_notebook_publications (
 id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES porthole_notebooks(id),
 source_revision INTEGER NOT NULL CHECK(source_revision>0), owner_ref TEXT NOT NULL,
 owner_revision INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 projection TEXT NOT NULL CHECK(json_valid(projection)), source_review TEXT NOT NULL CHECK(json_valid(source_review)),
 expires_at INTEGER NOT NULL, digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','published','revoked','quarantined')),
 revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 approved_at INTEGER, revoked_at INTEGER
);
CREATE TRIGGER porthole_notebook_publication_immutable BEFORE UPDATE ON porthole_notebook_publications
 WHEN NEW.id!=OLD.id OR NEW.notebook_id!=OLD.notebook_id OR NEW.source_revision!=OLD.source_revision
 OR NEW.owner_ref!=OLD.owner_ref OR NEW.owner_revision!=OLD.owner_revision OR NEW.operator_version!=OLD.operator_version
 OR NEW.projection!=OLD.projection OR NEW.source_review!=OLD.source_review OR NEW.expires_at!=OLD.expires_at
 OR NEW.digest!=OLD.digest OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'immutable_notebook_publication'); END;
CREATE TRIGGER porthole_notebook_publication_created AFTER INSERT ON porthole_notebook_publications BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'notebooks.publication-preview',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_notebook_publication_changed AFTER UPDATE ON porthole_notebook_publications BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,CASE WHEN NEW.state='published' THEN 'notebooks.publication-approve' ELSE 'notebooks.publication-revoke' END,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
