-- Keep native activity inside the archive's opaque-ID and action-name contract.
-- The door row retains the exact agent-for-person label; entity_ref links to it.
-- Preserve applied migrations and the append-only historical ledger.
DROP TRIGGER porthole_agent_audit_insert;
DROP TRIGGER porthole_agent_audit_update;

CREATE TRIGGER porthole_agent_audit_insert AFTER INSERT ON agent_door_audit WHEN json_extract(NEW.row,'$.outcome') IN ('done','refused','pending','failed','replayed') BEGIN
 INSERT OR IGNORE INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at)
 SELECT NEW.id,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,
 json_extract(NEW.row,'$.operation_id'),json_extract(NEW.row,'$.sponsor.id'),
 (SELECT revision FROM porthole_members WHERE operator_id=json_extract(NEW.row,'$.sponsor.id')),
 CASE json_extract(NEW.row,'$.tool')
 WHEN 'porthole.telemetry.query' THEN 'porthole.telemetry.query'
 WHEN 'porthole.definitions.read' THEN 'porthole.definitions.read'
 WHEN 'porthole.workspace.snapshot' THEN 'porthole.workspace.snapshot'
 WHEN 'resources/read' THEN 'agent.resource-read'
 ELSE 'agent.refused' END,NEW.id,
 json_extract(NEW.row,'$.revision'),CAST(unixepoch(NEW.at)*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER);
END;
CREATE TRIGGER porthole_agent_audit_update AFTER UPDATE ON agent_door_audit WHEN json_extract(NEW.row,'$.outcome') IN ('done','refused','pending','failed','replayed') BEGIN
 INSERT OR IGNORE INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at)
 SELECT NEW.id,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,
 json_extract(NEW.row,'$.operation_id'),json_extract(NEW.row,'$.sponsor.id'),
 (SELECT revision FROM porthole_members WHERE operator_id=json_extract(NEW.row,'$.sponsor.id')),
 CASE json_extract(NEW.row,'$.tool')
 WHEN 'porthole.telemetry.query' THEN 'porthole.telemetry.query'
 WHEN 'porthole.definitions.read' THEN 'porthole.definitions.read'
 WHEN 'porthole.workspace.snapshot' THEN 'porthole.workspace.snapshot'
 WHEN 'resources/read' THEN 'agent.resource-read'
 ELSE 'agent.refused' END,NEW.id,
 json_extract(NEW.row,'$.revision'),CAST(unixepoch(NEW.at)*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER);
END;
