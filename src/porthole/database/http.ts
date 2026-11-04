import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {reviewedPlans} from '../../../collectors/database/privacy.mjs'
import {authority,allScope,emptyScope,fail,proofFence,scopeWithin} from '../security/authority'
import {input} from '../security/input'
import {CredentialLimit,verifyCredential} from '../credentials/verify'
import {acceptEnvelope} from '../ingest/store'
import {canonical,IntakeError,sha256} from '../ingest/model'
import {readTelemetry,scopeWhere} from '../ingest/read'
import {privateHeaders,operationDocument as document,escape} from '../document'
import {captureInput,type Capture} from './model'
const api='/api/porthole/v1/database',settings='/app/settings/database'
interface Source {id:string;credential_id:string;service:string;environment:string;team:string;engine:string;plan_digest:string;revision:number;enabled:number;reviewed_at:number;owner_id:string}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:privateHeaders})
const scope=(s:Source)=>({services:[s.service],environments:[s.environment],teams:[s.team]})
const digest=(plans:unknown)=>sha256(new TextEncoder().encode(canonical(reviewedPlans(plans))))
function reviewLive(source:Source){return {sql:'EXISTS(SELECT 1 FROM porthole_database_sources WHERE id=? AND credential_id=? AND revision=? AND enabled=1 AND plan_digest=?)',args:[source.id,source.credential_id,source.revision,source.plan_digest]}}
async function settingsPage(sources:Source[]){return document('Database collection',`<p>Review bounded local PostgreSQL or MySQL diagnostics. Database passwords stay in the collector’s private configuration. This grants no remediation.</p><p><a href="/app/database">Open Database</a> · <a href="/app/settings/credentials">Intake credentials</a></p><form method="post" action="${settings}"><label>Source ID <input name="id" required maxlength="80"></label><label>Current revision (0 for new) <input name="revision" type="number" value="0" min="0" required></label><label>Intake credential ID <input name="credentialId" required></label><label>Engine <select name="engine"><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select></label><label>Service <input name="service" required></label><label>Environment <input name="environment" required></label><label>Team <input name="team" required></label><label>Reviewed SELECT templates (JSON array, ? marks a value) <textarea name="plans" rows="4">[]</textarea></label><label>Collection <select name="enabled"><option value="true">Enabled</option><option value="false">Stopped</option></select></label><label>Exact consent <input name="confirm" placeholder="review-read-only-database" required></label><button type="submit">Review collection</button></form><h2>Reviewed sources</h2>${sources.length?sources.map(s=>`<article><h3>${escape(s.id)}</h3><p>${escape(s.engine)} · revision ${s.revision} · ${s.enabled?'Enabled':'Stopped'} · ${escape(s.service)} · ${escape(s.environment)} · ${escape(s.team)}</p><p>Plan review digest <code>${escape(s.plan_digest)}</code></p></article>`).join(''):'<p>No database collection has been reviewed.</p>'}`,200,{forms:true})}
export async function databaseResponse(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url),page=url.pathname==='/app/database',config=url.pathname===settings||url.pathname===api+'/sources',capture=url.pathname===api+'/captures'
 if(!page&&!config&&!capture&&url.pathname!==api)return null
 try{
  if(capture){
   if(request.method!=='POST')fail('method_not_allowed',405)
   const auth=await verifyCredential(request,env,{inspectOnly:true,action:'telemetry.write',scope:emptyScope,dataScope:allScope})
   const data=await input(request)
   if(Object.keys(data).sort().join(',')!=='capture,id,planDigest,revision'||typeof data.id!=='string'||typeof data.planDigest!=='string')fail('invalid_database_capture',400)
   const source=await env.DB.prepare('SELECT * FROM porthole_database_sources WHERE id=? AND enabled=1 AND credential_id=? AND revision=? AND plan_digest=?').bind(data.id,auth.credential.id,data.revision,data.planDigest).first<Source>()
   if(!source||!scopeWithin(scope(source),auth.credential.scope))fail('database_review_required')
   const capture=captureInput(data.capture)
   if(capture.engine!==source.engine)fail('database_engine_changed',409)
   const payload={record:{eventName:'porthole.database.capture',attributes:[{key:'porthole.database.kind',value:{stringValue:'capture'}}],body:{stringValue:canonical({sourceId:source.id,revision:source.revision,...capture})}}}
   const wire=new TextEncoder().encode(canonical(payload)),original=new TextEncoder().encode(canonical(data))
   // An unsafe request exists in memory only. The envelope and retained wire
   // are constructed exclusively from the validated, sanitized projection.
   const hash=await sha256(original),receipt=await acceptEnvelope(request,env,{id:crypto.randomUUID(),identity:hash,digest:hash,signal:'logs',protocol:'porthole.database.v1',wire,records:[{team:source.team,service:source.service,environment:source.environment,eventTimeNs:(BigInt(capture.collectedAt)*1000000n).toString().padStart(20,'0'),traceId:null,spanId:null,payload,late:0,outOfOrder:0}],gate:reviewLive(source)})
   return json(receipt,201)
  }
  if(config){
   const post=request.method==='POST',actor=await authority(request,env,{post,stepUp:post})
   if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('native_owner_required')
   if(url.search)fail('invalid_query',400)
   if(post){
    const d=await input(request)
    if(Object.keys(d).some(k=>!['id','revision','credentialId','engine','service','environment','team','plans','enabled','confirm'].includes(k))||typeof d.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(d.id)||!['postgresql','mysql'].includes(String(d.engine))||!Number.isSafeInteger(Number(d.revision))||Number(d.revision)<0||!['true','false'].includes(String(d.enabled))||d.confirm!=='review-read-only-database')fail('invalid_database_review',400)
    let plans:unknown;try{plans=typeof d.plans==='string'?JSON.parse(d.plans):d.plans}catch{fail('invalid_reviewed_plans',400)}
    const planDigest=await digest(plans),revision=Number(d.revision),enabled=String(d.enabled)==='true'?1:0
    const credential=await env.DB.prepare("SELECT id,scope FROM porthole_credentials WHERE id=? AND status='active' AND class='ingest' AND custodian_id=?").bind(d.credentialId,actor.member.operatorId).first<{id:string;scope:string}>()
    if(!credential)fail('database_credential_forbidden')
    for(const key of ['service','environment','team'])if(typeof d[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(String(d[key])))fail('invalid_database_scope',400)
    const wanted={services:[String(d.service)],environments:[String(d.environment)],teams:[String(d.team)]},held=JSON.parse(credential.scope)
    if(!scopeWithin(wanted,actor.member.scope)||!scopeWithin(wanted,held)||!held.signals.includes('logs'))fail('database_scope_forbidden')
    const proof=proofFence(actor),now=Date.now()
    const fence=`${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_credentials WHERE id=? AND status='active' AND scope=? AND custodian_id=?)`
    const args=[...actor.args,...proof.args,credential.id,credential.scope,actor.member.operatorId]
    const result=revision===0?await env.DB.prepare(`INSERT INTO porthole_database_sources SELECT ?,?,?,?,?,?,?,1,?,?,? WHERE ${fence} ON CONFLICT(id) DO NOTHING`).bind(d.id,credential.id,d.service,d.environment,d.team,d.engine,planDigest,enabled,now,actor.member.operatorId,...args).run():await env.DB.prepare(`UPDATE porthole_database_sources SET credential_id=?,service=?,environment=?,team=?,engine=?,plan_digest=?,revision=revision+1,enabled=?,reviewed_at=?,owner_id=? WHERE id=? AND revision=? AND ${fence}`).bind(credential.id,d.service,d.environment,d.team,d.engine,planDigest,enabled,now,actor.member.operatorId,d.id,revision,...args).run()
    if(result.meta.changes!==1)fail('database_review_changed',409)
    return url.pathname===settings?new Response(null,{status:303,headers:{...privateHeaders,location:settings}}):json({id:d.id,revision:revision+1,enabled:!!enabled,planDigest},201)
   }
   if(request.method!=='GET')fail('method_not_allowed',405)
   const rows=(await env.DB.prepare(`SELECT * FROM porthole_database_sources WHERE ${actor.fence} ORDER BY id LIMIT 100`).bind(...actor.args).all<Source>()).results.filter(s=>scopeWithin(scope(s),actor.member.scope))
   return url.pathname===settings?settingsPage(rows):json({sources:rows})
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  // Native sessions only: database samples inherit telemetry visibility and
  // cannot be exposed by the existence of a collection grant.
  const actor=await authority(request,env)
  if(actor.member.role==='finance reader')fail('telemetry_forbidden')
  if([...url.searchParams.keys()].some(k=>!['service','environment','team','from','through','cursor','snapshot','limit'].includes(k)))fail('invalid_query',400)
  const target=new URL('/api/porthole/v1/ingest/records',url);target.search=url.search;target.searchParams.set('signal','logs')
  const response=await readTelemetry(new Request(target,{headers:request.headers}),env,{logSearch:{version:1,root:{op:'term',field:'@porthole.database.kind',operator:'eq',value:'capture'}} as never})
  if(!response.ok)return page?document('Database unavailable',`<p role="alert">${escape((await response.json() as {error:string}).error)}</p>`,response.status):response
  const result=await response.json() as {records:{id:string;source_id:string;service:string;environment:string;team:string;payload:{record:{body:{stringValue:string}}}}[];snapshot:number;cursor:string|null;analytical?:unknown}
  const captures=[]
  for(const row of result.records){
   const raw=JSON.parse(row.payload.record.body.stringValue),capture=captureInput(Object.fromEntries(Object.entries(raw).filter(([k])=>!['sourceId','revision'].includes(k))))
   const live=await env.DB.prepare("SELECT s.enabled,c.status,c.expires_at FROM porthole_database_sources s JOIN porthole_credentials c ON c.id=s.credential_id WHERE s.id=? AND s.credential_id=? AND s.revision=?").bind(raw.sourceId,row.source_id,raw.revision).first<{enabled:number;status:string;expires_at:number}>()
   captures.push({id:row.id,sourceId:raw.sourceId,revision:raw.revision,service:row.service,environment:row.environment,team:row.team,...capture,collection:!live?'inactive_history':!live.enabled?'stopped':live.status!=='active'||live.expires_at<=Date.now()?'credential_revoked':Date.now()-capture.collectedAt>60000?'stale':'fresh',queryStatistics:'cumulative since engine statistics reset; sampled collection, no full-traffic claim'})
  }
  const where=scopeWhere(actor.member.scope,'s'),sources=(await env.DB.prepare(`SELECT s.id,s.engine,s.enabled FROM porthole_database_sources s WHERE ${where.sql} AND ${actor.fence} ORDER BY s.id LIMIT 100`).bind(...where.args,...actor.args).all()).results
  if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
  const body={captures,sources,snapshot:result.snapshot,cursor:result.cursor,...(result.analytical?{analytical:result.analytical}:{}),complete:!result.cursor}
  if(!page)return json(body)
  const next=new URL(url);if(result.cursor){next.searchParams.set('cursor',result.cursor);next.searchParams.set('snapshot',String(result.snapshot))}
  return document('Database',`<p><a href="${settings}">Database settings</a> · <a href="/app/traces">Traces</a></p><p>Bounded read-only local diagnostics. Query statistics are cumulative since the engine statistics reset. Missing evidence is not healthy coverage.</p>${result.cursor?'<p role="status">Partial page. Continue for remaining captures.</p>':''}${captures.length?captures.map(c=>`<article><h2>${escape(c.sourceId)} · ${escape(c.engine)} ${escape(c.version)}</h2><p>${escape(c.collection)} · ${escape(c.service)} · ${escape(c.environment)} · ${escape(c.team)}</p><p>Collected ${escape(new Date(c.collectedAt).toISOString())}; database clock ${escape(new Date(c.databaseTime).toISOString())}</p><p>Statistics: ${escape(c.coverage.statistics)}; plans: ${escape(c.coverage.plans)}; waits: ${escape(c.coverage.waits)}</p>${c.queries.slice().sort((a,b)=>b.totalMs-a.totalMs).map(q=>`<section><h3>Fingerprint ${escape(q.queryId)}</h3><pre>${escape(q.fingerprint)}</pre><p>${q.calls} calls · ${q.totalMs} total ms · ${q.meanMs} mean ms · ${q.rows} rows</p><pre>${escape(canonical(q.plan))}</pre></section>`).join('')}${c.waits.map(w=>`<p>Session ${escape(w.waiting)} waits for ${escape(w.blocking)} (${escape(w.kind)})${w.traceId?` · <a href="/app/traces/${escape(w.traceId)}">Calling request</a>`:' · Caller unavailable'}</p>`).join('')}${c.waits.length?'':'<p>No blocking session observed in this bounded capture.</p>'}</article>`).join(''):'<p>No database captures. Review a source in Settings, then run its collector. A stopped or denied source supplies no healthy evidence.</p>'}${result.cursor?`<p><a href="${escape(next.pathname+next.search)}">Next captures</a></p>`:''}`,200)
 }catch(error){const known=error instanceof AuthError||error instanceof IntakeError||error instanceof CredentialLimit,code=known?error.code:'database_unavailable',status=known?error.status:503;return page||url.pathname===settings?document('Database unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/database">Return to Database</a></p>`,status):json({error:code},status)}
}
