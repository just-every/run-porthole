CREATE TABLE porthole_pipeline_versions (
 revision INTEGER PRIMARY KEY CHECK(revision>0),
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 created_at INTEGER NOT NULL,
 owner_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','quarantined'))
);
CREATE TABLE porthole_pipeline_previews (
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 expected_revision INTEGER NOT NULL,
 digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE TABLE porthole_log_metric_points (
 batch_id TEXT NOT NULL REFERENCES porthole_ingest_batches(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL,
 revision INTEGER NOT NULL,
 name TEXT NOT NULL,
 team TEXT NOT NULL,
 service TEXT NOT NULL,
 environment TEXT NOT NULL,
 event_time_ns TEXT NOT NULL,
 PRIMARY KEY(batch_id,ordinal,name)
);
CREATE TRIGGER porthole_pipeline_fact AFTER INSERT ON porthole_pipeline_versions WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'pipeline.activate',NEW.owner_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_log_metric_record_erasure AFTER DELETE ON porthole_telemetry_records BEGIN DELETE FROM porthole_log_metric_points WHERE batch_id=OLD.batch_id AND ordinal=OLD.ordinal; END;
CREATE TRIGGER porthole_log_metric_envelope_erasure AFTER UPDATE OF records ON porthole_ingest_batches WHEN NEW.records='[]' AND NEW.record_count=0 BEGIN DELETE FROM porthole_log_metric_points WHERE batch_id=NEW.id; END;
