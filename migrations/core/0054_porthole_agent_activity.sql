-- Project the door's exact actor label into the native append-only activity ledger.
-- Audit row id is the durable once-only projection key; private contents stay in the door.
CREATE TRIGGER porthole_agent_audit_insert AFTER INSERT ON agent_door_audit WHEN json_extract(NEW.row,'$.outcome') IN ('done','refused','pending','failed','replayed') BEGIN
 INSERT OR IGNORE INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at)
 SELECT 'agent-door:'||NEW.id,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,
 json_extract(NEW.row,'$.operation_id'),json_extract(NEW.row,'$.sponsor.id'),
 (SELECT revision FROM porthole_members WHERE operator_id=json_extract(NEW.row,'$.sponsor.id')),
 json_extract(NEW.row,'$.tool')||' — '||json_extract(NEW.row,'$.label'),NEW.id,
 json_extract(NEW.row,'$.revision'),CAST(unixepoch(NEW.at)*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER);
END;
CREATE TRIGGER porthole_agent_audit_update AFTER UPDATE ON agent_door_audit WHEN json_extract(NEW.row,'$.outcome') IN ('done','refused','pending','failed','replayed') BEGIN
 INSERT OR IGNORE INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at)
 SELECT 'agent-door:'||NEW.id,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,
 json_extract(NEW.row,'$.operation_id'),json_extract(NEW.row,'$.sponsor.id'),
 (SELECT revision FROM porthole_members WHERE operator_id=json_extract(NEW.row,'$.sponsor.id')),
 json_extract(NEW.row,'$.tool')||' — '||json_extract(NEW.row,'$.label'),NEW.id,
 json_extract(NEW.row,'$.revision'),CAST(unixepoch(NEW.at)*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER);
END;
