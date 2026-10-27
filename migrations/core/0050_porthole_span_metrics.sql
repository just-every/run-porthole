-- Reviewed bounded definitions apply only to subsequently accepted envelopes.
CREATE TABLE porthole_metric_previews(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,session_id TEXT NOT NULL,definition TEXT NOT NULL,digest TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER,target_id TEXT NOT NULL,expected_revision INTEGER NOT NULL);
CREATE TABLE porthole_metric_rules(id TEXT NOT NULL,revision INTEGER NOT NULL,definition TEXT NOT NULL,from_sequence INTEGER NOT NULL,created_at INTEGER NOT NULL,owner_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','quarantined')),PRIMARY KEY(id,revision));
CREATE TABLE porthole_metric_points(rule_id TEXT NOT NULL,revision INTEGER NOT NULL,batch_id TEXT NOT NULL,ordinal INTEGER NOT NULL,dimensions TEXT NOT NULL,value REAL,valid INTEGER NOT NULL,event_time_ns TEXT NOT NULL,trace_id TEXT NOT NULL,span_id TEXT NOT NULL,PRIMARY KEY(rule_id,revision,batch_id,ordinal));
CREATE INDEX porthole_metric_window ON porthole_metric_points(rule_id,revision,event_time_ns);
CREATE TRIGGER porthole_metric_batch_erasure AFTER DELETE ON porthole_ingest_batches BEGIN DELETE FROM porthole_metric_points WHERE batch_id=OLD.id; END;
CREATE TRIGGER porthole_metric_rule_fact AFTER INSERT ON porthole_metric_rules WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'metrics.rule-approve',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;

CREATE TRIGGER porthole_metric_record_erasure AFTER DELETE ON porthole_telemetry_records BEGIN DELETE FROM porthole_metric_points WHERE batch_id=OLD.batch_id AND ordinal=OLD.ordinal; END;
CREATE TRIGGER porthole_metric_envelope_erasure AFTER UPDATE OF records ON porthole_ingest_batches WHEN NEW.records='[]' AND NEW.record_count=0 BEGIN DELETE FROM porthole_metric_points WHERE batch_id=NEW.id; END;
