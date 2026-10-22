CREATE TABLE analytics_control (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),
 source_identity TEXT
);
INSERT INTO analytics_control(singleton) VALUES(1);
CREATE TABLE analytics_batches (
 id TEXT PRIMARY KEY,
 completion_sequence INTEGER NOT NULL UNIQUE CHECK(completion_sequence>0),
 source_id TEXT NOT NULL,
 signal TEXT NOT NULL CHECK(signal IN ('logs','metrics','traces')),
 digest TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 completed_at INTEGER NOT NULL,
 replicated_at INTEGER NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count>=0)
);
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
 UNIQUE(batch_id,ordinal)
);
CREATE INDEX analytics_records_query ON analytics_records(signal,event_time_ns,id);
CREATE INDEX analytics_records_scope ON analytics_records(team,service,environment,signal,event_time_ns);
