-- Operational continuations hold query text and watermarks, never result copies.
-- They are not restored from installation archives.
CREATE TABLE porthole_query_runs (
 id TEXT PRIMARY KEY, actor_ref TEXT NOT NULL, actor_revision INTEGER NOT NULL,
 query TEXT NOT NULL CHECK(json_valid(query)), state TEXT NOT NULL CHECK(state IN ('ready','partial','complete','canceled','timed_out','interrupted')),
 cursor TEXT, scanned INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 0,
 scan_limit INTEGER NOT NULL, deadline INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX porthole_query_runs_actor ON porthole_query_runs(actor_ref,created_at,id);
CREATE TRIGGER porthole_query_run_insert AFTER INSERT ON porthole_query_runs WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,NEW.actor_ref,actor_revision,'query.run',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_query_run_update AFTER UPDATE ON porthole_query_runs WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,NEW.actor_ref,actor_revision,'query.run',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
