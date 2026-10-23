-- Preserve dependent rows before rebuilding the signal constraint. D1 checks
-- parent drops immediately; each statement keeps referential integrity valid.
CREATE TABLE analytics_batches_profiles (
 id TEXT PRIMARY KEY,
 completion_sequence INTEGER NOT NULL UNIQUE CHECK(completion_sequence>0),
 source_id TEXT NOT NULL,
 signal TEXT NOT NULL CHECK(signal IN ('logs','metrics','traces','profiles')),
 digest TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 completed_at INTEGER NOT NULL,
 replicated_at INTEGER NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count>=0)
);
INSERT INTO analytics_batches_profiles SELECT * FROM analytics_batches;
CREATE TABLE analytics_records_profiles AS SELECT * FROM analytics_records;
DROP TABLE analytics_records;
DROP TABLE analytics_batches;
ALTER TABLE analytics_batches_profiles RENAME TO analytics_batches;
CREATE TRIGGER analytics_immutable_batch BEFORE INSERT ON analytics_batches
WHEN EXISTS(SELECT 1 FROM analytics_batches WHERE id=NEW.id AND content_digest<>NEW.content_digest)
BEGIN SELECT RAISE(ABORT,'analytics_identity_conflict'); END;
CREATE TABLE analytics_records (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES analytics_batches(id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 source_id TEXT NOT NULL,
 signal TEXT NOT NULL,
 team TEXT NOT NULL,
 service TEXT NOT NULL,
 environment TEXT NOT NULL,
 event_time_ns TEXT NOT NULL CHECK(length(event_time_ns)=20),
 trace_id TEXT,
 span_id TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 indexed_at INTEGER NOT NULL,
 late INTEGER NOT NULL,
 out_of_order INTEGER NOT NULL,
 archived_at INTEGER,
 UNIQUE(batch_id,ordinal)
);
CREATE INDEX analytics_records_query ON analytics_records(signal,event_time_ns,id);
CREATE INDEX analytics_records_scope ON analytics_records(team,service,environment,signal,event_time_ns);
INSERT INTO analytics_records SELECT id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,indexed_at,late,out_of_order,archived_at FROM analytics_records_profiles;
DROP TABLE analytics_records_profiles;
