import {handoffs} from '../handoffs/store'
import {links} from '../handoffs/model'
import type {Bindings} from '../../auth.server'
import {readTelemetry,scopeWhere} from '../ingest/read'
import {canonical,nano,sha256} from '../ingest/model'
import {authority,fail,scopeWithin,type Authority,type Scope} from '../security/authority'
import type {TraceRecord} from '../traces/graph'
import {catalog,type Metadata} from './model'

export const serviceId=async(row:{service:string;environment:string;team:string})=>(await sha256(new TextEncoder().encode(canonical([row.service,row.environment,row.team])))).slice(0,32)
export async function serviceRead(request:Request,env:Bindings,actor:Authority,now=Date.now()) {
 const url=new URL(request.url),params=url.searchParams
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
 const handoffRows=await handoffs(env,actor)
 const latest=await authority(request,env)
 if(latest.session.id!==actor.session.id||latest.member.revision!==actor.member.revision)fail('authority_changed',409)
 const where=scopeWhere(actor.member.scope,'v')
 // Source membership, erasure and session fences are repeated after the last
 // asynchronous page. No detached aggregate survives a removed input.
 const result=await env.DB.batch([
  env.DB.prepare(`SELECT COUNT(*) AS n FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?)) AND ${actor.fence}`).bind(JSON.stringify(ids),...actor.args),
  env.DB.prepare(`SELECT v.* FROM porthole_service_versions v WHERE ${where.sql} AND ${actor.fence} ORDER BY revision DESC,id LIMIT 2001`).bind(...where.args,...actor.args),
  env.DB.prepare(`SELECT 1 AS live WHERE ${actor.fence}`).bind(...actor.args),
  env.DB.prepare(`SELECT o.id,o.name,o.scope,o.revision,s.status,s.evaluated_at,s.firing_episode,
   e.id AS firing_evaluation_id,e.evaluated_at AS first_firing_at
   FROM porthole_objects o JOIN porthole_monitor_state s ON s.object_id=o.id AND s.revision=o.revision
   JOIN porthole_monitor_evaluations e ON e.id=(SELECT id FROM porthole_monitor_evaluations first
    WHERE first.object_id=o.id AND first.revision=o.revision AND first.firing_episode=s.firing_episode AND first.status='Firing' ORDER BY evaluated_at,id LIMIT 1)
   WHERE o.kind='monitor' AND o.state='active' AND s.firing_episode IS NOT NULL AND ${actor.fence}
   ORDER BY o.id LIMIT 201`).bind(...actor.args),
 ])
 if(!result[2].results.length)fail('authority_changed',409)
 if(Number((result[0].results[0] as {n:number}|undefined)?.n)!==ids.length)fail('service_evidence_changed',409)
 const view=catalog(rows,from,through,!!cursor,now),metadata=(result[1].results as unknown as Metadata[]).slice(0,2000)
 if(result[1].results.length>2000){view.coverage.scanComplete=false;view.coverage.missing.push('metadata revision budget reached')}
 const latestMetadata=new Map<string,Metadata>();for(const row of metadata)if(!latestMetadata.has(row.id))latestMetadata.set(row.id,row)
 const services=await Promise.all(view.services.map(async s=>({...s,id:await serviceId(s)})))
 for(const row of latestMetadata.values())if(!services.some(s=>s.id===row.id))services.push({id:row.id,key:canonical([row.service,row.environment,row.team]),service:row.service,environment:row.environment,team:row.team,versions:[],spanCount:0,lastSeenNs:'0',freshness:'no-retained-evidence',associations:[],summary:{requests:0,errors:0,requestsPerSecond:0,p50Ns:null,p95Ns:null,p99Ns:null},endpoints:[]})
 interface Alert {id:string;name:string;scope:string;revision:number;status:string;evaluated_at:number;firing_episode:string;firing_evaluation_id:string;first_firing_at:number}
 const alerts=(result[3].results as unknown as Alert[]).slice(0,200).filter(row=>scopeWithin(JSON.parse(row.scope) as Scope,actor.member.scope))
 if(result[3].results.length>200){view.coverage.scanComplete=false;view.coverage.missing.push('firing monitor context budget reached')}
 const refs=[...new Set(metadata.flatMap(m=>[m.owner_ref,m.author_ref]).filter((s):s is string=>!!s))]
 const visibleNames=(await env.DB.prepare(`SELECT id,display_name FROM oa_operators WHERE id IN (SELECT value FROM json_each(?)) AND status='active' AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=oa_operators.id) AND ${actor.fence}`).bind(JSON.stringify(refs),...actor.args).all<{id:string;display_name:string}>()).results
 const names:Record<string,string>=Object.fromEntries(refs.map(ref=>[ref,visibleNames.find(row=>row.id===ref)?.display_name??'Unavailable member']))
 // Resolve presentation names before the final live fence as well.
 const release=await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?))) AS n WHERE ${actor.fence}`).bind(JSON.stringify(ids),...actor.args).first<{n:number}>()
 if(!release)fail('authority_changed',409)
 if(release.n!==ids.length)fail('service_evidence_changed',409)
 const keyToId=new Map(services.map(s=>[s.key,s.id]))
 return {...view,services:services.map(s=>({...s,handoffs:links(handoffRows,{service:s.service,environment:s.environment,from,through}),metadata:latestMetadata.get(s.id)??null,history:metadata.filter(m=>m.id===s.id),alerts:alerts.filter(row=>scopeWithin({services:[s.service],environments:[s.environment],teams:[s.team]},JSON.parse(row.scope))).map(row=>({monitorId:row.id,name:row.name,revision:row.revision,status:row.status,evaluatedAt:row.evaluated_at,firingEpisode:row.firing_episode,firingEvaluationId:row.firing_evaluation_id,firstFiringAt:row.first_firing_at,metadataAtFirstFiring:metadata.find(m=>m.id===s.id&&m.created_at<=row.first_firing_at)??null,currentMetadata:latestMetadata.get(s.id)??null,delivery:'not-requested'}))})),edges:view.edges.map(e=>({...e,from:keyToId.get(e.from)!,to:e.to?keyToId.get(e.to)??null:null})),names,snapshot,from,through,budget,backend,checkedAt:now}
}
export type ServiceView=Awaited<ReturnType<typeof serviceRead>>
