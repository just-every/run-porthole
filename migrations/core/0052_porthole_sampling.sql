-- Full-input custody stays in the existing envelopes. This flag keeps unfinished
-- decisions inside the same bounded durable buffer as ordinary pending intake.
-- Native inputs may supply late siblings. Restored custody is inert evidence;
-- restore sets recovery eligibility to zero inside its own transaction.
ALTER TABLE porthole_ingest_batches ADD COLUMN sampling_recoverable INTEGER NOT NULL DEFAULT 1 CHECK(sampling_recoverable IN (0,1));
ALTER TABLE porthole_ingest_batches ADD COLUMN sampling_pending INTEGER NOT NULL DEFAULT 0 CHECK(sampling_pending IN (0,1));
CREATE INDEX porthole_sampling_queue ON porthole_ingest_batches(sampling_pending,state,sequence);
CREATE TRIGGER porthole_sampling_intake AFTER INSERT ON porthole_ingest_batches
 WHEN NEW.sampling_recoverable=1 AND NEW.signal='traces' AND EXISTS(SELECT 1 FROM json_each(NEW.records) j WHERE json_extract(j.value,'$.payload.inputStage')='pre-sampling') BEGIN
 UPDATE porthole_ingest_batches SET sampling_pending=1 WHERE id=NEW.id;
END;
UPDATE porthole_ingest_batches SET sampling_pending=1 WHERE sampling_recoverable=1 AND signal='traces' AND EXISTS(SELECT 1 FROM json_each(records) j WHERE json_extract(j.value,'$.payload.inputStage')='pre-sampling');
CREATE TRIGGER porthole_sampling_inactive AFTER UPDATE OF sampling_recoverable ON porthole_ingest_batches WHEN NEW.sampling_recoverable=0 BEGIN
 UPDATE porthole_ingest_batches SET sampling_pending=0 WHERE id=NEW.id;
END;
CREATE TABLE porthole_sampling_previews (
 id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,session_id TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),digest TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER
);
CREATE TABLE porthole_sampling_policies (
 team TEXT NOT NULL,service TEXT NOT NULL,environment TEXT NOT NULL,revision INTEGER NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),from_sequence INTEGER NOT NULL,
 owner_id TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','quarantined')),
 PRIMARY KEY(team,service,environment,revision)
);
-- No copied span content. The durable decision joins the original envelopes by
-- tenant, environment and trace identity, independent of collector and source key.
CREATE TABLE porthole_sampling_decisions (
 team TEXT NOT NULL,environment TEXT NOT NULL,trace_id TEXT NOT NULL,
 retained INTEGER NOT NULL CHECK(retained IN (0,1)),reason TEXT NOT NULL CHECK(reason IN ('ordinary','slow','error')),
 ordinary_percent INTEGER NOT NULL,cohort INTEGER NOT NULL,slow_threshold_ms INTEGER NOT NULL,
 min_start_ns TEXT NOT NULL,max_end_ns TEXT NOT NULL,
 first_decided_at INTEGER NOT NULL,last_decided_at INTEGER NOT NULL,promoted_at INTEGER,
 PRIMARY KEY(team,environment,trace_id)
);
CREATE TRIGGER porthole_sampling_batch_erasure AFTER DELETE ON porthole_ingest_batches BEGIN
 DELETE FROM porthole_sampling_decisions WHERE (team,environment,trace_id) IN
 (SELECT json_extract(value,'$.team'),json_extract(value,'$.environment'),json_extract(value,'$.traceId') FROM json_each(OLD.records))
 AND NOT EXISTS(SELECT 1 FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.sampling_recoverable=1 AND b.signal='traces' AND json_extract(j.value,'$.team')=porthole_sampling_decisions.team AND json_extract(j.value,'$.environment')=porthole_sampling_decisions.environment AND json_extract(j.value,'$.traceId')=porthole_sampling_decisions.trace_id);
END;
CREATE TRIGGER porthole_sampling_envelope_erasure AFTER UPDATE OF records ON porthole_ingest_batches WHEN NEW.records!=OLD.records BEGIN
 DELETE FROM porthole_sampling_decisions WHERE (team,environment,trace_id) IN
 (SELECT json_extract(value,'$.team'),json_extract(value,'$.environment'),json_extract(value,'$.traceId') FROM json_each(OLD.records))
 AND NOT EXISTS(SELECT 1 FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.sampling_recoverable=1 AND b.signal='traces' AND json_extract(j.value,'$.team')=porthole_sampling_decisions.team AND json_extract(j.value,'$.environment')=porthole_sampling_decisions.environment AND json_extract(j.value,'$.traceId')=porthole_sampling_decisions.trace_id);
 UPDATE porthole_ingest_batches SET sampling_pending=0 WHERE id=NEW.id AND NEW.records='[]';
END;
CREATE TRIGGER porthole_sampling_policy_fact AFTER INSERT ON porthole_sampling_policies WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'sampling.policy-approve',NEW.team||'/'||NEW.service||'/'||NEW.environment,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
