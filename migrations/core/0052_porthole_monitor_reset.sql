-- Keep prior decisions as history while beginning a fresh evaluation interval.
-- Both native activation doors update the object in the same transaction.
CREATE TRIGGER porthole_monitor_reset AFTER UPDATE OF state ON porthole_objects
WHEN NEW.kind='monitor' AND NEW.state IN ('active','inactive') AND OLD.state!=NEW.state
BEGIN
 DELETE FROM porthole_monitor_state WHERE object_id=NEW.id;
 INSERT INTO porthole_monitor_runs(id,object_id,revision,evaluated_at,result)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.revision,NEW.updated_at,
  json_object('monitorId',NEW.id,'revision',NEW.revision,'evaluatedAt',NEW.updated_at,
   'status','Unknown','observedCount',NULL,'lastKnownCount',NULL,'lastKnownAt',NULL,
   'firingEpisode',NULL,'groups',json('[]'),'snapshot',0,
   'reason',CASE WHEN NEW.state='active' THEN 'Monitor enabled; a fresh measured pending interval is required.' ELSE 'Monitor disabled; evaluation state was reset and prior decisions remain in history.' END));
END;
