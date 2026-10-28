ALTER TABLE analytics_control ADD COLUMN sampling_watermark INTEGER NOT NULL DEFAULT 0 CHECK(sampling_watermark>=0);
-- Immutable envelope identity without original span payloads.
CREATE TABLE analytics_sampling_origins (
 batch_id TEXT NOT NULL REFERENCES analytics_batches(id),ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 team TEXT NOT NULL,service TEXT NOT NULL,environment TEXT NOT NULL,event_time_ns TEXT NOT NULL,
 trace_id TEXT,span_id TEXT,PRIMARY KEY(batch_id,ordinal)
);
-- Retain ownership even for tombstones so a replay cannot overwrite direct rows.
CREATE TABLE analytics_sampling_records (
 record_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL CHECK(sequence>0)
);
