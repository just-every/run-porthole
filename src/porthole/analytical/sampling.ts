import type {Bindings} from '../../auth.server'
import {fail} from '../security/authority'
import {fence,rpc,type Configuration,type Coverage,type Role} from './client'

/** This cursor covers retained insertions and later promotions, not intake. */
export async function samplingWatermark(env:Bindings):Promise<number> {
 return (await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM porthole_sampling_changes').first<{n:number}>())!.n
}
interface Change {sequence:number;record_id:string;batch_id:string|null;source_id:string|null;completion_sequence:number|null;ordinal:number|null;team:string|null;service:string|null;environment:string|null;event_time_ns:string|null;trace_id:string|null;span_id:string|null;payload:string|null;indexed_at:number|null;archived_at:number|null;late:number|null;out_of_order:number|null}
export async function reconcileSamplingProjection(env:Bindings,config:Configuration,role:Role,replicated:Coverage&{samplingWatermark?:number}) {
 const after=replicated.samplingWatermark??0
 // A missing retained row becomes a tombstone. References never copy payloads.
 const rows=(await env.DB.prepare(`SELECT c.sequence,c.record_id,b.id AS batch_id,b.source_id,b.completion_sequence,r.ordinal,r.team,r.service,r.environment,r.event_time_ns,r.trace_id,r.span_id,r.payload,r.indexed_at,a.archived_at,r.late,r.out_of_order
  FROM porthole_sampling_changes c
  LEFT JOIN porthole_ingest_batches b ON b.id=substr(c.record_id,1,length(rtrim(c.record_id,'0123456789'))-1)
  LEFT JOIN porthole_telemetry_records r ON r.id=c.record_id
  LEFT JOIN porthole_telemetry_archive a ON a.id=c.record_id
  WHERE c.sequence>? ORDER BY c.sequence LIMIT 200`).bind(after).all<Change>()).results
 const changes=[];let bytes=0
 for(const row of rows){
  if(row.batch_id!==null&&(row.completion_sequence===null||row.completion_sequence>replicated.watermark))break
  const ordinal=Number(row.record_id.slice(row.record_id.lastIndexOf(':')+1))
  if(!Number.isSafeInteger(ordinal)||ordinal<0)fail('analytics_sampling_reference_invalid',503)
  if(row.payload!==null&&row.archived_at===null)fail('analytics_source_coverage_incomplete',503)
  const change={sequence:row.sequence,batchId:row.batch_id??row.record_id.slice(0,row.record_id.lastIndexOf(':')),sourceId:row.source_id??undefined,ordinal,record:row.payload===null?null:{id:row.record_id,ordinal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.event_time_ns,traceId:row.trace_id,spanId:row.span_id,payload:JSON.parse(row.payload),indexedAt:row.indexed_at,archivedAt:row.archived_at,late:row.late,outOfOrder:row.out_of_order}}
  const size=new TextEncoder().encode(JSON.stringify(change)).byteLength
  if(bytes+size>1800*1024){if(!changes.length)fail('analytics_replication_batch_too_large',503);break}
  bytes+=size;changes.push(change)
 }
 const live=fence(config)
 if(!await env.DB.prepare(`SELECT 1 AS live WHERE ${live.sql}`).bind(...live.args).first())fail('analytics_connection_changed',409)
 if(!changes.length)return replicated
 return rpc<Coverage&{samplingWatermark:number}>(env,role,'/v1/sampling',{sourceIdentity:config.source_identity,changes})
}
