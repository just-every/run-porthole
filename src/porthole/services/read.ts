import type {Bindings} from '../../auth.server'
import {readTelemetry,scopeWhere} from '../ingest/read'
import {canonical,nano,sha256} from '../ingest/model'
import {authority,fail,type Authority} from '../security/authority'
import type {TraceRecord} from '../traces/graph'
import {catalog,type Metadata} from './model'

export const serviceId=async(row:{service:string;environment:string;team:string})=>(await sha256(new TextEncoder().encode(canonical([row.service,row.environment,row.team])))).slice(0,32)
export async function serviceRead(request:Request,env:Bindings,actor:Authority) {
 const url=new URL(request.url),params=url.searchParams,now=Date.now()
 const keys=['from','through','snapshot','budget']
 if([...params.keys()].some(k=>!keys.includes(k)||params.getAll(k).length!==1))fail('invalid_service_query',400)
 const from=nano(params.get('from')??String(BigInt(now-86400000)*1000000n)),through=nano(params.get('through')??String(BigInt(now)*1000000n))
 if(from>=through)fail('invalid_service_range',400)
 const budget=Number(params.get('budget')??2000)
 if(!Number.isInteger(budget)||budget<200||budget>2000||budget%200)fail('invalid_service_budget',400)
 const target=new URL('/api/porthole/v1/ingest/records',url)
 target.search=new URLSearchParams({signal:'traces',from,through,limit:'200'}).toString()
 if(params.has('snapshot'))target.searchParams.set('snapshot',params.get('snapshot')!)
 const rows:TraceRecord[]=[],ids:string[]=[]
 let snapshot=0,cursor:string|null=null,backend:unknown='local'
 do {
  if(cursor)target.searchParams.set('cursor',cursor)
  const response=await readTelemetry(new Request(target,{headers:request.headers}),env)
  if(!response.ok){const body=await response.json() as {error:string};fail(body.error,response.status)}
  const data=await response.json() as {records:TraceRecord[];snapshot:number;cursor:string|null;analytical?:unknown}
  snapshot=data.snapshot;target.searchParams.set('snapshot',String(snapshot));cursor=data.cursor;backend=data.analytical??'local'
  rows.push(...data.records);ids.push(...data.records.map(r=>r.id))
 }while(cursor&&rows.length<budget)
 const latest=await authority(request,env)
 if(latest.session.id!==actor.session.id||latest.member.revision!==actor.member.revision)fail('authority_changed',409)
 const where=scopeWhere(actor.member.scope,'v')
 // Source membership, erasure and session fences are repeated after the last
 // asynchronous page. No detached aggregate survives a removed input.
 const result=await env.DB.batch([
  env.DB.prepare(`SELECT COUNT(*) AS n FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?)) AND ${actor.fence}`).bind(JSON.stringify(ids),...actor.args),
  env.DB.prepare(`SELECT v.* FROM porthole_service_versions v WHERE ${where.sql} AND ${actor.fence} ORDER BY id,revision DESC`).bind(...where.args,...actor.args),
  env.DB.prepare(`SELECT 1 AS live WHERE ${actor.fence}`).bind(...actor.args),
 ])
 if(!result[2].results.length)fail('authority_changed',409)
 if(Number((result[0].results[0] as {n:number}|undefined)?.n)!==ids.length)fail('service_evidence_changed',409)
 const view=catalog(rows,from,through,!!cursor,now),metadata=result[1].results as unknown as Metadata[]
 const latestMetadata=new Map<string,Metadata>();for(const row of metadata)if(!latestMetadata.has(row.id))latestMetadata.set(row.id,row)
 const services=await Promise.all(view.services.map(async s=>({...s,id:await serviceId(s)})))
 for(const row of latestMetadata.values())if(!services.some(s=>s.id===row.id))services.push({id:row.id,key:canonical([row.service,row.environment,row.team]),service:row.service,environment:row.environment,team:row.team,versions:[],spanCount:0,lastSeenNs:'0',freshness:'no-retained-evidence',summary:{requests:0,errors:0,requestsPerSecond:0,p50Ns:null,p95Ns:null,p99Ns:null},endpoints:[]})
 const names:Record<string,string>={}
 for(const ref of new Set(metadata.flatMap(m=>[m.owner_ref,m.author_ref]).filter((s):s is string=>!!s))){
  const row=await env.DB.prepare(`SELECT display_name FROM oa_operators WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=?) AND ${actor.fence}`).bind(ref,ref,...actor.args).first<{display_name:string}>()
  names[ref]=row?.display_name??'Unavailable member'
 }
 // Resolve presentation names before the final live fence as well.
 const release=await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?))) AS n WHERE ${actor.fence}`).bind(JSON.stringify(ids),...actor.args).first<{n:number}>()
 if(!release)fail('authority_changed',409)
 if(release.n!==ids.length)fail('service_evidence_changed',409)
 const keyToId=new Map(services.map(s=>[s.key,s.id]))
 return {...view,services:services.map(s=>({...s,metadata:latestMetadata.get(s.id)??null,history:metadata.filter(m=>m.id===s.id)})),edges:view.edges.map(e=>({...e,from:keyToId.get(e.from)!,to:e.to?keyToId.get(e.to)??null:null})),names,snapshot,from,through,backend,checkedAt:now}
}
export type ServiceView=Awaited<ReturnType<typeof serviceRead>>
