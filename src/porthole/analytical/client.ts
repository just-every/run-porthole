import {AuthError} from '../../modules/operator-auth/index.mjs'
import type {Bindings} from '../../auth.server'
import type {Scope} from '../security/authority'
import {fail} from '../security/authority'
export const roles=['primary','standby'] as const
export type Role=typeof roles[number]
export interface Configuration {source_identity:string;enabled:number;active_role:Role;revision:number;changed_at:number;configured_by:string|null;configurer_revision:number;configurer_version:number;live:number}
export interface Coverage {requiredWatermark?:number;sourceIdentity:string|null;watermark:number;highestSequence:number;lastAcceptedAt:number|null;lastQueryableAt:number|null;recordCount:number;batchCount:number;stopped?:boolean}
export interface AnalyticalRecord {id:string;batch_id:string;source_id:string;signal:string;team:string;service:string;environment:string;event_time_ns:string;trace_id:string|null;span_id:string|null;payload:Record<string,unknown>;indexed_at:number;late:number;out_of_order:number}
export interface Query extends Record<string,unknown> {signal:string;from:string;through:string;scope:Scope;snapshot?:number;limit?:number;mode?:'records'|'count';trace?:string;uncertain?:boolean}
export async function configuration(env:Bindings):Promise<Configuration> {
 const row=await env.DB.prepare(`SELECT c.*,EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=c.configured_by AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=c.configurer_revision AND o.version=c.configurer_version) AS live FROM porthole_analytical_configuration c WHERE singleton=1`).first<Configuration>()
 if(!row)fail('analytics_configuration_unavailable',503)
 return row
}
export function selected(env:Bindings,config:Configuration) {return !!(config.changed_at||env.ANALYTICS_PRIMARY||env.ANALYTICS_STANDBY||env.ANALYTICS_PRIMARY_URL||env.ANALYTICS_STANDBY_URL||env.ANALYTICS_PRIMARY_TOKEN||env.ANALYTICS_STANDBY_TOKEN)}
export async function watermark(env:Bindings):Promise<number> {return (await env.DB.prepare("SELECT COALESCE(MAX(completion_sequence),0) AS n FROM porthole_ingest_batches WHERE state='complete'").first<{n:number}>())!.n}
export function fence(config:Configuration) {
 return {sql:`EXISTS(SELECT 1 FROM porthole_analytical_configuration c JOIN porthole_members m ON m.operator_id=c.configured_by JOIN oa_operators o ON o.id=m.operator_id WHERE c.singleton=1 AND c.revision=? AND c.source_identity=? AND c.active_role=? AND c.enabled=1 AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=c.configurer_revision AND o.version=c.configurer_version)`,args:[config.revision,config.source_identity,config.active_role] as unknown[]}
}
export function requireEnabled(config:Configuration) {if(!config.enabled||!config.live)fail('analytics_explicit_owner_connection_required',503)}
export function ready(env:Bindings,role:Role) {return !!(role==='primary'?(env.ANALYTICS_PRIMARY||env.ANALYTICS_PRIMARY_URL)&&env.ANALYTICS_PRIMARY_TOKEN:(env.ANALYTICS_STANDBY||env.ANALYTICS_STANDBY_URL)&&env.ANALYTICS_STANDBY_TOKEN)}
export async function rpc<T>(env:Bindings,role:Role,path:string,input?:unknown):Promise<T> {
 const binding=role==='primary'?env.ANALYTICS_PRIMARY:env.ANALYTICS_STANDBY,endpoint=role==='primary'?env.ANALYTICS_PRIMARY_URL:env.ANALYTICS_STANDBY_URL,token=role==='primary'?env.ANALYTICS_PRIMARY_TOKEN:env.ANALYTICS_STANDBY_TOKEN
 if(!token||!binding&&!endpoint)fail('analytics_binding_missing',503)
 let base='https://porthole-analytics.internal'
 if(!binding){
  let url:URL;try{url=new URL(endpoint!)}catch{fail('analytics_binding_invalid',503)}
  if(url!.protocol!=='https:'||url!.username||url!.password||url!.search||url!.hash||url!.pathname!=='/')fail('analytics_https_origin_required',503)
  base=url!.origin
 }
 const request=new Request(base+path,{method:input===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(input===undefined?{}:{'content-type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)}),redirect:'error',signal:AbortSignal.timeout(3000)})
 let response:Response
 try{response=binding?await binding.fetch(request):await fetch(request)}catch{fail('analytics_unreachable',503)}
 const reader=response!.body?.getReader();if(!reader)fail('analytics_invalid_response',503)
 const chunks:Uint8Array[]=[];let size=0
 for(;;){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader!.cancel();fail('analytics_response_too_large',503)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let data:Record<string,unknown>;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail('analytics_invalid_response',503)}
 if(!response!.ok){const code=['analytics_incomplete_coverage','analytics_source_mismatch','analytics_identity_conflict'].includes(String(data!.error))?String(data!.error):'analytics_unavailable';fail(code,response!.status===409?409:503)}
 return data! as T
}
export async function coverage(env:Bindings,config:Configuration,role=config.active_role,required?:number) {
 requireEnabled(config)
 return rpc<Coverage>(env,role,'/v1/coverage',{sourceIdentity:config.source_identity,requiredWatermark:required??await watermark(env)})
}
export async function query(env:Bindings,config:Configuration,input:Query) {
 requireEnabled(config)
 const required=await watermark(env)
 return rpc<Coverage&{records:AnalyticalRecord[];count:number;cursor:string|null;snapshot:number}>(env,config.active_role,'/v1/query',{sourceIdentity:config.source_identity,requiredWatermark:required,...input})
}
export async function reconcile(env:Bindings) {
 const config=await configuration(env)
 if(!selected(env,config))return {enabled:false,complete:true,roles:[]}
 if(!config.enabled||!config.live)return {enabled:false,complete:false,roles:[]}
 const outcomes=[]
 for(const role of roles)try{
  const state=await rpc<Coverage>(env,role,'/v1/health')
  if(state.sourceIdentity&&state.sourceIdentity!==config.source_identity)fail('analytics_source_mismatch',409)
  const batches=(await env.DB.prepare("SELECT id,completion_sequence,source_id,signal,digest,accepted_at,completed_at FROM porthole_ingest_batches WHERE state='complete' AND completion_sequence>? ORDER BY completion_sequence LIMIT 20").bind(state.watermark).all<{id:string;completion_sequence:number;source_id:string;signal:string;digest:string;accepted_at:number;completed_at:number}>()).results
  const packets=[];let bytes=0
  for(const batch of batches){
   const records=(await env.DB.prepare('SELECT * FROM porthole_telemetry_records WHERE batch_id=? ORDER BY ordinal').bind(batch.id).all<AnalyticalRecord&{ordinal:number;payload:string}>()).results
   const packet={id:batch.id,completionSequence:batch.completion_sequence,sourceId:batch.source_id,signal:batch.signal,digest:batch.digest,acceptedAt:batch.accepted_at,completedAt:batch.completed_at,records:records.map(row=>({id:row.id,ordinal:row.ordinal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.event_time_ns,traceId:row.trace_id,spanId:row.span_id,payload:JSON.parse(row.payload),indexedAt:row.indexed_at,late:row.late,outOfOrder:row.out_of_order}))}
   const length=new TextEncoder().encode(JSON.stringify(packet)).length
   if(bytes+length>1800*1024){if(!packets.length)fail('analytics_replication_batch_too_large',503);break}
   packets.push(packet);bytes+=length
  }
  const live=fence(config)
  if(!await env.DB.prepare(`SELECT 1 AS live WHERE ${live.sql}`).bind(...live.args).first())fail('analytics_connection_changed',409)
  // Even an empty replication pins a newly selected worker to this source.
  const replicated=await rpc<Coverage>(env,role,'/v1/replicate',{sourceIdentity:config.source_identity,batches:packets})
  outcomes.push({role,watermark:replicated.watermark,requiredWatermark:await watermark(env),batches:packets.length,status:'reachable'})
 }catch(error){outcomes.push({role,error:error instanceof AuthError?error.code:'analytics_unavailable',status:'unavailable',watermark:null,requiredWatermark:await watermark(env),batches:0})}
 const required=await watermark(env)
 return {enabled:true,complete:outcomes.every(row=>row.watermark!==null&&row.watermark>=required),roles:outcomes.map(row=>({...row,requiredWatermark:required}))}
}
