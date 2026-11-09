-- Retain every physical custody row; only a reviewed active inventory is read.
-- Sequence numbers belong to the current control plane, not discarded history.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE analytics_batches_next (
 id TEXT PRIMARY KEY,
 completion_sequence INTEGER NOT NULL CHECK(completion_sequence>0),
 source_id TEXT NOT NULL,
 signal TEXT NOT NULL CHECK(signal IN ('logs','metrics','traces','profiles')),
 digest TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 completed_at INTEGER NOT NULL,
 replicated_at INTEGER NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count>=0)
);
INSERT INTO analytics_batches_next SELECT * FROM analytics_batches;
CREATE TABLE analytics_records_next (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES analytics_batches_next(id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 source_id TEXT NOT NULL,
 signal TEXT NOT NULL CHECK(signal IN ('logs','metrics','traces','profiles')),
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
INSERT INTO analytics_records_next SELECT * FROM analytics_records;
DROP TABLE analytics_records;
DROP TABLE analytics_batches;
ALTER TABLE analytics_batches_next RENAME TO analytics_batches;
ALTER TABLE analytics_records_next RENAME TO analytics_records;
CREATE TRIGGER analytics_immutable_batch BEFORE INSERT ON analytics_batches
WHEN EXISTS(SELECT 1 FROM analytics_batches WHERE id=NEW.id AND content_digest<>NEW.content_digest)
BEGIN SELECT RAISE(ABORT,'analytics_identity_conflict'); END;
CREATE INDEX analytics_records_query ON analytics_records(signal,event_time_ns,id);
CREATE INDEX analytics_records_scope ON analytics_records(team,service,environment,signal,event_time_ns);
CREATE TABLE analytics_active_batches (
 batch_id TEXT PRIMARY KEY REFERENCES analytics_batches(id),
 completion_sequence INTEGER NOT NULL UNIQUE CHECK(completion_sequence>0)
);
INSERT INTO analytics_active_batches SELECT id,completion_sequence FROM analytics_batches;
CREATE TABLE analytics_recoveries (
 id TEXT PRIMARY KEY,
 previous_identity TEXT NOT NULL,
 destination_identity TEXT NOT NULL,
 inventory_digest TEXT NOT NULL,
 retained_batches INTEGER NOT NULL,
 retained_records INTEGER NOT NULL,
 fenced_batches INTEGER NOT NULL,
 fenced_records INTEGER NOT NULL,
 recovered_at INTEGER NOT NULL
);
