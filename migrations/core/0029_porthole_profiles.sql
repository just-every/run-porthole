-- D1 checks parent drops even with deferred foreign keys. Preserve dependent
-- rows first, rebuild the relationship inside this atomic migration, then
-- restore every original row and index without changing identity or watermarks.
CREATE TABLE porthole_ingest_batches_profiles (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, source_id TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('traces','metrics','logs','profiles')),
 identity TEXT NOT NULL, digest TEXT NOT NULL, protocol TEXT NOT NULL,
 accepted_at INTEGER NOT NULL, byte_count INTEGER NOT NULL, record_count INTEGER NOT NULL CHECK(record_count>=0),
 wire_base64 TEXT NOT NULL, records TEXT NOT NULL CHECK(json_valid(records)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')), completed_at INTEGER, completion_sequence INTEGER UNIQUE,
 UNIQUE(source_id,signal,identity)
);
INSERT INTO porthole_ingest_batches_profiles SELECT * FROM porthole_ingest_batches;
CREATE TABLE porthole_telemetry_records_profiles AS SELECT * FROM porthole_telemetry_records;
DROP TABLE porthole_telemetry_records;
CREATE TABLE porthole_telemetry_archive_profiles AS SELECT * FROM porthole_telemetry_archive;
DROP TABLE porthole_telemetry_archive;
DROP TABLE porthole_ingest_batches;
ALTER TABLE porthole_ingest_batches_profiles RENAME TO porthole_ingest_batches;
CREATE INDEX porthole_ingest_queue ON porthole_ingest_batches(state,accepted_at,id);
CREATE TABLE porthole_telemetry_records (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES porthole_ingest_batches(id), ordinal INTEGER NOT NULL,
 source_id TEXT NOT NULL, signal TEXT NOT NULL, team TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL,
 event_time_ns TEXT NOT NULL CHECK(length(event_time_ns)=20), trace_id TEXT, span_id TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)), indexed_at INTEGER NOT NULL,
 late INTEGER NOT NULL CHECK(late IN (0,1)), out_of_order INTEGER NOT NULL CHECK(out_of_order IN (0,1)),
 UNIQUE(batch_id,ordinal)
);
CREATE INDEX porthole_telemetry_scope_time ON porthole_telemetry_records(signal,team,service,environment,event_time_ns,id);
CREATE INDEX porthole_telemetry_source ON porthole_telemetry_records(source_id,signal,event_time_ns);
CREATE TABLE porthole_telemetry_archive (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES porthole_ingest_batches(id), ordinal INTEGER NOT NULL,
 source_id TEXT NOT NULL, signal TEXT NOT NULL, team TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL,
 event_time_ns TEXT NOT NULL CHECK(length(event_time_ns)=20), trace_id TEXT, span_id TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)), archived_at INTEGER NOT NULL,
 UNIQUE(batch_id,ordinal)
);
CREATE INDEX porthole_archive_scope_time ON porthole_telemetry_archive(signal,team,service,environment,event_time_ns,id);
CREATE INDEX IF NOT EXISTS porthole_trace_lookup ON porthole_telemetry_records(trace_id,signal,event_time_ns,id);
INSERT INTO porthole_telemetry_records SELECT * FROM porthole_telemetry_records_profiles;
DROP TABLE porthole_telemetry_records_profiles;
INSERT INTO porthole_telemetry_archive SELECT * FROM porthole_telemetry_archive_profiles;
DROP TABLE porthole_telemetry_archive_profiles;
