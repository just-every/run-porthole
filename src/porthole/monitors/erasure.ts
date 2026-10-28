// Invalidate live monitor history derived from an erased signal and scope.
// Archive custody remains immutable and inactive; it never feeds live evaluation.
// The scoped loss events survive removal of the original envelope bytes.
export function eraseMonitorHistory(db:D1Database):D1PreparedStatement[] {
 const affected=(objectId:string,revision:string)=>`EXISTS(
  SELECT 1 FROM porthole_monitor_versions v JOIN porthole_ingest_events e
   ON e.signal=json_extract(v.body,'$.signal') AND e.reason='owner_erasure'
   WHERE v.object_id=${objectId} AND v.revision=${revision}
   AND EXISTS(SELECT 1 FROM porthole_ingest_batches b JOIN porthole_erased_batches j ON j.id=b.id OR j.content_digest=b.digest WHERE b.id=e.batch_ref)
   AND ${['team','service','environment'].map(key=>`EXISTS(SELECT 1 FROM json_each(v.scope,'$.${key==='environment'?'environments':key+'s'}') s WHERE s.value='*' OR s.value=e.${key})`).join(' AND ')})`
 return [
  db.prepare(`UPDATE porthole_monitor_state AS r SET status='Unknown',last_known_count=NULL,last_known_at=NULL,reason='Local telemetry was erased; prior evidence is incomplete.' WHERE ${affected('r.object_id','r.revision')}`),
  db.prepare(`DELETE FROM porthole_monitor_runs AS r WHERE ${affected('r.object_id','r.revision')}`),
 ]
}
