-- Reviewed native removal; authority and inventory are fenced in one batch.
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER porthole_notebook_created;
DROP TRIGGER porthole_notebook_revised;

CREATE TABLE porthole_notebooks_handover (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_ref TEXT, author_ref TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(json_valid(scope)), body TEXT NOT NULL CHECK(json_valid(body)),
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO porthole_notebooks_handover SELECT * FROM porthole_notebooks;
CREATE TABLE porthole_notebook_versions_handover (
 id TEXT NOT NULL, name TEXT NOT NULL, owner_ref TEXT, author_ref TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(json_valid(scope)), body TEXT NOT NULL CHECK(json_valid(body)),
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(id,revision)
);
INSERT INTO porthole_notebook_versions_handover SELECT * FROM porthole_notebook_versions;
CREATE TABLE porthole_notebook_shares_handover (
 notebook_id TEXT NOT NULL REFERENCES porthole_notebooks_handover(id), kind TEXT NOT NULL CHECK(kind IN ('member','team')),
 target TEXT NOT NULL, owner_ref TEXT NOT NULL, owner_revision INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(notebook_id,kind,target)
);
INSERT INTO porthole_notebook_shares_handover SELECT * FROM porthole_notebook_shares;
CREATE TABLE porthole_notebook_publications_handover (
 id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES porthole_notebooks_handover(id),
 source_revision INTEGER NOT NULL CHECK(source_revision>0), owner_ref TEXT NOT NULL,
 owner_revision INTEGER NOT NULL, operator_version INTEGER NOT NULL,
 projection TEXT NOT NULL CHECK(json_valid(projection)), source_review TEXT NOT NULL CHECK(json_valid(source_review)),
 expires_at INTEGER NOT NULL, digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','published','revoked','quarantined')),
 revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 approved_at INTEGER, revoked_at INTEGER
);
INSERT INTO porthole_notebook_publications_handover SELECT * FROM porthole_notebook_publications;
CREATE TABLE porthole_event_filters_handover (
 id TEXT PRIMARY KEY, owner_ref TEXT, name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')), created_at INTEGER NOT NULL
);
INSERT INTO porthole_event_filters_handover SELECT * FROM porthole_event_filters;
DROP TABLE porthole_notebook_shares;
DROP TABLE porthole_notebook_publications;
DROP TABLE porthole_notebooks;
DROP TABLE porthole_notebook_versions;
DROP TABLE porthole_event_filters;
ALTER TABLE porthole_notebooks_handover RENAME TO porthole_notebooks;
ALTER TABLE porthole_notebook_versions_handover RENAME TO porthole_notebook_versions;
ALTER TABLE porthole_notebook_shares_handover RENAME TO porthole_notebook_shares;
ALTER TABLE porthole_notebook_publications_handover RENAME TO porthole_notebook_publications;
ALTER TABLE porthole_event_filters_handover RENAME TO porthole_event_filters;
CREATE TRIGGER porthole_notebook_created AFTER INSERT ON porthole_notebooks BEGIN
 INSERT OR IGNORE INTO porthole_notebook_versions SELECT NEW.id,NEW.name,NEW.owner_ref,NEW.author_ref,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
END;
CREATE TRIGGER porthole_notebook_revised AFTER UPDATE ON porthole_notebooks BEGIN
 INSERT OR IGNORE INTO porthole_notebook_versions SELECT NEW.id,NEW.name,NEW.owner_ref,NEW.author_ref,NEW.scope,NEW.body,NEW.revision,NEW.state,NEW.created_at,NEW.updated_at;
END;
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

CREATE TABLE porthole_handover_epoch(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL);
INSERT INTO porthole_handover_epoch VALUES(1,1);
CREATE TABLE porthole_handover_history(
 id TEXT PRIMARY KEY, target_ref TEXT NOT NULL, actor_ref TEXT NOT NULL,
 inventory_digest TEXT NOT NULL, decisions TEXT NOT NULL CHECK(json_valid(decisions)),
 occurred_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('committed','quarantined'))
);
CREATE TRIGGER porthole_handover_fact AFTER INSERT ON porthole_handover_history
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'membership.handover',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER handover_epoch_oa_operators_insert AFTER INSERT ON oa_operators BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_oa_operators_update AFTER UPDATE OF status,version,role ON oa_operators BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_oa_operators_delete AFTER DELETE ON oa_operators BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_members_insert AFTER INSERT ON porthole_members BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_members_update AFTER UPDATE OF role,scope,revision ON porthole_members BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_members_delete AFTER DELETE ON porthole_members BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_oa_credentials_insert AFTER INSERT ON oa_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_oa_credentials_update AFTER UPDATE OF operator_id,operator_version,revoked_at ON oa_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_oa_credentials_delete AFTER DELETE ON oa_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_credentials_insert AFTER INSERT ON porthole_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_credentials_update AFTER UPDATE OF custodian_id,class,name,scope,status,revision,expires_at ON porthole_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_credentials_delete AFTER DELETE ON porthole_credentials BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_service_versions_insert AFTER INSERT ON porthole_service_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_service_versions_update AFTER UPDATE ON porthole_service_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_service_versions_delete AFTER DELETE ON porthole_service_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebooks_insert AFTER INSERT ON porthole_notebooks BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebooks_update AFTER UPDATE ON porthole_notebooks BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebooks_delete AFTER DELETE ON porthole_notebooks BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_shares_insert AFTER INSERT ON porthole_notebook_shares BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_shares_update AFTER UPDATE ON porthole_notebook_shares BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_shares_delete AFTER DELETE ON porthole_notebook_shares BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_signal_exports_insert AFTER INSERT ON porthole_signal_exports BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_signal_exports_update AFTER UPDATE OF owner_ref,owner_revision,state,selection,credential_ref ON porthole_signal_exports BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_signal_exports_delete AFTER DELETE ON porthole_signal_exports BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_archive_jobs_insert AFTER INSERT ON porthole_archive_jobs BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_archive_jobs_update AFTER UPDATE OF owner_ref,state,row_count,next_chunk ON porthole_archive_jobs BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_archive_jobs_delete AFTER DELETE ON porthole_archive_jobs BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_publications_insert AFTER INSERT ON porthole_notebook_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_publications_update AFTER UPDATE ON porthole_notebook_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_notebook_publications_delete AFTER DELETE ON porthole_notebook_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_dashboard_publications_insert AFTER INSERT ON porthole_dashboard_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_dashboard_publications_update AFTER UPDATE ON porthole_dashboard_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_dashboard_publications_delete AFTER DELETE ON porthole_dashboard_publications BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_follow_up_insert AFTER INSERT ON porthole_follow_up BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_follow_up_update AFTER UPDATE ON porthole_follow_up BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_follow_up_delete AFTER DELETE ON porthole_follow_up BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_event_filters_insert AFTER INSERT ON porthole_event_filters BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_event_filters_update AFTER UPDATE ON porthole_event_filters BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_event_filters_delete AFTER DELETE ON porthole_event_filters BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_objects_insert AFTER INSERT ON porthole_objects BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_objects_update AFTER UPDATE ON porthole_objects BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_objects_delete AFTER DELETE ON porthole_objects BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_object_approvals_insert AFTER INSERT ON porthole_object_approvals BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_object_approvals_update AFTER UPDATE ON porthole_object_approvals BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_object_approvals_delete AFTER DELETE ON porthole_object_approvals BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_slo_versions_insert AFTER INSERT ON porthole_slo_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_slo_versions_update AFTER UPDATE ON porthole_slo_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_slo_versions_delete AFTER DELETE ON porthole_slo_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_database_sources_insert AFTER INSERT ON porthole_database_sources BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_database_sources_update AFTER UPDATE ON porthole_database_sources BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_database_sources_delete AFTER DELETE ON porthole_database_sources BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_metric_rules_insert AFTER INSERT ON porthole_metric_rules BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_metric_rules_update AFTER UPDATE ON porthole_metric_rules BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_metric_rules_delete AFTER DELETE ON porthole_metric_rules BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_pipeline_versions_insert AFTER INSERT ON porthole_pipeline_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_pipeline_versions_update AFTER UPDATE ON porthole_pipeline_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_pipeline_versions_delete AFTER DELETE ON porthole_pipeline_versions BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_erased_actors_insert AFTER INSERT ON porthole_erased_actors BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_erased_actors_update AFTER UPDATE ON porthole_erased_actors BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER handover_epoch_porthole_erased_actors_delete AFTER DELETE ON porthole_erased_actors BEGIN UPDATE porthole_handover_epoch SET revision=revision+1 WHERE singleton=1; END;
