CREATE TABLE porthole_dashboard_policies (
 dashboard_id TEXT PRIMARY KEY REFERENCES porthole_dashboards(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 entries TEXT NOT NULL CHECK(json_valid(entries)),
 state TEXT NOT NULL CHECK(state IN ('active','quarantined')),
 updated_at INTEGER NOT NULL
);
CREATE TABLE porthole_dashboard_policy_reviews (
 id TEXT PRIMARY KEY,
 dashboard_id TEXT NOT NULL,
 dashboard_revision INTEGER NOT NULL,
 policy_revision INTEGER NOT NULL,
 actor_id TEXT NOT NULL,
 actor_revision INTEGER NOT NULL,
 operator_version INTEGER NOT NULL,
 session_id TEXT NOT NULL,
 entries TEXT NOT NULL CHECK(json_valid(entries)),
 digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE TRIGGER porthole_dashboard_policy_insert AFTER INSERT ON porthole_dashboard_policies BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'dashboards.policy-change',NEW.dashboard_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_dashboard_policy_update AFTER UPDATE ON porthole_dashboard_policies BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'dashboards.policy-change',NEW.dashboard_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
