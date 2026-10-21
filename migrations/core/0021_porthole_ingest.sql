-- Accepted envelopes and their normalized records are committed with credential
-- quota reservation. Processing never deletes the envelope or an archive copy.
CREATE TABLE porthole_ingest_control (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
 max_pending_bytes INTEGER NOT NULL DEFAULT 33554432 CHECK(max_pending_bytes>0),
 revision INTEGER NOT NULL DEFAULT 1, changed_at INTEGER NOT NULL
);
INSERT INTO porthole_ingest_control(singleton,changed_at) VALUES(1,0);
CREATE TABLE porthole_ingest_batches (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, source_id TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('traces','metrics','logs')),
 identity TEXT NOT NULL, digest TEXT NOT NULL, protocol TEXT NOT NULL,
 accepted_at INTEGER NOT NULL, byte_count INTEGER NOT NULL, record_count INTEGER NOT NULL CHECK(record_count>=0),
 wire_base64 TEXT NOT NULL, records TEXT NOT NULL CHECK(json_valid(records)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')), completed_at INTEGER, completion_sequence INTEGER UNIQUE,
 UNIQUE(source_id,signal,identity)
);
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
CREATE TABLE porthole_ingest_events (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, signal TEXT NOT NULL, team TEXT NOT NULL,
 service TEXT NOT NULL, environment TEXT NOT NULL, occurred_at INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('rejected','duplicate','source_loss','buffer_loss')),
 reason TEXT NOT NULL, record_count INTEGER, batch_ref TEXT,
 range_start_ns TEXT, range_end_ns TEXT
);
CREATE INDEX porthole_ingest_events_scope ON porthole_ingest_events(source_id,signal,team,occurred_at);
