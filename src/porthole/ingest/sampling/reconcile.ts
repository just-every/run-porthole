import type { Bindings } from '../../../auth.server'
import { canonical, type TelemetryRecord } from '../model'
import { cohort, defaults, isErrorSpan, type SamplingPolicy } from './model'

interface Batch {id:string;sequence:number;records:string}
interface Candidate {team:string;environment:string;traceId:string;ordinaryPercent:number;slowThresholdMs:number;minStart:string;maxEnd:string;error:number;cohort:number}
const stage="json_extract(j.value,'$.payload.inputStage')='pre-sampling'"
// Only traces affected by the current batch are revisited. Their original
// envelopes are the late-span recovery buffer; no payload is copied elsewhere.
// Materialize the current trace keys once per statement. A correlated lookup
// would rescan the current envelope for every historical span during recovery.
const affected=`(d.team,d.environment,d.trace_id) IN (SELECT o.team,o.environment,o.trace_id FROM porthole_sampling_origins o JOIN porthole_ingest_batches current ON current.id=o.batch_id WHERE current.id=? AND current.sampling_recoverable=1)`

/** Called only after metric contributions and the complete transition commit.
 * Every replay is conditional on sampling_pending, so concurrent drains cannot
 * count a decision twice or clear custody before its retained copies exist. */
