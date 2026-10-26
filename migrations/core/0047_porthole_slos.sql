-- Revisions are immutable definitions. Evaluation reads retained source data
-- each time so late arrivals and erasure cannot leave a stale healthy report.
CREATE TABLE porthole_slo_versions (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), owner_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','quarantined')),
 PRIMARY KEY(id,revision)
);
CREATE TRIGGER porthole_slo_fact AFTER INSERT ON porthole_slo_versions WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'slo.revision',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
