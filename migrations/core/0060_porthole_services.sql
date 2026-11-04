-- Edition-owned service metadata is immutable reviewed context, never an access grant.
CREATE TABLE porthole_service_versions (
 id TEXT NOT NULL, service TEXT NOT NULL, environment TEXT NOT NULL, team TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), owner_ref TEXT,
 repository TEXT NOT NULL, runbook TEXT NOT NULL,
 criticality TEXT NOT NULL CHECK(criticality IN ('unclassified','low','medium','high','critical')),
 author_ref TEXT NOT NULL, created_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 PRIMARY KEY(id,revision)
);
CREATE TRIGGER porthole_service_fact AFTER INSERT ON porthole_service_versions
WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'services.revise',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
