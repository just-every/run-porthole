-- Reduced full-input RED custody. No span or trace IDs, attributes or exemplars.
CREATE TABLE porthole_red_points (
 batch_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
 team TEXT NOT NULL,service TEXT NOT NULL,environment TEXT NOT NULL,
 event_time_ns TEXT NOT NULL CHECK(length(event_time_ns)=20),
 input_stage TEXT NOT NULL CHECK(input_stage IN ('accepted','pre-sampling')),
 endpoint TEXT NOT NULL,error INTEGER NOT NULL CHECK(error IN (0,1)),duration_ns INTEGER,
 PRIMARY KEY(batch_id,ordinal)
);
CREATE INDEX porthole_red_window ON porthole_red_points(team,service,environment,input_stage,event_time_ns);
CREATE TRIGGER porthole_red_batch_erasure AFTER DELETE ON porthole_ingest_batches BEGIN
 DELETE FROM porthole_red_points WHERE batch_id=OLD.id;
END;
CREATE TRIGGER porthole_red_envelope_erasure AFTER UPDATE OF records ON porthole_ingest_batches WHEN NEW.records='[]' AND NEW.record_count=0 BEGIN
 DELETE FROM porthole_red_points WHERE batch_id=NEW.id;
END;
-- A retained pre-sampling copy is expendable. Erasing its source envelope above
-- remains authoritative; a direct accepted record follows canonical erasure.
CREATE TRIGGER porthole_red_record_erasure AFTER DELETE ON porthole_telemetry_records BEGIN
 DELETE FROM porthole_red_points WHERE batch_id=OLD.batch_id AND ordinal=OLD.ordinal AND input_stage='accepted';
END;
