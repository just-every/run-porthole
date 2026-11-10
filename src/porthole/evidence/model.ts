import type {Bindings} from '../../auth.server'
import {canonical,nano,sha256} from '../ingest/model'
import {readTelemetry} from '../ingest/read'
import {serviceRead} from '../services/read'
import {fail,type Authority,scopeWithin} from '../security/authority'
export const fields=['identity','metadata','observedRed','coverage','freshness','traceReferences','logReferences'] as const
export const packetColumns=['id','owner_ref','owner_revision','selection','snapshot','captured_at','digest','state','approved_at']
export interface Selection {serviceId:string;from:string;through:string;metadataRevision:number;externalReference:string;fields:string[]}
export interface PacketJob {id:string;owner_ref:string;owner_revision:number;selection:string;snapshot:number;captured_at:number;digest:string;state:string;approved_at:number|null}
export function selection(data:Record<string,unknown>):Selection {
 if(Object.keys(data).some(k=>!['serviceId','from','through','metadataRevision','externalReference','fields'].includes(k)))fail('invalid_evidence_selection',400)
 const from=nano(data.from),through=nano(data.through)
 if(from>=through||typeof data.serviceId!=='string'||!/^[a-f0-9]{32}$/.test(data.serviceId)||!Number.isSafeInteger(data.metadataRevision)||Number(data.metadataRevision)<0)fail('invalid_evidence_selection',400)
 if(typeof data.externalReference!=='string'||!/^[-A-Za-z0-9 ._:]{1,120}$/.test(data.externalReference)||!data.externalReference.trim())fail('invalid_external_reference',400)
 if(!Array.isArray(data.fields)||!data.fields.length||new Set(data.fields).size!==data.fields.length||data.fields.some(v=>!fields.includes(v)))fail('evidence_field_forbidden',400)
 return {serviceId:data.serviceId,from,through,metadataRevision:Number(data.metadataRevision),externalReference:data.externalReference,fields:[...data.fields].sort()}
}
export function validatePacket(row:Record<string,unknown>) {
 if(typeof row.id!=='string'||!/^[a-f0-9-]{36}$/.test(row.id)||typeof row.owner_ref!=='string'||!/^[a-f0-9-]{36}$/.test(row.owner_ref)||!Number.isSafeInteger(row.owner_revision)||Number(row.owner_revision)<1||!Number.isSafeInteger(row.snapshot)||Number(row.snapshot)<0||!Number.isSafeInteger(row.captured_at)||Number(row.captured_at)<0||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||!['preview','approved','cancelled','quarantined'].includes(String(row.state))||row.approved_at!==null&&(!Number.isSafeInteger(row.approved_at)||Number(row.approved_at)<0))fail('invalid_evidence_history',422)
 let value;try{value=JSON.parse(String(row.selection))}catch{return fail('invalid_evidence_history',422)}
 selection(value)
}
export async function packet(request:Request,env:Bindings,actor:Authority,value:Selection,snapshot?:number,capturedAt=Date.now()) {
 const url=new URL('/api/porthole/v1/services',request.url)
 url.search=new URLSearchParams({from:value.from,through:value.through,...(snapshot===undefined?{}:{snapshot:String(snapshot)})}).toString()
 const view=await serviceRead(new Request(url,{headers:request.headers}),env,actor,capturedAt),service=view.services.find(s=>s.id===value.serviceId)
 if(!service)fail('service_not_found',404)
 if((service.metadata?.revision??0)!==value.metadataRevision)fail('evidence_metadata_changed',409)
 if(!scopeWithin({services:[service.service],environments:[service.environment],teams:[service.team]},actor.member.scope))fail('scope_forbidden')
 const ids:string[]=[],references:{traces:Record<string,string>[];logs:Record<string,string>[]}={traces:[],logs:[]},missing=[...view.coverage.missing]
 // Resolve references with exactly the same current scoped reader as Explore.
 // Raw attributes, bodies, credentials, names and partner results never enter a packet.
 for(const signal of ['traces','logs'] as const){
  const target=new URL('/api/porthole/v1/ingest/records',url)
  target.search=new URLSearchParams({signal,service:service.service,environment:service.environment,team:service.team,from:view.from,through:view.through,snapshot:String(view.snapshot),limit:'200'}).toString()
  let cursor:string|null=null
  do{
   if(cursor)target.searchParams.set('cursor',cursor)
   const response=await readTelemetry(new Request(target,{headers:request.headers}),env,{saveSnapshot:false})
   if(!response.ok){const body=await response.json() as {error:string};fail(body.error,response.status)}
   const page=await response.json() as {records:{id:string;event_time_ns:string;trace_id:string;span_id:string}[];cursor:string|null}
   for(const r of page.records){ids.push(r.id);references[signal].push({recordId:r.id,timeNs:r.event_time_ns,...(r.trace_id?{traceId:r.trace_id}:{}),...(r.span_id?{spanId:r.span_id}:{})})}
   cursor=page.cursor
  }while(cursor&&references[signal].length<2000)
  if(cursor)missing.push(signal+' reference scan is partial at the 2000 record budget')
  if(!references[signal].length)missing.push('No retained '+signal+' evidence in this service window')
 }
 const m=service.metadata
 const allowlisted={identity:{id:service.id,service:service.service,environment:service.environment,team:service.team,versions:service.versions},
  metadata:m?{revision:m.revision,ownerRef:m.owner_ref,criticality:m.criticality,repository:m.repository,runbook:m.runbook,reviewedAt:m.created_at,state:m.state}:null,
  observedRed:{...service.summary,endpoints:service.endpoints,population:'observed-retained-spans',fullTraffic:false},
  coverage:{...view.coverage,missing,telemetryCost:'unavailable: usage and approved rate-card evidence not supplied',partnerRecovery:'not-measured'},
  freshness:{asOf:capturedAt,lastSeenNs:service.lastSeenNs,status:service.freshness},traceReferences:references.traces,logReferences:references.logs}
 const body={format:'porthole.service-evidence.v1',externalReference:value.externalReference,selection:value,snapshot:view.snapshot,capturedAt,
  fields:Object.fromEntries(value.fields.map(key=>[key,allowlisted[key as keyof typeof allowlisted]])),
  boundary:'Owner-approved download only. No outbound delivery, partner result, compliance certification, whole-cloud spend or full-traffic recovery claim.'}
 const digest=await sha256(new TextEncoder().encode(canonical(body)))
 await release(env,actor,ids)
 return {body,digest,snapshot:view.snapshot,capturedAt,ids}
}
export async function release(env:Bindings,actor:Authority,ids:string[]) {
 const row=await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?))) AS n,(SELECT COUNT(*) FROM porthole_export_exclusions WHERE record_id IN (SELECT value FROM json_each(?))) AS excluded WHERE ${actor.fence}`).bind(JSON.stringify(ids),JSON.stringify(ids),...actor.args).first<{n:number;excluded:number}>()
 if(!row)fail('authority_changed',409)
 if(row.n!==ids.length)fail('evidence_changed',409)
 if(row.excluded)fail('evidence_excluded',409)
}
