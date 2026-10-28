import type { Bindings } from '../../auth.server'
import { canonical, IntakeError, type TelemetryRecord } from '../ingest/model'
import { definition, type Definition } from './model'
import { transform, metricMatches } from './engine'
import { sanitize, sanitizePayload } from './redact'

export interface Version { revision:number;definition:string;created_at:number;owner_id:string;state:string }
export async function current(env:Bindings) {
 const available=!!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_pipeline_versions'").first()
 if(!available)return {available,revision:0,definition:null}
 const latest=await env.DB.prepare('SELECT * FROM porthole_pipeline_versions ORDER BY revision DESC LIMIT 1').first<Version>()
 return {available,revision:latest?.revision??0,definition:latest?.state==='active'?definition(JSON.parse(latest.definition)):null}
}
export function applies(record:TelemetryRecord,d:Definition) {return record.service===d.service&&record.environment===d.environment&&record.team===d.team}
export function processed(record:TelemetryRecord,d:Definition|null,revision:number,parse=true) {
 // Scope is authority, not an extracted field. Reject identifiers in scope
 // rather than routing them to a new or unpermitted destination.
 if([record.team,record.service,record.environment].some(value=>sanitize(value)!==value))throw new IntakeError('sensitive_resource_scope',400)
 const active=d&&applies(record,d)?d:null
 const safe={...record,payload:sanitizePayload(record.payload,active?.redaction)}
 const result=parse&&active?transform(safe,active,revision):safe
 result.payload=sanitizePayload(result.payload,active?.redaction)
 if(parse&&active) {
  const p=result.payload.pipeline as Record<string,unknown>
  p.metrics=metricMatches(result,active)
 }
 return result
}
export function logContributions(env:Bindings,batchId:string) {
 return env.DB.prepare(`INSERT INTO porthole_log_metric_points(batch_id,ordinal,revision,name,team,service,environment,event_time_ns)
 SELECT b.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.payload.pipeline.revision'),m.value,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),json_extract(j.value,'$.eventTimeNs')
 FROM porthole_ingest_batches b,json_each(b.records) j,json_each(j.value,'$.payload.pipeline.metrics') m WHERE b.id=? AND b.state='pending'
 ON CONFLICT(batch_id,ordinal,name) DO NOTHING`).bind(batchId)
}
export const storedFormat=(signal:string)=>signal==='traces'?'porthole.sanitized-trace-envelope.v1':'porthole.sanitized-log-envelope.v1'
export const storedLogWire=(records:TelemetryRecord[],signal='logs')=>new TextEncoder().encode(canonical({format:storedFormat(signal),records}))

// Approved exclusions apply only to this new acceptance. Keep the pre-exclusion
// count and byte journal, without retaining the discarded log body in a queue
// or in a later installation archive.
export function durableRecord(record:TelemetryRecord):TelemetryRecord {
 const p=record.payload.pipeline as Record<string,unknown>|undefined
 if(p?.excluded!==true)return record
 const excludedPayloadBytes=new TextEncoder().encode(canonical(record.payload)).length
 return {...record,payload:{pipeline:{revision:p.revision,status:p.status,errors:p.errors,excluded:true,protected:false,metrics:p.metrics,excludedPayloadBytes}}}
}
