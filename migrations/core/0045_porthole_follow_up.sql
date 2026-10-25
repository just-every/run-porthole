CREATE TABLE porthole_follow_up (
 id TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(json_valid(scope)), owner_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('open','blocked','resolved')),
 reason TEXT NOT NULL, next_action TEXT NOT NULL, due_at INTEGER NOT NULL,
 guard_id TEXT, guard_revision INTEGER, generation INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1, reminders INTEGER NOT NULL DEFAULT 0 CHECK(reminders IN (0,1)),
 suppressed_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE porthole_follow_up_events (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES porthole_follow_up(id),
 generation INTEGER NOT NULL, kind TEXT NOT NULL, actor_id TEXT, detail TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX porthole_follow_up_one_reminder ON porthole_follow_up_events(task_id,generation) WHERE kind='reminder';
CREATE TRIGGER porthole_follow_up_removal BEFORE UPDATE OF status ON oa_operators
 WHEN NEW.status='inactive' AND EXISTS(SELECT 1 FROM porthole_follow_up WHERE owner_id=OLD.id AND state!='resolved')
 BEGIN SELECT RAISE(ABORT,'follow_up_handover_required'); END;
CREATE TRIGGER porthole_follow_up_fact AFTER UPDATE ON porthole_follow_up WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'follow-up.change',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_follow_up_scope_change BEFORE UPDATE OF role,scope ON porthole_members
 WHEN (NEW.role!=OLD.role OR NEW.scope!=OLD.scope) AND EXISTS(SELECT 1 FROM porthole_follow_up WHERE owner_id=OLD.operator_id AND state!='resolved')
 BEGIN SELECT RAISE(ABORT,'follow_up_handover_required'); END;
CREATE TRIGGER porthole_follow_up_open_fact AFTER INSERT ON porthole_follow_up WHEN EXISTS(SELECT 1 FROM porthole_audit_context) BEGIN
 INSERT INTO porthole_audit_facts SELECT lower(hex(randomblob(16))),COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,operation_ref,actor_ref,actor_revision,'follow-up.open',NEW.id,NEW.revision,occurred_at,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM porthole_audit_context;
END;
CREATE TRIGGER porthole_follow_up_transition AFTER UPDATE OF state ON porthole_follow_up WHEN NEW.state!=OLD.state BEGIN
 INSERT INTO porthole_follow_up_events VALUES(lower(hex(randomblob(16))),NEW.id,NEW.generation,CASE WHEN NEW.state='resolved' THEN 'recovery' ELSE 'regression' END,NULL,NEW.reason,NEW.updated_at);
END;
