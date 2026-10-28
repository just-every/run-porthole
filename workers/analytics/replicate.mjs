import { canonical, digest, fail, integer, keys, limits, nano, object, signal, text } from './protocol.mjs';
import { state, watermark } from './coverage.mjs';

export function record(value, batch, ordinal) {
 keys(value, ['id', 'ordinal', 'team', 'service', 'environment', 'eventTimeNs', 'traceId', 'spanId', 'payload', 'indexedAt', 'archivedAt', 'late', 'outOfOrder']);
 if (value.id !== `${batch.id}:${ordinal}` || value.ordinal !== ordinal) fail('invalid_record_identity');
 for (const name of ['team', 'service', 'environment']) text(value[name], 1024, true);
 for (const name of ['traceId', 'spanId']) if (value[name] !== null) text(value[name], 128);
 object(value.payload); integer(value.indexedAt); if(value.archivedAt!==undefined)integer(value.archivedAt); integer(value.late, 0, 1); integer(value.outOfOrder, 0, 1);
 return { ...value, eventTimeNs: nano(value.eventTimeNs) };
}
export async function replicate(db, input) {
 keys(input, ['sourceIdentity', 'batches']); text(input.sourceIdentity);
 if (!Array.isArray(input.batches) || input.batches.length > limits.batches) fail('invalid_replication_batches');
 const control = await state(db);
 if (control.stopped) fail('analytics_stopped', 503);
 if (control.source_identity && control.source_identity !== input.sourceIdentity) fail('analytics_source_mismatch', 409);
 let count = 0;
 const batches = await Promise.all(input.batches.map(async batch => {
  keys(batch, ['id', 'completionSequence', 'sourceId', 'signal', 'digest', 'acceptedAt', 'completedAt', 'records', 'samplingOrigins']);
  text(batch.id, 100); text(batch.sourceId); text(batch.digest); signal(batch.signal);
  integer(batch.completionSequence, 1); integer(batch.acceptedAt); integer(batch.completedAt);
  if (!Array.isArray(batch.records)) fail('invalid_replication_records');
  count += batch.records.length;
  if (count > limits.records) fail('too_many_replication_records', 413);
  const records = batch.records.map((value, ordinal) => record(value, batch, ordinal));
  let samplingOrigins;
  if(batch.samplingOrigins!==undefined){
   if(batch.signal!=='traces'||records.length||!Array.isArray(batch.samplingOrigins)||batch.samplingOrigins.length>limits.records)fail('invalid_sampling_origins');
   samplingOrigins=batch.samplingOrigins.map((origin,ordinal)=>{
    keys(origin,['ordinal','team','service','environment','eventTimeNs','traceId','spanId']);
    if(origin.ordinal!==ordinal)fail('invalid_sampling_origin');
    for(const name of ['team','service','environment'])text(origin[name],1024,true);
    for(const name of ['traceId','spanId'])if(origin[name]!==null)text(origin[name],128);
    return {...origin,eventTimeNs:nano(origin.eventTimeNs)};
   });
  }
  const normalized = { ...batch, records, ...(samplingOrigins===undefined?{}:{samplingOrigins}) };
  return { ...normalized, contentDigest: await digest(canonical(normalized)) };
 }));
 if (new Set(batches.map(batch => batch.id)).size !== batches.length || new Set(batches.map(batch => batch.completionSequence)).size !== batches.length) fail('duplicate_batch_identity');
 const statements = [db.prepare('UPDATE analytics_control SET source_identity=? WHERE singleton=1 AND source_identity IS NULL').bind(input.sourceIdentity)];
 for (const batch of batches) {
  statements.push(db.prepare(`INSERT INTO analytics_batches(id,completion_sequence,source_id,signal,digest,content_digest,accepted_at,completed_at,replicated_at,record_count)
   SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT source_identity FROM analytics_control WHERE singleton=1)=? AND (SELECT stopped FROM analytics_control WHERE singleton=1)=0
   ON CONFLICT(id) DO NOTHING`).bind(batch.id, batch.completionSequence, batch.sourceId, batch.signal, batch.digest, batch.contentDigest, batch.acceptedAt, batch.completedAt, Date.now(), batch.records.length, input.sourceIdentity));
  if(batch.samplingOrigins)statements.push(db.prepare(`INSERT INTO analytics_sampling_origins(batch_id,ordinal,team,service,environment,event_time_ns,trace_id,span_id)
   SELECT b.id,json_extract(j.value,'$.ordinal'),json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs'),json_extract(j.value,'$.traceId'),json_extract(j.value,'$.spanId')
   FROM analytics_batches b,json_each(?) j WHERE b.id=? AND b.content_digest=? AND (SELECT source_identity FROM analytics_control WHERE singleton=1)=? AND (SELECT stopped FROM analytics_control WHERE singleton=1)=0
   ON CONFLICT(batch_id,ordinal) DO NOTHING`).bind(canonical(batch.samplingOrigins),batch.id,batch.contentDigest,input.sourceIdentity));
  statements.push(db.prepare(`INSERT INTO analytics_records(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,indexed_at,archived_at,late,out_of_order)
   SELECT json_extract(j.value,'$.id'),b.id,CAST(j.key AS INTEGER),b.source_id,b.signal,
   json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs'),
   json_extract(j.value,'$.traceId'),json_extract(j.value,'$.spanId'),json_extract(j.value,'$.payload'),json_extract(j.value,'$.indexedAt'),json_extract(j.value,'$.archivedAt'),json_extract(j.value,'$.late'),json_extract(j.value,'$.outOfOrder')
   FROM analytics_batches b,json_each(?) j WHERE b.id=? AND b.content_digest=? AND (SELECT source_identity FROM analytics_control WHERE singleton=1)=? AND (SELECT stopped FROM analytics_control WHERE singleton=1)=0
   ON CONFLICT(batch_id,ordinal) DO NOTHING`).bind(canonical(batch.records), batch.id, batch.contentDigest, input.sourceIdentity));
 }
 try { await db.batch(statements); }
 catch (error) {
  if (/analytics_identity_conflict|UNIQUE constraint failed/.test(String(error?.message))) fail('analytics_identity_conflict', 409);
  throw error;
 }
 // Recheck a competing source/control transition before acknowledging anything.
 const latest = await state(db);
 if (latest.source_identity !== input.sourceIdentity) fail('analytics_source_mismatch', 409);
 if (latest.stopped) fail('analytics_stopped', 503);
 return { sourceIdentity: input.sourceIdentity, batches: batches.map(batch => batch.id), replicatedRecords: count, ...await watermark(db) };
}
