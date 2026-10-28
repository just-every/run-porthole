-- Rebuildable references into original envelopes; no copied span payloads.
CREATE TABLE porthole_sampling_origins (
 batch_id TEXT NOT NULL REFERENCES porthole_ingest_batches(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL,
 team TEXT NOT NULL,environment TEXT NOT NULL,trace_id TEXT NOT NULL,
 PRIMARY KEY(batch_id,ordinal)
);
CREATE INDEX porthole_sampling_trace_origins ON porthole_sampling_origins(team,environment,trace_id,batch_id,ordinal);
CREATE TRIGGER porthole_sampling_origins_insert AFTER INSERT ON porthole_ingest_batches
 WHEN NEW.sampling_recoverable=1 AND NEW.signal='traces' BEGIN
 INSERT INTO porthole_sampling_origins
 SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.team'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.traceId')
 FROM json_each(NEW.records) j
 WHERE json_extract(j.value,'$.payload.inputStage')='pre-sampling' AND json_extract(j.value,'$.traceId') IS NOT NULL;
END;
CREATE TRIGGER porthole_sampling_origins_change AFTER UPDATE OF records,sampling_recoverable ON porthole_ingest_batches BEGIN
 DELETE FROM porthole_sampling_origins WHERE batch_id=NEW.id;
 INSERT INTO porthole_sampling_origins
 SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.team'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.traceId')
 FROM json_each(NEW.records) j
 WHERE NEW.sampling_recoverable=1 AND NEW.signal='traces' AND json_extract(j.value,'$.payload.inputStage')='pre-sampling' AND json_extract(j.value,'$.traceId') IS NOT NULL;
END;
INSERT INTO porthole_sampling_origins
 SELECT b.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.team'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.traceId')
 FROM porthole_ingest_batches b,json_each(b.records) j
 WHERE b.sampling_recoverable=1 AND b.signal='traces' AND json_extract(j.value,'$.payload.inputStage')='pre-sampling' AND json_extract(j.value,'$.traceId') IS NOT NULL;
