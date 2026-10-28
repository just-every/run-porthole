import { canonical, fail, integer, keys, text } from './protocol.mjs';
import { record } from './replicate.mjs';
import { state, watermark } from './coverage.mjs';

/** Ordered projection changes have a separate cursor from immutable batches. */
export async function sampling(db,input){
 keys(input,['sourceIdentity','changes']);text(input.sourceIdentity);
 if(!Array.isArray(input.changes)||input.changes.length>200)fail('invalid_sampling_changes');
 const control=await state(db);
 if(control.stopped)fail('analytics_stopped',503);
 if(control.source_identity!==input.sourceIdentity)fail('analytics_source_mismatch',409);
 const changes=[];let prior=null;
 for(const change of input.changes){
  keys(change,['sequence','batchId','sourceId','ordinal','record']);
  integer(change.sequence,1);integer(change.ordinal,0,9999);text(change.batchId,100);text(change.sourceId);
  if(prior!==null&&change.sequence!==prior+1)fail('invalid_sampling_sequence');prior=change.sequence;
  const origin=await db.prepare(`SELECT o.*,b.source_id,b.signal FROM analytics_sampling_origins o JOIN analytics_batches b ON b.id=o.batch_id WHERE o.batch_id=? AND o.ordinal=?`).bind(change.batchId,change.ordinal).first();
  if(!origin||origin.signal!=='traces'||origin.source_id!==change.sourceId)fail('invalid_sampling_origin',409);
  const value=change.record===null?null:record(change.record,{id:change.batchId},change.ordinal);
  if(value){
   if(value.payload.inputStage!=='pre-sampling'||value.payload.sampling?.policy!=='destination-tail/v1')fail('invalid_sampling_provenance');
   for(const [key,column]of [['team','team'],['service','service'],['environment','environment'],['eventTimeNs','event_time_ns'],['traceId','trace_id'],['spanId','span_id']])if(value[key]!==origin[column])fail('invalid_sampling_origin',409);
  }
  const id=`${change.batchId}:${change.ordinal}`;
  const direct=await db.prepare('SELECT 1 AS present FROM analytics_records r WHERE r.id=? AND NOT EXISTS(SELECT 1 FROM analytics_sampling_records s WHERE s.record_id=r.id)').bind(id).first();
  if(direct)fail('analytics_identity_conflict',409);
  changes.push({...change,id,record:value});
 }
 const pending=changes.filter(change=>change.sequence>control.sampling_watermark);
 if(pending.length&&pending[0].sequence!==control.sampling_watermark+1)fail('invalid_sampling_sequence',409);
 const statements=[],guard='(SELECT sampling_watermark FROM analytics_control WHERE singleton=1)=? AND (SELECT source_identity FROM analytics_control WHERE singleton=1)=? AND (SELECT stopped FROM analytics_control WHERE singleton=1)=0';
 for(const change of pending){
  const args=[control.sampling_watermark,input.sourceIdentity];
  // Recheck direct-row ownership in the same transaction as every mutation.
  const safe=`${guard} AND NOT EXISTS(SELECT 1 FROM analytics_records r WHERE r.id=? AND NOT EXISTS(SELECT 1 FROM analytics_sampling_records s WHERE s.record_id=r.id))`;
  statements.push(db.prepare(`INSERT INTO analytics_sampling_records(record_id,sequence) SELECT ?,? WHERE ${safe} ON CONFLICT(record_id) DO UPDATE SET sequence=excluded.sequence`).bind(change.id,change.sequence,...args,change.id));
  if(change.record){const r=change.record;
   statements.push(db.prepare(`INSERT INTO analytics_records(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,indexed_at,archived_at,late,out_of_order)
    SELECT ?,?,?,?,'traces',?,?,?,?,?,?,?,?,?,?,? WHERE ${safe}
    ON CONFLICT(batch_id,ordinal) DO UPDATE SET payload=excluded.payload,indexed_at=excluded.indexed_at,archived_at=excluded.archived_at,late=excluded.late,out_of_order=excluded.out_of_order`)
    .bind(change.id,change.batchId,change.ordinal,change.sourceId,r.team,r.service,r.environment,r.eventTimeNs,r.traceId,r.spanId,canonical(r.payload),r.indexedAt,r.archivedAt??null,r.late,r.outOfOrder,...args,change.id));
  }else statements.push(db.prepare(`DELETE FROM analytics_records WHERE id=? AND ${guard} AND EXISTS(SELECT 1 FROM analytics_sampling_records s WHERE s.record_id=analytics_records.id)`).bind(change.id,...args));
 }
 const end=pending.at(-1)?.sequence??control.sampling_watermark;
 if(pending.length)statements.push(db.prepare(`UPDATE analytics_control SET sampling_watermark=? WHERE singleton=1 AND ${guard}`).bind(end,control.sampling_watermark,input.sourceIdentity));
 if(statements.length)await db.batch(statements);
 const latest=await state(db);
 if(latest.source_identity!==input.sourceIdentity)fail('analytics_source_mismatch',409);
 if(latest.stopped)fail('analytics_stopped',503);
 if(latest.sampling_watermark<end)fail('analytics_incomplete_coverage',409);
 return {sourceIdentity:input.sourceIdentity,changes:pending.length,...await watermark(db)};
}
