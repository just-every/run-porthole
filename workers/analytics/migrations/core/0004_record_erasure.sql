CREATE TABLE analytics_erased_batches (
 id TEXT PRIMARY KEY,
 content_digest TEXT NOT NULL CHECK(length(content_digest)=64),
 erased_at INTEGER NOT NULL CHECK(erased_at>=0),
 ordinals TEXT CHECK(ordinals IS NULL OR (json_valid(ordinals) AND json_type(ordinals)='array'))
);
CREATE INDEX analytics_erased_digest ON analytics_erased_batches(content_digest);
CREATE TABLE analytics_transaction_guard (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 witness INTEGER NOT NULL CHECK(witness=1)
);
-- Content may shrink only through permanent tombstones. Replication checks the
-- complete surviving record set transactionally; original manifest facts stay fixed.
DROP TRIGGER analytics_immutable_batch;
CREATE TRIGGER analytics_immutable_batch BEFORE INSERT ON analytics_batches
WHEN EXISTS(SELECT 1 FROM analytics_batches b WHERE b.id=NEW.id AND (
 b.completion_sequence IS NOT NEW.completion_sequence OR b.source_id IS NOT NEW.source_id
 OR b.signal IS NOT NEW.signal OR b.digest IS NOT NEW.digest
 OR b.accepted_at IS NOT NEW.accepted_at OR b.completed_at IS NOT NEW.completed_at
 OR (b.content_digest IS NOT NEW.content_digest AND NOT EXISTS(
  SELECT 1 FROM analytics_erased_batches e WHERE e.id=b.id OR e.content_digest=b.digest))))
BEGIN SELECT RAISE(ABORT,'analytics_identity_conflict'); END;
