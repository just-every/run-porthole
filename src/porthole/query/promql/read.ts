import type {Bindings} from '../../../auth.server'
import {readTelemetry} from '../../ingest/read'
import {authority,allScope,emptyScope,fail} from '../../security/authority'
import {agentCredential,agentReadAuthority,type ReadPrincipal} from '../../security/agent-read'
import {verifyCredential} from '../../credentials/verify'
import {configuration,selected,fence as analyticalFence} from '../../analytical/client'
import {privateHeaders} from '../../document'
import {evaluate,type Row} from './evaluate'
import {type Plan,type Evaluation} from './plan'
import type {Parameters} from '../../explore/model'

// All local destructive telemetry doors write this portable tombstone ledger.
// Refuse the accumulated read if it changed while any page was in flight.
const erasureEpoch='(SELECT COUNT(*) FROM porthole_erased_batches)'
export async function evaluateTelemetry(request:Request,env:Bindings,parameters:Parameters,plan:Plan,settings:Evaluation,source:{dialect:string;text:string},descriptor:Record<string,unknown>,principal?:ReadPrincipal):Promise<Response> {
 const epoch=await env.DB.prepare(`SELECT ${erasureEpoch} AS n`).first<{n:number}>()
 const config=await configuration(env),configured=selected(env,config)
 const horizon=BigInt(Math.max(settings.lookbackSeconds,plan.windowSeconds)*1000)*1000000n
 const start=BigInt(settings.start),from=(start>horizon?start-horizon:0n).toString(),through=settings.end
 const rows:Row[]=[],seen=new Set<string>();let bytes=0,cursor:string|null=null,snapshot:unknown=parameters.snapshot,first:Record<string,unknown>|undefined,actor:string|undefined,revision:string|undefined
 do {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [key,value] of Object.entries({...parameters,from,through,limit:Math.min(200,settings.scanLimit-rows.length+1),...(snapshot===undefined?{}:{snapshot}),...(cursor?{cursor}:{})}))url.searchParams.set(key,String(value))
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{principal})
  if(!response.ok)return response
  const data=await response.json() as {snapshot:number;records:Row[];cursor:string|null;queryRef:string;analytical?:unknown}
  const current=response.headers.get('x-porthole-actor')!,currentRevision=response.headers.get('x-porthole-actor-revision')!
  if(actor!==undefined&&(actor!==current||revision!==currentRevision))fail('authority_changed',409)
  actor=current;revision=currentRevision
  if(!first)first=data as unknown as Record<string,unknown>
  snapshot??=data.snapshot
  if(data.snapshot!==Number(snapshot))fail('promql_snapshot_changed',409)
  for(const row of data.records){if(seen.has(row.id))fail('promql_invalid_page',503);seen.add(row.id);rows.push(row);bytes+=new TextEncoder().encode(JSON.stringify(row.payload)).length}
  if(rows.length>settings.scanLimit||bytes>8*1024*1024)fail('promql_scan_budget_exceeded',413)
  if(cursor&&cursor===data.cursor||data.cursor&&!data.records.length)fail('promql_invalid_page',503)
  cursor=data.cursor
 }while(cursor)
 const evaluation=evaluate(rows,plan,settings)
 // Inspect live authority again after computation. The descriptor insert and
 // both custody fences share one transaction before any result leaves here.
 let live:{sql:string;args:unknown[]}
 if(principal?.clientId||request.headers.has('authorization')) {
  const use={action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true}
  const verified=principal?.clientId?await agentCredential(request,env,principal,use):await verifyCredential(request,env,use)
  if(verified.credential.id!==actor||String(verified.credential.revision)!==revision)fail('authority_changed',409)
  live=verified.fence
 }else {
  const acting=principal?await agentReadAuthority(env,principal):await authority(request,env)
  if(acting.member.operatorId!==actor||String(acting.member.revision)!==revision)fail('authority_changed',409)
  live={sql:acting.fence,args:acting.args}
 }
 const analytical=configured?analyticalFence(config):{sql:'1',args:[]}
 const condition=`(${live.sql}) AND (${analytical.sql}) AND EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND enabled=? AND source_identity=?) AND ${erasureEpoch}=?`,args=[...live.args,...analytical.args,config.revision,config.enabled,config.source_identity,epoch!.n]
 const queryRef=crypto.randomUUID(),scope=JSON.stringify({...Object.fromEntries(Object.entries(parameters).filter(([key])=>['service','environment','team','metric'].includes(key))),...descriptor,dialect:source.dialect,expression:source.text})
 const results=await env.DB.batch([
  env.DB.prepare(`SELECT 1 AS live WHERE ${condition}`).bind(...args),
  env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,?,?,?,?,? WHERE ${condition}`).bind(queryRef,actor,scope,'metrics',from.padStart(20,'0'),through.padStart(20,'0'),snapshot,Date.now(),...args),
 ])
 if(!results[0].results.length)fail('promql_authority_or_custody_changed',409)
 return Response.json({snapshot,from,through,queryRef,records:[],cursor:null,archive:false,...(first?.analytical?{analytical:first.analytical}:{}),evaluation:{...evaluation,settings,plan},source,parameters:{...parameters,...descriptor},replay:'/api/porthole/v1/query/'+queryRef},{headers:{...privateHeaders,'x-porthole-entity':queryRef}})
}
