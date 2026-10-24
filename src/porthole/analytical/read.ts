import type {Bindings} from '../../auth.server'
import {verifyCredential} from '../credentials/verify'
import {allScope,emptyScope,fail,type Scope} from '../security/authority'
import {privateHeaders} from '../document'
import {fence,query,requireEnabled,type Configuration} from './client'
export async function readAnalytical(request:Request,env:Bindings,config:Configuration,context:{scope:Scope;actorRef:string;actorRevision:number;fence:{sql:string;args:unknown[]};snapshot:number;queryRef:string;queryScope:string;from:string;through:string;signal:string;limit:number;archive:boolean}) {
 const params=new URL(request.url).searchParams,{scope,snapshot,from,through,signal,limit,archive,queryRef}=context
 requireEnabled(config)
 const active=fence(config)
 let live=context.fence
 if(request.headers.has('authorization')){
  const inspected=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  if(!inspected.credential.scope.signals.includes(signal)||(['services','environments','teams'] as const).some(key=>JSON.stringify(inspected.credential.scope[key])!==JSON.stringify(scope[key])))fail('authority_changed',409)
  live=inspected.fence
 }
 if(!await env.DB.prepare(`SELECT 1 AS live WHERE (${live.sql}) AND (${active.sql})`).bind(...live.args,...active.args).first())fail('authority_changed',409)
 const data=await query(env,config,{signal,scope:{services:scope.services,environments:scope.environments,teams:scope.teams},from,through,snapshot,limit,archive,...Object.fromEntries([...params].filter(([key])=>['service','environment','team','cursor','trace','metric'].includes(key)))})
 if(data.sourceIdentity!==config.source_identity||!Array.isArray(data.records)||data.records.length>limit||data.snapshot!==snapshot||!Number.isSafeInteger(data.watermark)||data.watermark<snapshot)fail('analytics_invalid_response',503)
 for(const row of data.records){
  for(const [column,key]of [['service','services'],['environment','environments'],['team','teams']] as const)if(!scope[key].includes('*')&&!scope[key].includes(row[column])||params.has(column)&&params.get(column)!==row[column])fail('analytics_scope_violation',503)
  if(row.signal!==signal||typeof row.event_time_ns!=='string'||row.event_time_ns<from||row.event_time_ns>through||params.has('trace')&&row.trace_id!==params.get('trace'))fail('analytics_scope_violation',503)
  if(params.has('metric')) {
   const metric=row.payload.metric
   if(!metric||typeof metric!=='object'||Array.isArray(metric)||(metric as Record<string,unknown>).name!==params.get('metric'))fail('analytics_scope_violation',503)
  }
 }
 const selected=fence(config)
 const writes=(live:{sql:string;args:unknown[]})=>{
  const condition=`(${live.sql}) AND (${selected.sql})`,args=[...live.args,...selected.args]
  return [env.DB.prepare(`SELECT 1 AS live WHERE ${condition}`).bind(...args),env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,?,?,?,?,? WHERE ${condition}`).bind(queryRef,context.actorRef,context.queryScope,signal,from,through,snapshot,Date.now(),...args)]
 }
 let results:D1Result[]
 if(request.headers.has('authorization')){
  const scanned=data.records.reduce((sum,row)=>sum+new TextEncoder().encode(JSON.stringify(row.payload)).length,0)
  const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,scannedBytes:scanned,writes(live,latest){if(!latest.signals.includes(signal)||JSON.stringify(latest.services)!==JSON.stringify(scope.services)||JSON.stringify(latest.environments)!==JSON.stringify(scope.environments)||JSON.stringify(latest.teams)!==JSON.stringify(scope.teams))fail('authority_changed',409);return writes(live)}})
  results=auth.results
 }else results=await env.DB.batch(writes(context.fence))
 if(!results[0].results.length)fail('authority_changed',409)
 return Response.json({snapshot,from,through,queryRef,records:data.records,cursor:data.cursor,archive,analytical:{role:config.active_role,watermark:data.watermark,requiredWatermark:data.requiredWatermark}}, {headers:{...privateHeaders,'x-porthole-entity':queryRef,'x-porthole-actor':context.actorRef,'x-porthole-actor-revision':String(context.actorRevision)}})
}
