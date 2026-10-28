import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../document'
import { canonical, IntakeError, nano, sha256, type TelemetryRecord } from '../ingest/model'
import { authority, fail, proofFence, scopeWithin } from '../security/authority'
import { input } from '../security/input'
import { definition, pipelineScope } from './model'
import { current, processed, type Version } from './intake'
import { sanitize } from './redact'
import { page } from './page'
import { nativeCatalog } from './catalog'

const root='/api/porthole/v1/pipelines',screen='/app/settings/pipelines'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
function decoded(value:unknown) {if(typeof value!=='string')return value;try{return JSON.parse(value)}catch{return fail('invalid_pipeline_input',400)}}
export async function pipelineResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==root&&!path.startsWith(root+'/')&&path!==screen&&!path.startsWith(screen+'/'))return null
 const html=path.startsWith(screen)
 let visible:Parameters<typeof page>[0]={revision:0,definition:null,history:[]}
 try {
  if(url.search)fail('invalid_query',400)
  const activation=path.endsWith('/activate')
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:activation})
  if(actor.session.kind!=='native'||actor.member.role!=='owner')fail('owner_required')
  if(path===root+'/catalog'&&request.method==='GET')return json(nativeCatalog)
  const state=await current(env)
  const history=(await env.DB.prepare(`SELECT * FROM porthole_pipeline_versions WHERE ${actor.fence} ORDER BY revision DESC LIMIT 50`).bind(...actor.args).all<Version>()).results.filter(row=>scopeWithin(pipelineScope(definition(JSON.parse(row.definition))),actor.member.scope))
  const view={revision:state.revision,definition:state.definition&&scopeWithin(pipelineScope(state.definition),actor.member.scope)?state.definition:null,history:history.map(row=>({...row,definition:JSON.parse(row.definition)}))}
  visible=view
  if(request.method==='GET'&&(path===root||path===screen))return html?page(view):json(view)
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request)
  if(path.endsWith('/preview')) {
   const raw=decoded(data.definition)
   if(canonical(sanitize(raw))!==canonical(raw))fail('sensitive_pipeline_definition',400)
   const d=definition(raw),expectedRevision=Number(data.revision)
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==state.revision)fail('pipeline_revision_changed',409)
   if(!scopeWithin(pipelineScope(d),actor.member.scope)||state.definition&&!scopeWithin(pipelineScope(state.definition),actor.member.scope))fail('scope_forbidden')
   const samples=decoded(data.samples??[])
   if(!Array.isArray(samples)||samples.length>30||samples.some(v=>typeof v!=='string'||v.length>4096))fail('invalid_pipeline_samples',400)
   const results=samples.map(body=>{
    const record:TelemetryRecord={team:d.team,service:d.service,environment:d.environment,eventTimeNs:'00000000000000000000',traceId:null,spanId:null,late:0,outOfOrder:0,payload:{record:{body:{stringValue:body},severityNumber:9}}}
    const result=processed(record,d,state.revision+1)
    return {...result.payload.pipeline as object,body:(result.payload.record as {body:unknown}).body}
   })
   const id=crypto.randomUUID(),digest=await sha256(new TextEncoder().encode(canonical({definition:d,expectedRevision,results})))
   const expiresAt=Date.now()+300000
   const inserted=await env.DB.prepare(`INSERT INTO porthole_pipeline_previews(id,operator_id,session_id,definition,expected_revision,digest,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${actor.fence} AND COALESCE((SELECT MAX(revision) FROM porthole_pipeline_versions),0)=?`).bind(id,actor.member.operatorId,actor.session.id,canonical(d),expectedRevision,digest,expiresAt,...actor.args,expectedRevision).run()
   if(!inserted.meta.changes)fail('pipeline_revision_changed',409)
   const preview={id,digest,definition:d,results,expectedRevision,expiresAt,impact:{samples:results.length,excluded:results.filter(r=>(r as Record<string,unknown>).excluded).length,appliesTo:'newly accepted matching logs',masking:'newly accepted matching logs and spans',deletesExisting:false}}
   return html?page({...view,preview}):json(preview,201)
  }
  if(activation) {
   if(data.confirm!=='activate-pipeline')fail('confirmation_required',400)
   const preview=await env.DB.prepare('SELECT * FROM porthole_pipeline_previews WHERE id=? AND operator_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>?').bind(data.previewId,actor.member.operatorId,actor.session.id,Date.now()).first<{definition:string;digest:string;expected_revision:number}>()
   if(!preview||preview.digest!==data.digest)fail('pipeline_preview_changed_or_expired',409)
   const d=definition(JSON.parse(preview.definition))
   if(!scopeWithin(pipelineScope(d),actor.member.scope)||state.definition&&!scopeWithin(pipelineScope(state.definition),actor.member.scope))fail('scope_forbidden')
   const proof=proofFence(actor),revision=preview.expected_revision+1,now=Date.now()
   const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO porthole_pipeline_versions(revision,definition,created_at,owner_id) SELECT ?,?,?,? WHERE ${actor.fence} AND ${proof.sql} AND COALESCE((SELECT MAX(revision) FROM porthole_pipeline_versions),0)=? AND EXISTS(SELECT 1 FROM porthole_pipeline_previews WHERE id=? AND operator_id=? AND session_id=? AND digest=? AND consumed_at IS NULL AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))`).bind(revision,canonical(d),now,actor.member.operatorId,...actor.args,...proof.args,preview.expected_revision,data.previewId,actor.member.operatorId,actor.session.id,data.digest),
    env.DB.prepare('UPDATE porthole_pipeline_previews SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM porthole_pipeline_versions WHERE revision=? AND created_at=? AND owner_id=?)').bind(now,data.previewId,revision,now,actor.member.operatorId)
   ])
   if(!result[0].meta.changes)fail('pipeline_revision_or_authority_changed',409)
   return html?new Response(null,{status:303,headers:{...privateHeaders,location:screen}}):json({revision,definition:d},201)
  }
  if(path!==root+'/metrics'&&path!==root+'/accounting')fail('not_found',404)
  const d=definition(decoded(data.definition)),from=nano(data.from),through=nano(data.through)
  if(from>=through)fail('invalid_query_range',400)
  if(!scopeWithin(pipelineScope(d),actor.member.scope))fail('scope_forbidden')
  if(path.endsWith('/metrics')) {
   const groups=(await env.DB.prepare(`SELECT revision,name,COUNT(*) AS count FROM porthole_log_metric_points WHERE service=? AND environment=? AND team=? AND event_time_ns>=? AND event_time_ns<? AND ${actor.fence} GROUP BY revision,name ORDER BY revision,name`).bind(d.service,d.environment,d.team,from,through,...actor.args).all()).results
   return json({groups,coverage:'accepted logs; one contribution per matched record before exclusion'})
  }
  const rows=(await env.DB.prepare(`SELECT COALESCE(json_extract(j.value,'$.payload.pipeline.excluded'),0) AS excluded,COUNT(*) AS records,SUM(COALESCE(json_extract(j.value,'$.payload.pipeline.excludedPayloadBytes'),length(CAST(json_extract(j.value,'$.payload') AS BLOB)))) AS bytes FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.signal='logs' AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.team')=? AND json_extract(j.value,'$.eventTimeNs')>=? AND json_extract(j.value,'$.eventTimeNs')<? AND ${actor.fence} GROUP BY excluded`).bind(d.service,d.environment,d.team,from,through,...actor.args).all<{excluded:number;records:number;bytes:number}>()).results
  const retained=rows.find(r=>!r.excluded)??{records:0,bytes:0},excluded=rows.find(r=>r.excluded)??{records:0,bytes:0}
  const rate={version:'sanitized-payload-v1',unit:'GiB',indexed:0.1,archive:0.02,egress:0.03},projected=(bytes:number)=>({indexedBytes:bytes,archiveBytes:bytes,egressBytes:bytes,usd:bytes/(1024**3)*(rate.indexed+rate.archive+rate.egress)})
  return json({retained:{records:retained.records,...projected(retained.bytes)},excluded:{records:excluded.records,...projected(excluded.bytes)},rateModel:rate,basis:'Retained bytes are stored UTF-8 payloads; excluded bytes are measured sanitized payloads before discard. Minimal accounting journals and infrastructure overhead are not projected. No provider bill or purchase is asserted.'})
 }catch(error) {
  const known=error instanceof AuthError||error instanceof IntakeError,code=known?error.code:'pipelines_unavailable',status=known?error.status:503
  return html?page({...visible,error:code},status):json({error:code},status)
 }
}
