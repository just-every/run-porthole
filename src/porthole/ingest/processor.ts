import {redContributions} from '../metrics/red/derive'
import {reconcileSampling} from './sampling'
import { contributions } from '../metrics/span-rules/derive'
import {reconcile as reconcileAnalytical} from '../analytical/client'
import type { Bindings } from '../../auth.server'
import { recordComponentReceipt } from '../health/receipts'

interface Batch { id:string;source_id:string;signal:string;records:string;record_count:number }
export async function drainIngest(env: Bindings, options: {limit?:number;force?:boolean} = {}) {
 const limit = options.limit ?? 20
 if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_drain_limit')
 try { return await drain(env,options,limit) }
 catch(error) {
  await recordComponentReceipt(env.DB,{component:'queue',source:'ingest-worker',status:'Unknown',reason:'Durable intake drain failed; accepted envelopes remain pending.'})
  throw error
 }
}

async function drain(env: Bindings, options: {force?:boolean}, limit:number) {
 const control = await env.DB.prepare('SELECT paused FROM porthole_ingest_control WHERE singleton=1').first<{paused:number}>()
 if (!control) throw new Error('ingest_control_unavailable')
 let processedBatches = 0, processedRecords = 0
 if (!control.paused || options.force) {
  const queue = (await env.DB.prepare("SELECT id,source_id,signal,records,record_count FROM porthole_ingest_batches WHERE state='pending' ORDER BY accepted_at,id LIMIT ?").bind(limit).all<Batch>()).results
  for (const batch of queue) {
   const now = Date.now()
   // Conditional inserts + transition are atomic. A crash or concurrent drain
   // can only leave the original pending envelope or one complete pair of
   // retained/archive copies. Retry resumes without a lease to get stranded.
   const metricWrites=[...await contributions(env,batch.id),...await redContributions(env,batch.id)]
   const results = await env.DB.batch([
    ...metricWrites,
    env.DB.prepare(`INSERT INTO porthole_telemetry_records(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,indexed_at,late,out_of_order)
     SELECT b.id||':'||j.key,b.id,CAST(j.key AS INTEGER),b.source_id,b.signal,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs'),json_extract(j.value,'$.traceId'),json_extract(j.value,'$.spanId'),json_extract(j.value,'$.payload'),?,json_extract(j.value,'$.late'),
     CASE WHEN EXISTS(SELECT 1 FROM porthole_telemetry_records old WHERE old.source_id=b.source_id AND old.signal=b.signal AND old.team=json_extract(j.value,'$.team') AND old.event_time_ns>json_extract(j.value,'$.eventTimeNs')) OR EXISTS(SELECT 1 FROM json_each(b.records) earlier WHERE CAST(earlier.key AS INTEGER)<CAST(j.key AS INTEGER) AND json_extract(earlier.value,'$.eventTimeNs')>json_extract(j.value,'$.eventTimeNs')) THEN 1 ELSE 0 END
     FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.id=? AND b.state='pending' AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted')!='pre-sampling' AND (?=1 OR (SELECT paused FROM porthole_ingest_control WHERE singleton=1)=0)
     ON CONFLICT(batch_id,ordinal) DO NOTHING`).bind(now,batch.id,options.force ? 1 : 0),
    env.DB.prepare(`INSERT INTO porthole_telemetry_archive(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,archived_at)
     SELECT id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,? FROM porthole_telemetry_records WHERE batch_id=?
     ON CONFLICT(batch_id,ordinal) DO NOTHING`).bind(now,batch.id),
    env.DB.prepare(`UPDATE porthole_ingest_batches SET state='complete',completed_at=?,completion_sequence=(SELECT COALESCE(MAX(completion_sequence),0)+1 FROM porthole_ingest_batches) WHERE id=? AND state='pending'
     AND (SELECT COUNT(*) FROM porthole_telemetry_records WHERE batch_id=?)=(SELECT COUNT(*) FROM json_each(records) item WHERE COALESCE(json_extract(item.value,'$.payload.inputStage'),'accepted')!='pre-sampling')
     AND (SELECT COUNT(*) FROM porthole_telemetry_archive WHERE batch_id=?)=(SELECT COUNT(*) FROM json_each(records) item WHERE COALESCE(json_extract(item.value,'$.payload.inputStage'),'accepted')!='pre-sampling')
     AND (?=1 OR (SELECT paused FROM porthole_ingest_control WHERE singleton=1)=0) RETURNING record_count`).bind(now,batch.id,batch.id,batch.id,options.force ? 1 : 0),
   ])
   if (results[metricWrites.length+2].results.length) { processedBatches++; processedRecords += Number((results[metricWrites.length+2].results[0] as {record_count:number}).record_count) }
  }
 }
 const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM porthole_ingest_batches WHERE state='pending'").first<{count:number}>()
 const sampling=await reconcileSampling(env)
 const analytical=await reconcileAnalytical(env)
 const result={sampling,analytical,processedBatches,processedRecords,pendingBatches:pending?.count ?? 0,paused:!!control.paused}
 await recordComponentReceipt(env.DB,{component:'queue',source:'ingest-worker',status:result.paused||result.pendingBatches>0||!analytical.complete?'Unknown':'Healthy',reason:!analytical.complete?'Analytical replication is incomplete; accepted envelopes remain durable.':result.paused?'Durable ingest processing is paused.':result.pendingBatches>0?'Durable ingest work remains buffered.':'Durable ingest drain completed.',evidence:result})
 return result
}
