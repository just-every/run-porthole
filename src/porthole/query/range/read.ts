import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {allScope,authority,emptyScope,fail} from '../../security/authority'
import {agentReadAuthority,agentCredential,type ReadPrincipal} from '../../security/agent-read'
import {CredentialLimit,verifyCredential} from '../../credentials/verify'
import {readTelemetry} from '../../ingest/read'
import {configuration,selected,fence as analyticalFence} from '../../analytical/client'
import {privateHeaders} from '../../document'
import type {NormalizedExploration} from '../../explore/model'
import {reject} from '../../explore/model'
import {evaluateRange,type MetricRow} from './evaluate'

export async function readMetricRange(request:Request,env:Bindings,normalized:NormalizedExploration,principal?:ReadPrincipal) {
 const plan=normalized.range!,parameters:Record<string,string|number>={...normalized.parameters,groupBy:plan.groupBy.join(',')}
 const credential=(use:Parameters<typeof verifyCredential>[2])=>principal?.clientId?agentCredential(request,env,principal,use!):verifyCredential(request,env,use)
 const inspect=async()=>{
  if(principal?.clientId||request.headers.has('authorization')){
   const auth=await credential({action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
   if(!auth.credential.scope.signals.includes('metrics'))fail('credential_scope_forbidden')
   return {identity:[auth.credential.id,auth.credential.revision,auth.credential.scope],fence:auth.fence}
  }
  const actor=principal?await agentReadAuthority(env,principal):await authority(request,env)
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
  return {identity:[actor.member.operatorId,actor.member.revision,actor.member.scope],fence:{sql:actor.fence,args:actor.args}}
 }
 const actor=await inspect(),config=await configuration(env),analytical=selected(env,config)
 const start=BigInt(plan.start)-BigInt(plan.lookback)*1000000000n
 const from=(start<0n?0n:start).toString().padStart(20,'0'),through=plan.end
 let snapshot:unknown=parameters.snapshot,cursor:string|null=null,bytes=0
 const rows:MetricRow[]=[]
 do {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [key,value]of Object.entries({...Object.fromEntries(Object.entries(parameters).filter(([key])=>['signal','service','environment','team','metric'].includes(key))),from,through,limit:200,...(snapshot===undefined?{}:{snapshot}),...(cursor?{cursor}:{})}))url.searchParams.set(key,String(value))
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{principal,saveSnapshot:false})
  if(!response.ok){const error=await response.json() as {error:string};if(response.status===429)throw new CredentialLimit(Number(response.headers.get('retry-after')??1));throw new AuthError(error.error,response.status)}
  const page=await response.json() as {snapshot:number;cursor:string|null;records:MetricRow[];analytical?:unknown}
  if(!!page.analytical!==analytical)fail('authority_changed',409)
  snapshot=page.snapshot;cursor=page.cursor;rows.push(...page.records);bytes+=new TextEncoder().encode(JSON.stringify(page.records)).length
  if(rows.length>2000||bytes>2*1024*1024||cursor&&rows.length>=2000)reject('metric_range_limit','Narrow the range: at most 2000 input points and 2 MiB are evaluated.','start')
 }while(cursor)
 const range=evaluateRange(plan,rows),latest=await inspect()
 if(JSON.stringify(latest.identity)!==JSON.stringify(actor.identity))fail('authority_changed',409)
 const active=analytical?analyticalFence(config):{sql:'EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND changed_at=?)',args:[config.revision,config.changed_at]}
 // The same transaction fences both release and the sole saved snapshot. A
 // refused range never creates a page snapshot or overwrites a previous one.
 const queryRef=crypto.randomUUID(),custody:string[]=[],custodyArgs:unknown[]=[]
 for(let offset=0;offset<rows.length;offset+=200){
  custody.push(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(
   SELECT 1 FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id
   WHERE r.id=json_extract(j.value,'$.id') AND json(r.payload)=json(json_extract(j.value,'$.payload'))
   AND b.state='complete' AND b.completion_sequence<=? AND NOT EXISTS(SELECT 1 FROM porthole_erased_batches e WHERE e.id=b.id OR e.content_digest=b.digest)))`)
  custodyArgs.push(JSON.stringify(rows.slice(offset,offset+200).map(row=>({id:row.id,payload:JSON.stringify(row.payload)}))),snapshot)
 }
 const writes=(live:{sql:string;args:unknown[]})=>{
  const condition=[`(${live.sql})`,`(${active.sql})`,...custody].join(' AND '),args=[...live.args,...active.args,...custodyArgs]
  return [env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,?,?,?,?,? WHERE ${condition}`).bind(queryRef,String(actor.identity[0]),JSON.stringify(parameters),'metrics',from,through,snapshot,Date.now(),...args),env.DB.prepare('SELECT 1 AS live FROM porthole_query_snapshots WHERE id=?').bind(queryRef)]
 }
 let results:D1Result[]
 if(principal?.clientId||request.headers.has('authorization')){
  const auth=await credential({action:'telemetry.read',scope:emptyScope,dataScope:allScope,writes(live,scope){if(JSON.stringify(scope)!==JSON.stringify(actor.identity[2]))fail('authority_changed',409);return writes(live)}})
  results=auth.results
 }else results=await env.DB.batch(writes(latest.fence))
 if(!results[1].results.length)fail('metric_range_custody_changed',409)
 return Response.json({snapshot,from,through,queryRef,records:[],cursor:null,archive:false,range,...(analytical?{analytical:{role:config.active_role}}:{})},{headers:{...privateHeaders,'x-porthole-entity':queryRef,'x-porthole-actor':String(actor.identity[0]),'x-porthole-actor-revision':String(actor.identity[1])}})
}
