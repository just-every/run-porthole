import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {allScope,authority,emptyScope,fail} from '../../security/authority'
import {CredentialLimit,verifyCredential} from '../../credentials/verify'
import {readTelemetry} from '../../ingest/read'
import {configuration,selected,fence as analyticalFence} from '../../analytical/client'
import {normalizeExploration} from '../../explore/normalize'

type Row={id:string;batch_id:string;service:string;environment:string;team:string;payload:Record<string,unknown>;[key:string]:unknown}
const encode=(value:unknown)=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function pattern(row:Row) {
 const record=row.payload.record as {body?:{stringValue?:unknown};severityText?:string;severityNumber?:number}
 const body=record?.body?.stringValue
 // Version 1 preserves literal words, whitespace, scope and severity. Only
 // decimal tokens, UUIDs and long hexadecimal tokens are generalized.
 const template=typeof body==='string'?body.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'<uuid>').replace(/\b[0-9a-f]{8,}\b/gi,'<id>').replace(/\b\d+\b/g,'<n>'):JSON.stringify(record?.body??null)
 return {service:row.service,environment:row.environment,team:row.team,severity:record?.severityText??String(record?.severityNumber??''),template}
}
export async function clusters(request:Request,env:Bindings,data:Record<string,unknown>) {
 const extra=['scanLimit','cluster','cursor','limit'],native=Object.fromEntries(Object.entries(data).filter(([key])=>!extra.includes(key)))
 if(native.signal!==undefined&&native.signal!=='logs')fail('invalid_log_search_signal',400)
 const normalized=normalizeExploration({...native,signal:'logs'})
 if(Object.keys(normalized.parameters).some(key=>!['signal','service','environment','team','from','through','snapshot'].includes(key))||normalized.aggregate)fail('invalid_cluster_query',400)
 const number=(key:string,fallback:number,max:number)=>{const n=Number(data[key]??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)fail('invalid_cluster_'+key,400);return n}
 const limit=number('limit',50,200),scanLimit=number('scanLimit',10000,10000)
 const cluster=data.cluster===undefined||data.cluster===''?null:data.cluster
 if(cluster!==null&&(typeof cluster!=='string'||!/^[a-f0-9]{64}$/.test(cluster)))fail('invalid_cluster',400)
 const inspect=async()=>{
  if(request.headers.has('authorization')){
   const a=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
   if(!a.credential.scope.signals.includes('logs'))fail('credential_scope_forbidden')
   return {identity:[a.credential.id,a.credential.revision,a.credential.scope],fence:a.fence}
  }
  const a=await authority(request,env)
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(a.member.role))fail('telemetry_forbidden')
  return {identity:[a.member.operatorId,a.member.revision,a.member.scope],fence:{sql:a.fence,args:a.args}}
 }
 const actor=await inspect(),config=await configuration(env),analytical=selected(env,config)
 let snapshot:unknown=normalized.parameters.snapshot,cursor:string|null=null,bytes=0
 const rows:Row[]=[]
 do {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [key,value]of Object.entries({...normalized.parameters,...(snapshot===undefined?{}:{snapshot}),limit:Math.min(200,scanLimit-rows.length),...(cursor?{cursor}:{})}))url.searchParams.set(key,String(value))
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{logSearch:normalized.logSearch,source:normalized.source})
  if(!response.ok){const error=await response.json() as {error:string};if(response.status===429)throw new CredentialLimit(Number(response.headers.get('retry-after')??1));throw new AuthError(error.error,response.status)}
  const page=await response.json() as {snapshot:number;cursor:string|null;records:Row[]}
  snapshot=page.snapshot;cursor=page.cursor;rows.push(...page.records)
  bytes+=new TextEncoder().encode(JSON.stringify(page.records)).length
  if(cursor&&(rows.length>=scanLimit||bytes>8*1024*1024))break
 }while(cursor)
 // No accumulated data leaves the request until both authority and retained
 // custody are rechecked. These reads share one D1 transaction, including the
 // selected analytical connection fence. No cluster or raw-content cache exists.
 const release=async<T>(result:T)=>{
  const latest=await inspect()
  if(JSON.stringify(latest.identity)!==JSON.stringify(actor.identity))fail('authority_changed',409)
  const active=analytical?analyticalFence(config):{sql:'EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND changed_at=?)',args:[config.revision,config.changed_at]}
  const condition=`(${latest.fence.sql}) AND (${active.sql})`,args=[...latest.fence.args,...active.args]
  const checks=[env.DB.prepare(`SELECT 1 AS live WHERE ${condition}`).bind(...args)]
  for(let start=0;start<rows.length;start+=200){
   const chunk=rows.slice(start,start+200)
   checks.push(env.DB.prepare(`SELECT COUNT(*) AS live FROM json_each(?) j JOIN porthole_telemetry_records r ON r.id=json_extract(j.value,'$.id') JOIN porthole_ingest_batches b ON b.id=r.batch_id
    WHERE ${condition} AND b.state='complete' AND b.completion_sequence<=? AND json(r.payload)=json(json_extract(j.value,'$.payload'))
    AND NOT EXISTS(SELECT 1 FROM porthole_erased_batches e WHERE e.id=b.id OR e.content_digest=b.digest)`)
    .bind(JSON.stringify(chunk.map(row=>({id:row.id,payload:JSON.stringify(row.payload)}))),...args,snapshot))
  }
  const verified=await env.DB.batch<{live:number}>(checks)
  if(!verified[0].results.length)fail('authority_changed',409)
  if(verified.slice(1).some((result,index)=>result.results[0]?.live!==Math.min(200,rows.length-index*200)))fail('cluster_custody_changed',409)
  return {...result,actorRef:String(latest.identity[0]),actorRevision:Number(latest.identity[1])}
 }
 const parameters={...normalized.parameters,snapshot,dialect:normalized.source.dialect,expression:normalized.source.text}
 const base={version:1,snapshot,parameters,scanned:rows.length,scanLimit,limit}
 if(cursor||bytes>8*1024*1024)return release({...base,state:'partial' as const,reason:cursor&&rows.length>=scanLimit?'scan_limit':'byte_limit',totalRecords:null,totalClusters:null,clusters:[],records:[],cursor:null,cluster:null})
 const grouped=new Map<string,{id:string;pattern:ReturnType<typeof pattern>;rows:Row[]}>()
 for(const row of rows){const shape=pattern(row),key=JSON.stringify(shape);let group=grouped.get(key);if(!group){group={id:await digest(shape),pattern:shape,rows:[]};grouped.set(key,group)}group.rows.push(row)}
 const groups=[...grouped.values()].sort((a,b)=>a.id.localeCompare(b.id))
 const binding=await digest([actor.identity,parameters,cluster,limit,scanLimit,rows.map(row=>[row.id,row.payload])])
 let offset=0
 if(data.cursor!==undefined&&data.cursor!==''){
  try{const decoded=JSON.parse(atob(String(data.cursor).replaceAll('-','+').replaceAll('_','/')));if(!Array.isArray(decoded)||decoded.length!==2||decoded[0]!==binding||!Number.isSafeInteger(decoded[1])||decoded[1]<1)fail('invalid_cluster_cursor',400);offset=decoded[1]}catch{fail('invalid_cluster_cursor',400)}
 }
 const members=cluster?groups.find(group=>group.id===cluster):null
 if(cluster&&!members)fail('cluster_not_found',404)
 const collection=members?members.rows:groups
 if(offset>collection.length)fail('invalid_cluster_cursor',400)
 const next=offset+limit<collection.length?encode([binding,offset+limit]):null
 return release({...base,state:'complete' as const,totalRecords:rows.length,totalClusters:groups.length,cluster:members?{id:members.id,pattern:members.pattern,count:members.rows.length}:null,
  clusters:members?[]:groups.slice(offset,offset+limit).map(group=>({id:group.id,pattern:group.pattern,count:group.rows.length})),
  records:members?members.rows.slice(offset,offset+limit).map(row=>({...row,pivot:'/app/explore?'+new URLSearchParams({...Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,String(value)])),record:row.id,dialect:'visual',expression:''})})):[],cursor:next})
}
