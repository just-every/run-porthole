-- Edition roles are beside, never inside, Base's account/session policy.
CREATE TABLE porthole_members (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 role TEXT NOT NULL CHECK(role IN ('owner','admin','maintainer','responder','read-only analyst','finance reader','restricted contractor')),
 scope TEXT NOT NULL CHECK(json_valid(scope)), revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE porthole_membership_migration (
 operator_id TEXT PRIMARY KEY, previous_role TEXT NOT NULL, assigned_role TEXT NOT NULL,
 assigned_scope TEXT NOT NULL, gained_access INTEGER NOT NULL CHECK(gained_access=0)
);
INSERT INTO porthole_members(operator_id,role,scope)
 SELECT id,CASE WHEN role IN ('owner','admin') THEN role ELSE 'read-only analyst' END,
 CASE WHEN role IN ('owner','admin') THEN '{"services":["*"],"environments":["*"],"teams":["*"]}' ELSE '{"services":[],"environments":[],"teams":[]}' END FROM oa_operators;
INSERT INTO porthole_membership_migration SELECT m.operator_id,o.role,m.role,m.scope,0 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id;
-- New accounts, including bootstrap and Base's local personas, have an explicit
-- fail-closed product record. They never get a fallback role at request time.
CREATE TRIGGER porthole_member_insert AFTER INSERT ON oa_operators BEGIN
 INSERT INTO porthole_members(operator_id,role,scope) VALUES(NEW.id,
 CASE WHEN NEW.role IN ('owner','admin') THEN NEW.role ELSE 'read-only analyst' END,
 CASE WHEN NEW.role IN ('owner','admin') THEN '{"services":["*"],"environments":["*"],"teams":["*"]}' ELSE '{"services":[],"environments":[],"teams":[]}' END);
END;
-- A single guarded sidecar write changes both roles and the Base version.
-- Base's final-owner trigger is deliberately left in force. Every old session,
-- invite, personal credential and late write is fenced even for member→member.
CREATE TRIGGER porthole_member_authority AFTER UPDATE OF role,scope ON porthole_members
 WHEN OLD.role!=NEW.role OR OLD.scope!=NEW.scope BEGIN
 UPDATE porthole_members SET revision=OLD.revision+1 WHERE operator_id=NEW.operator_id;
 UPDATE oa_operators SET role=CASE WHEN NEW.role IN ('owner','admin') THEN NEW.role ELSE 'member' END,version=version+1 WHERE id=NEW.operator_id;
 UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.operator_id;
 UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.operator_id;
 UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.operator_id AND consumed_at IS NULL;
END;
CREATE TRIGGER porthole_member_status AFTER UPDATE OF status ON oa_operators
 WHEN OLD.status!=NEW.status BEGIN
 UPDATE porthole_members SET revision=revision+1 WHERE operator_id=NEW.id;
 UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.id AND NEW.status='inactive';
 UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.id AND NEW.status='inactive';
 UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE operator_id=NEW.id AND NEW.status='inactive' AND consumed_at IS NULL;
END;
-- A batch with preparatory custody writes must roll back when its final
-- authority-fenced mutation matched no row. This singleton stores no history.
CREATE TABLE porthole_transaction_guard(singleton INTEGER PRIMARY KEY CHECK(singleton=1),witness INTEGER NOT NULL CHECK(witness=1));
