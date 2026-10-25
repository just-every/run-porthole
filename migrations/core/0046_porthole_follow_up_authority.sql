DROP TRIGGER porthole_follow_up_scope_change;
-- Authority revocation never waits for work review. Keep the original work and
-- its scope, suspend assignment, and require a current native owner to review.
CREATE TRIGGER porthole_follow_up_authority_changed AFTER UPDATE OF role,scope ON porthole_members
 WHEN NEW.role!=OLD.role OR NEW.scope!=OLD.scope BEGIN
 INSERT INTO porthole_follow_up_events
 SELECT lower(hex(randomblob(16))),id,generation,'authority-change',NULL,'Assignee authority changed; assignment suspended for native owner review.',CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM porthole_follow_up WHERE owner_id=OLD.operator_id AND state!='resolved';
 UPDATE porthole_follow_up SET owner_id=NULL,state='blocked',reason='Assignee authority changed; native owner review required.',next_action='Review an active successor with the original work scope, or explicitly keep this work unassigned.',revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE owner_id=OLD.operator_id AND state!='resolved';
END;