export async function reconcileSampling(env:Bindings,options:{limit?:number}={}) {
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_sampling_decisions'").first())return {processedBatches:0,pendingBatches:0}
 const limit=options.limit??100
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('invalid_sampling_drain_limit')
 const batches=(await env.DB.prepare("SELECT id,sequence,records FROM porthole_ingest_batches WHERE state='complete' AND sampling_pending=1 AND sampling_recoverable=1 ORDER BY sequence LIMIT ?").bind(limit).all<Batch>()).results
 let processedBatches=0
 for(const batch of batches) {
  const rules=(await env.DB.prepare(`SELECT p.definition FROM porthole_sampling_policies p WHERE p.state='active' AND p.from_sequence<=? AND NOT EXISTS(SELECT 1 FROM porthole_sampling_policies newer WHERE newer.state='active' AND newer.team=p.team AND newer.service=p.service AND newer.environment=p.environment AND newer.revision>p.revision AND newer.from_sequence<=?)`).bind(batch.sequence,batch.sequence).all<{definition:string}>()).results
  const policies=new Map(rules.map(row=>{const d=JSON.parse(row.definition) as SamplingPolicy;return [canonical([d.team,d.service,d.environment]),d]}))
  const grouped=new Map<string,Candidate>()
  for(const row of JSON.parse(batch.records) as TelemetryRecord[]) {
   if(row.payload.inputStage!=='pre-sampling'||!row.traceId)continue
   const span=row.payload.record as {startTimeUnixNano:string;endTimeUnixNano:string;status?:{code:number|string};attributes?:unknown}
   const d=policies.get(canonical([row.team,row.service,row.environment]))??defaults
   const key=canonical([row.team,row.environment,row.traceId]),minStart=(span.startTimeUnixNano??'0').padStart(20,'0'),maxEnd=(span.endTimeUnixNano??'0').padStart(20,'0'),error=isErrorSpan(span)?1:0
   const existing=grouped.get(key)
   if(existing){existing.minStart=existing.minStart<minStart?existing.minStart:minStart;existing.maxEnd=existing.maxEnd>maxEnd?existing.maxEnd:maxEnd;existing.error=Math.max(existing.error,error);existing.ordinaryPercent=Math.max(existing.ordinaryPercent,d.ordinaryPercent);existing.slowThresholdMs=Math.min(existing.slowThresholdMs,d.slowThresholdMs)}
   else grouped.set(key,{team:row.team,environment:row.environment,traceId:row.traceId,ordinaryPercent:d.ordinaryPercent,slowThresholdMs:d.slowThresholdMs,minStart,maxEnd,error,cohort:0})
  }
  const candidates=[...grouped.values()]
  await Promise.all(candidates.map(async row=>{row.cohort=await cohort(row.team,row.environment,row.traceId)}))
  const now=Date.now()
  const results=await env.DB.batch([
   // A restored decision is historical provenance. The first new native input
   // starts a fresh decision when no earlier recoverable native input exists.
   env.DB.prepare(`DELETE FROM porthole_sampling_decisions AS d WHERE ${affected} AND NOT EXISTS(SELECT 1 FROM porthole_sampling_origins old JOIN porthole_ingest_batches prior ON prior.id=old.batch_id WHERE prior.id!=? AND prior.sampling_recoverable=1 AND old.team=d.team AND old.environment=d.environment AND old.trace_id=d.trace_id)`).bind(batch.id,batch.id),
   env.DB.prepare(`INSERT INTO porthole_sampling_decisions(team,environment,trace_id,retained,reason,ordinary_percent,cohort,slow_threshold_ms,min_start_ns,max_end_ns,first_decided_at,last_decided_at)
    SELECT json_extract(value,'$.team'),json_extract(value,'$.environment'),json_extract(value,'$.traceId'),CASE WHEN json_extract(value,'$.error')=1 OR CAST(json_extract(value,'$.maxEnd') AS INTEGER)-CAST(json_extract(value,'$.minStart') AS INTEGER)>=json_extract(value,'$.slowThresholdMs')*1000000 OR json_extract(value,'$.cohort')<json_extract(value,'$.ordinaryPercent')*100 THEN 1 ELSE 0 END,
    CASE WHEN json_extract(value,'$.error')=1 THEN 'error' WHEN CAST(json_extract(value,'$.maxEnd') AS INTEGER)-CAST(json_extract(value,'$.minStart') AS INTEGER)>=json_extract(value,'$.slowThresholdMs')*1000000 THEN 'slow' ELSE 'ordinary' END,
    json_extract(value,'$.ordinaryPercent'),json_extract(value,'$.cohort'),json_extract(value,'$.slowThresholdMs'),json_extract(value,'$.minStart'),json_extract(value,'$.maxEnd'),?,? FROM json_each(?)
    WHERE EXISTS(SELECT 1 FROM porthole_ingest_batches WHERE id=? AND state='complete' AND sampling_pending=1 AND sampling_recoverable=1)
    ON CONFLICT(team,environment,trace_id) DO UPDATE SET ordinary_percent=MAX(ordinary_percent,excluded.ordinary_percent),slow_threshold_ms=MIN(slow_threshold_ms,excluded.slow_threshold_ms),min_start_ns=MIN(min_start_ns,excluded.min_start_ns),max_end_ns=MAX(max_end_ns,excluded.max_end_ns),reason=CASE WHEN reason='error' OR excluded.reason='error' THEN 'error' WHEN reason='slow' OR excluded.reason='slow' OR CAST(MAX(max_end_ns,excluded.max_end_ns) AS INTEGER)-CAST(MIN(min_start_ns,excluded.min_start_ns) AS INTEGER)>=MIN(slow_threshold_ms,excluded.slow_threshold_ms)*1000000 THEN 'slow' ELSE 'ordinary' END,last_decided_at=excluded.last_decided_at`).bind(now,now,canonical(candidates),batch.id),
   // The preceding upsert first merges error and latency evidence from all sources.
   env.DB.prepare(`UPDATE porthole_sampling_decisions AS d SET promoted_at=CASE WHEN retained=0 AND (reason!='ordinary' OR cohort<ordinary_percent*100) THEN ? ELSE promoted_at END,retained=CASE WHEN retained=1 OR reason!='ordinary' OR cohort<ordinary_percent*100 THEN 1 ELSE 0 END WHERE ${affected}`).bind(now,batch.id),
   env.DB.prepare(`INSERT INTO porthole_telemetry_records(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,indexed_at,late,out_of_order)
    SELECT b.id||':'||j.key,b.id,CAST(j.key AS INTEGER),b.source_id,b.signal,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs'),json_extract(j.value,'$.traceId'),json_extract(j.value,'$.spanId'),
    json_set(json_extract(j.value,'$.payload'),'$.sampling',json_object('policy','destination-tail/v1','policyRevision',COALESCE((SELECT MAX(p.revision) FROM porthole_sampling_policies p WHERE p.state='active' AND p.team=d.team AND p.environment=d.environment AND p.service=json_extract(j.value,'$.service') AND p.from_sequence<=b.sequence),0),'ordinaryPercent',d.ordinary_percent,'probability',CASE WHEN d.reason='ordinary' THEN d.ordinary_percent/100.0 ELSE 1 END,'weight',CASE WHEN d.reason='ordinary' AND d.ordinary_percent>0 THEN 100.0/d.ordinary_percent ELSE 1 END,'reason',d.reason,'cohort',d.cohort,'slowThresholdMs',d.slow_threshold_ms,'firstDecidedAt',d.first_decided_at,'lastDecidedAt',d.last_decided_at,'promotedAt',d.promoted_at,'upstream','unknown','inputCompleteness','accepted-only')),
    ?,json_extract(j.value,'$.late'),json_extract(j.value,'$.outOfOrder')
    FROM porthole_sampling_decisions d JOIN porthole_sampling_origins origin ON origin.team=d.team AND origin.environment=d.environment AND origin.trace_id=d.trace_id
    JOIN porthole_ingest_batches b ON b.id=origin.batch_id JOIN json_each(b.records) j ON CAST(j.key AS INTEGER)=origin.ordinal
    WHERE b.signal='traces' AND b.state='complete' AND b.sampling_recoverable=1 AND ${stage} AND d.retained=1 AND ${affected}
    ON CONFLICT(batch_id,ordinal) DO UPDATE SET payload=excluded.payload`).bind(now,batch.id),
   env.DB.prepare(`INSERT INTO porthole_telemetry_archive(id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload,archived_at)
    SELECT r.id,r.batch_id,r.ordinal,r.source_id,r.signal,r.team,r.service,r.environment,r.event_time_ns,r.trace_id,r.span_id,r.payload,? FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id JOIN porthole_sampling_decisions d ON d.team=r.team AND d.environment=r.environment AND d.trace_id=r.trace_id WHERE b.sampling_recoverable=1 AND json_extract(r.payload,'$.inputStage')='pre-sampling' AND ${affected}
    ON CONFLICT(batch_id,ordinal) DO UPDATE SET payload=excluded.payload`).bind(now,batch.id),
   env.DB.prepare("UPDATE porthole_ingest_batches SET sampling_pending=0 WHERE id=? AND state='complete' AND sampling_pending=1 AND sampling_recoverable=1 RETURNING id").bind(batch.id)
  ])
  processedBatches+=results[5].results.length
 }
 const pending=await env.DB.prepare('SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE sampling_pending=1 AND sampling_recoverable=1').first<{n:number}>()
 return {processedBatches,pendingBatches:pending?.n??0}
}
