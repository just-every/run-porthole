-- The request context exists only inside the same D1 transaction as each write.
CREATE TABLE porthole_audit_context(singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_ref TEXT NOT NULL, actor_ref TEXT, actor_revision INTEGER, action TEXT NOT NULL, occurred_at INTEGER NOT NULL);
CREATE TABLE porthole_audit_facts(id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, operation_ref TEXT NOT NULL, actor_ref TEXT, actor_revision INTEGER, action TEXT NOT NULL, entity_ref TEXT NOT NULL, revision INTEGER, occurred_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL);
CREATE TRIGGER porthole_facts_no_update BEFORE UPDATE ON porthole_audit_facts BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
CREATE TRIGGER porthole_facts_no_delete BEFORE DELETE ON porthole_audit_facts BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
CREATE TABLE porthole_erased_actors(actor_ref TEXT PRIMARY KEY,erased_at INTEGER NOT NULL);
CREATE TRIGGER porthole_fact_oa_operators_insert AFTER INSERT ON oa_operators
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_operators_update AFTER UPDATE ON oa_operators
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) AND (OLD.version!=NEW.version OR OLD.email!=NEW.email OR OLD.display_name!=NEW.display_name) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_operators_delete AFTER DELETE ON oa_operators
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,OLD.id,OLD.version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_members_insert AFTER INSERT ON porthole_members
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.operator_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_members_update AFTER UPDATE ON porthole_members
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.operator_id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_members_delete AFTER DELETE ON porthole_members
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,OLD.operator_id,OLD.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_credentials_insert AFTER INSERT ON porthole_credentials
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_credentials_update AFTER UPDATE ON porthole_credentials
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) AND OLD.revision!=NEW.revision BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_porthole_credentials_delete AFTER DELETE ON porthole_credentials
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,OLD.id,OLD.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_sessions_insert AFTER INSERT ON oa_sessions
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_sessions_update AFTER UPDATE ON oa_sessions
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) AND OLD.revoked_at IS NOT NEW.revoked_at BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_sessions_delete AFTER DELETE ON oa_sessions
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,OLD.id,OLD.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_tokens_insert AFTER INSERT ON oa_tokens
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_tokens_update AFTER UPDATE ON oa_tokens
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,NEW.id,NEW.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;
CREATE TRIGGER porthole_fact_oa_tokens_delete AFTER DELETE ON oa_tokens
 WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,action,OLD.id,OLD.operator_version,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
 END;

CREATE TRIGGER porthole_erased_stays_inactive BEFORE UPDATE OF status ON oa_operators WHEN NEW.status!='inactive' AND EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=NEW.id) BEGIN SELECT RAISE(ABORT,'erased_actor'); END;
