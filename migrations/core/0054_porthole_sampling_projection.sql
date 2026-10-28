-- References only: original and retained payloads keep their existing custody.
CREATE TABLE porthole_sampling_changes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 record_id TEXT NOT NULL
);
CREATE TRIGGER porthole_sampling_projection_insert AFTER INSERT ON porthole_telemetry_records
 WHEN json_extract(NEW.payload,'$.inputStage')='pre-sampling' BEGIN
 INSERT INTO porthole_sampling_changes(record_id) VALUES(NEW.id);
END;
CREATE TRIGGER porthole_sampling_projection_update AFTER UPDATE OF payload ON porthole_telemetry_records
 WHEN NEW.payload!=OLD.payload AND (json_extract(NEW.payload,'$.inputStage')='pre-sampling' OR json_extract(OLD.payload,'$.inputStage')='pre-sampling') BEGIN
 INSERT INTO porthole_sampling_changes(record_id) VALUES(NEW.id);
END;
CREATE TRIGGER porthole_sampling_projection_delete AFTER DELETE ON porthole_telemetry_records
 WHEN json_extract(OLD.payload,'$.inputStage')='pre-sampling' BEGIN
 INSERT INTO porthole_sampling_changes(record_id) VALUES(OLD.id);
END;
INSERT INTO porthole_sampling_changes(record_id)
 SELECT id FROM porthole_telemetry_records WHERE json_extract(payload,'$.inputStage')='pre-sampling' ORDER BY batch_id,ordinal;
