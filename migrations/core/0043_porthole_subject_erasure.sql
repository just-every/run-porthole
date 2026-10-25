-- Stable batch tombstones accompany archives; never retain the identifier.
CREATE TABLE porthole_erased_batches (
 id TEXT PRIMARY KEY, content_digest TEXT NOT NULL CHECK(length(content_digest)=64), erased_at INTEGER NOT NULL CHECK(erased_at>=0)
);
CREATE TRIGGER porthole_erased_batch_fact AFTER INSERT ON porthole_erased_batches
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'privacy.erase-batch',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
