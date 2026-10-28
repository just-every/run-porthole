-- Null ordinals retain the earlier whole-envelope journal semantics.
ALTER TABLE porthole_erased_batches ADD COLUMN ordinals TEXT CHECK(ordinals IS NULL OR json_valid(ordinals));
CREATE TRIGGER porthole_erased_batch_update_fact AFTER UPDATE ON porthole_erased_batches
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'privacy.erase-batch',NEW.id,NULL,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TABLE porthole_retention_schedules (
 policy_id TEXT PRIMARY KEY REFERENCES porthole_retention_policies(id), policy_revision INTEGER NOT NULL,
 owner_ref TEXT NOT NULL, owner_revision INTEGER NOT NULL, owner_version INTEGER NOT NULL,
 approved_at INTEGER NOT NULL, next_run_at INTEGER NOT NULL
);
CREATE TABLE porthole_retention_runs (
 id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
 started_at INTEGER NOT NULL, cutoff_ns TEXT NOT NULL, erased_records INTEGER NOT NULL
);
