import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../../document'
import { IntakeError, nano, sha256 } from '../../ingest/model'
import { authority, fail, proofFence, scopeWithin } from '../../security/authority'
import { input } from '../../security/input'
import { definition, encoded, scope, type Definition } from './model'
const root='/api/porthole/v1/metric-rules'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders})
export async function metricRuleResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path!==root&&!path.startsWith(root+'/'))return null
 try {
  if(url.search)fail('invalid_query',400)
  const write=[root+'/preview',root+'/approve'].includes(path)
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:path===root+'/approve'})
  if(actor.session.kind!=='native')fail('native_session_required')
  if(write&&actor.member.role!=='owner')fail('owner_required')
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
  if(path===root&&request.method==='GET') {
   const rules=(await env.DB.prepare(`SELECT id,revision,definition,from_sequence,created_at,state FROM porthole_metric_rules WHERE ${actor.fence} ORDER BY id,revision`).bind(...actor.args).all<{id:string;revision:number;definition:string}>()).results
   return json({rules:rules.filter(row=>scopeWithin(scope(JSON.parse(row.definition)),actor.member.scope)).map(row=>({...row,definition:JSON.parse(row.definition)}))})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request)
  if(path===root+'/preview') {
   const d=definition(data.definition)
   if(!scopeWithin(scope(d),actor.member.scope))fail('scope_forbidden')
   const targetId=data.id===undefined?crypto.randomUUID():String(data.id),expectedRevision=data.id===undefined?0:Number(data.revision)
   if(!/^[a-f0-9-]{36}$/.test(targetId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid_rule_revision',400)
   const digest=await sha256(new TextEncoder().encode(JSON.stringify({definition:d,targetId,expectedRevision}))),id=crypto.randomUUID(),expiresAt=Date.now()+300000
   const result=await env.DB.prepare(`INSERT INTO porthole_metric_previews SELECT ?,?,?,?,?,?,NULL,?,? WHERE ${actor.fence}`).bind(id,actor.member.operatorId,actor.session.id,encoded(d),digest,expiresAt,targetId,expectedRevision,...actor.args).run()
   if(!result.meta.changes)fail('authority_changed',409)
   return json({id,digest,targetId,expectedRevision,definition:d,expiresAt,maximumSeries:d.dimensions.reduce((n,g)=>n*(g.values.length+1),1),compute:'one contribution per matching accepted span',cost:'No external purchase is authorized. Existing installation compute and storage quotas apply; a USD estimate is unavailable.',restrictions:'Exact service, environment and team; explicit dimension values; unlisted values use [other]. Approval applies to future batches only.'})
  }
  if(path===root+'/approve') {
   if(data.confirm!=='approve-metric-rule')fail('confirmation_required',400)
   const preview=await env.DB.prepare('SELECT * FROM porthole_metric_previews WHERE id=? AND operator_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>?').bind(data.previewId,actor.member.operatorId,actor.session.id,Date.now()).first<{id:string;definition:string;digest:string;target_id:string;expected_revision:number}>()
   if(!preview||preview.digest!==data.digest)fail('preview_changed_or_expired',409)
   const d=definition(JSON.parse(preview.definition))
   if(!scopeWithin(scope(d),actor.member.scope))fail('scope_forbidden')
   const id=preview.target_id
   if(data.id!==undefined&&data.id!==id||data.revision!==undefined&&data.revision!==preview.expected_revision)fail('preview_changed_or_expired',409)
   if(!/^[a-f0-9-]{36}$/.test(id))fail('invalid_rule_id',400)
   const previous=await env.DB.prepare('SELECT revision,definition FROM porthole_metric_rules WHERE id=? ORDER BY revision DESC LIMIT 1').bind(id).first<{revision:number;definition:string}>()
   if((previous?.revision??0)!==preview.expected_revision)fail('revision_changed',409)
   if(previous&&!scopeWithin(scope(JSON.parse(previous.definition)),actor.member.scope))fail('scope_forbidden')
   const revision=(previous?.revision??0)+1
   const current=await authority(request,env,{stepUp:true})
   if(current.member.role!=='owner'||!scopeWithin(scope(d),current.member.scope))fail('authority_changed',409)
   const proof=proofFence(current),now=Date.now()
   const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO porthole_metric_rules(id,revision,definition,from_sequence,created_at,owner_id) SELECT ?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM porthole_ingest_batches),?,? WHERE ${current.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM oa_sessions live WHERE live.id=? AND live.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) AND (EXISTS(SELECT 1 FROM oa_step_up_challenges p WHERE p.session_id=? AND p.operator_id=? AND p.operator_version=? AND p.consumed_at>=CAST(unixepoch('subsec')*1000 AS INTEGER)-300000) OR EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_tokens t ON t.id=s.source_token_id WHERE s.id=? AND s.kind='native' AND s.created_at>=CAST(unixepoch('subsec')*1000 AS INTEGER)-300000 AND t.consumed_at>=CAST(unixepoch('subsec')*1000 AS INTEGER)-300000)) AND EXISTS(SELECT 1 FROM porthole_metric_previews WHERE id=? AND operator_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) AND COALESCE((SELECT MAX(revision) FROM porthole_metric_rules WHERE id=?),0)=? AND (SELECT COUNT(*) FROM porthole_metric_rules)<100`).bind(id,revision,encoded(d),now,current.member.operatorId,...current.args,...proof.args,current.session.id,current.session.id,current.member.operatorId,current.session.operator.version,current.session.id,preview.id,current.member.operatorId,current.session.id,id,revision-1),
    env.DB.prepare('UPDATE porthole_metric_previews SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM porthole_metric_rules WHERE id=? AND revision=? AND created_at=?)').bind(now,preview.id,id,revision,now)
   ])
   if(!results[0].meta.changes)fail('revision_or_authority_changed',409)
   return json({id,revision,definition:d},201)
  }
  if(path!==root+'/query')fail('not_found',404)
  const from=nano(data.from),through=nano(data.through)
  if(from>=through||!Number.isSafeInteger(data.revision)||Number(data.revision)<1)fail('invalid_query_range',400)
  const rule=await env.DB.prepare(`SELECT definition,from_sequence FROM porthole_metric_rules WHERE id=? AND revision=? AND state='active' AND ${actor.fence}`).bind(data.id,data.revision,...actor.args).first<{definition:string;from_sequence:number}>()
  if(!rule)fail('rule_unavailable',404)
  const d=JSON.parse(rule.definition) as Definition
  if(!scopeWithin(scope(d),actor.member.scope))fail('scope_forbidden')
  const args=[data.id,data.revision,from,through]
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM porthole_metric_points WHERE rule_id=? AND revision=? AND event_time_ns>=? AND event_time_ns<?').bind(...args).first<{n:number}>()
  if((count?.n??0)>100000)fail('metric_scan_limit',422)
  const groups=(await env.DB.prepare(`WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY dimensions ORDER BY value,batch_id,ordinal) AS position,COUNT(*) OVER(PARTITION BY dimensions) AS n FROM porthole_metric_points WHERE rule_id=? AND revision=? AND event_time_ns>=? AND event_time_ns<?)
   SELECT dimensions,COUNT(*) AS count,COUNT(value) AS valid,SUM(value) AS sum,MIN(value) AS min,MAX(value) AS max,
   MAX(CASE WHEN position=CAST((n*50+99)/100 AS INTEGER) THEN value END) AS p50,MAX(CASE WHEN position=CAST((n*95+99)/100 AS INTEGER) THEN value END) AS p95,MAX(CASE WHEN position=CAST((n*99+99)/100 AS INTEGER) THEN value END) AS p99,
   MIN(json_array(trace_id,span_id,event_time_ns)) AS exemplar FROM ranked GROUP BY dimensions ORDER BY dimensions`).bind(...args).all<{dimensions:string;count:number;valid:number;sum:number|null;min:number|null;max:number|null;p50:number|null;p95:number|null;p99:number|null;exemplar:string}>()).results
  const losses=await env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_events WHERE signal='traces' AND service=? AND environment=? AND team=? AND kind IN ('source_loss','buffer_loss','rejected') AND (range_start_ns IS NULL OR range_start_ns<? AND range_end_ns>=?)").bind(d.service,d.environment,d.team,through,from).first<{n:number}>()
  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.signal='traces' AND b.state='pending' AND b.sequence>=? AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.team')=? AND json_extract(j.value,'$.eventTimeNs')>=? AND json_extract(j.value,'$.eventTimeNs')<? AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted')=? AND json_extract(j.value,'$.payload.record.name')=?").bind(rule.from_sequence,d.service,d.environment,d.team,from,through,d.inputStage,d.spanName).first<{n:number}>()
  const latest=await authority(request,env)
  if(!scopeWithin(scope(d),latest.member.scope)||latest.member.revision!==actor.member.revision)fail('authority_changed',409)
  const incomplete=!count?.n||d.upstream!=='complete'||!!losses?.n||!!pending?.n||groups.some(g=>g.valid!==g.count||JSON.parse(g.dimensions).includes('[other]'))
  return json({id:data.id,revision:data.revision,definition:d,from,through,interval:'half-open',temporality:'delta',inputStage:'accepted-before-retention',coverage:{status:incomplete?'incomplete':'accepted-input-complete',upstream:d.upstream,independentlyVerified:false,lossEvents:losses?.n??0,pendingRecords:pending?.n??0},groups:groups.map(g=>{const [traceId,spanId,eventTimeNs]=JSON.parse(g.exemplar);return {...g,dimensions:Object.fromEntries(d.dimensions.map((dim,i)=>[dim.key,JSON.parse(g.dimensions)[i]])),exemplar:{traceId,spanId,eventTimeNs,service:d.service,environment:d.environment,team:d.team},quantiles:g.valid===g.count?{p50:g.p50,p95:g.p95,p99:g.p99}:null}})})
 }catch(error){const known=error instanceof AuthError||error instanceof IntakeError;return json({error:known?error.code:'metric_rules_unavailable'},known?error.status:503)}
}
