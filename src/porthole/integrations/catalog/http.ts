import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {authority,administrative,fail,proofFence,scopeWithin,type Authority} from '../../security/authority'
import {input} from '../../security/input'
import {privateHeaders,operationDocument as document,escape} from '../../document'
import {credentialFor,listCredentials} from '../../credentials/store'
import {writeDashboard} from '../../dashboards/write'
import {packs,packFor,bindingScope,visible,type Binding} from './model'
import {collectorConfiguration} from './config'
import {setupHealth} from './health'
const api='/api/porthole/v1/integrations',app='/app/settings/integrations/catalog'
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:privateHeaders})
async function release(env:Bindings,actor:Authority){if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)}
async function liveCredential(env:Bindings,actor:Authority,b:Binding) {
 if(!b.credential_id)fail('integration_review_required',409)
 const c=await credentialFor(env.DB,b.credential_id),scope=JSON.parse(c.scope),p=packFor(b.pack)
 if(c.class!=='ingest'||c.status!=='active'||c.expires_at<=Date.now()||!scopeWithin(bindingScope(b),scope)||!p.signals.every(s=>scope.signals.includes(s))||!scope.actions.includes('telemetry.write')||!scopeWithin(bindingScope(b),actor.member.scope))fail('integration_credential_unavailable',409)
 const held=await env.DB.prepare(`SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=? AND m.role IN ('owner','admin') AND o.role=m.role AND o.status='active'`).bind(c.custodian_id).first()
 if(!held)fail('integration_credential_unavailable',409)
 return c
}
export async function integrationCatalogResponse(request:Request,env:Bindings):Promise<Response|null> {
 const u=new URL(request.url),page=u.pathname.startsWith(app)
 if(![api,api+'/enable',app,app+'/enable'].includes(u.pathname)&&!new RegExp(`^(${api}|${app})/[a-f0-9-]{36}(/configuration)?$`).test(u.pathname))return null
 try {
  if(u.search)fail('invalid_query',400)
  const write=request.method==='POST',configuration=u.pathname.endsWith('/configuration'),actor=await authority(request,env,{post:write,manage:write||configuration,stepUp:write||configuration})
  if(actor.member.role==='finance reader')fail('integrations_forbidden')
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  if(write) {
   if(!u.pathname.endsWith('/enable'))fail('method_not_allowed',405)
   const data=await input(request)
   if(Object.keys(data).some(k=>!['pack','service','environment','team','credentialId','confirm','revision'].includes(k)))fail('integration_secret_or_unknown_field_refused',400)
   if(data.confirm!=='review-local-collection')fail('integration_review_required',400)
   const p=packFor(String(data.pack))
   for(const k of ['service','environment','team'])if(typeof data[k]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(data[k] as string))fail('invalid_integration_scope',400)
   if(typeof data.credentialId!=='string'||!/^[a-f0-9-]{36}$/.test(data.credentialId))fail('invalid_credential_id',400)
   const old=await env.DB.prepare('SELECT * FROM porthole_integration_bindings WHERE pack=? AND service=? AND environment=? AND team=?').bind(p.id,data.service,data.environment,data.team).first<Binding>()
   if(Number(data.revision??0)!==(old?.revision??0))fail('revision_changed',409)
   const b:Binding={id:old?.id??crypto.randomUUID(),pack:p.id,service:String(data.service),environment:String(data.environment),team:String(data.team),credential_id:data.credentialId,dashboard_id:old?.dashboard_id??null,state:'enabled',revision:(old?.revision??0)+1,created_at:old?.created_at??Date.now(),owner_id:actor.member.operatorId}
   const credential=await liveCredential(env,actor,b),proof=proofFence(actor)
   const gate=`${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_credentials WHERE id=? AND revision=? AND status='active' AND expires_at>?)`,args=[...actor.args,...proof.args,credential.id,credential.revision,Date.now()]
   const changed=old?await env.DB.prepare(`UPDATE porthole_integration_bindings SET credential_id=?,state='enabled',revision=?,owner_id=? WHERE id=? AND revision=? AND ${gate}`).bind(b.credential_id,b.revision,b.owner_id,b.id,old.revision,...args).run():await env.DB.prepare(`INSERT INTO porthole_integration_bindings SELECT ?,?,?,?,?,?,NULL,'enabled',1,?,? WHERE ${gate}`).bind(b.id,b.pack,b.service,b.environment,b.team,b.credential_id,b.created_at,b.owner_id,...args).run()
   if(!changed.meta.changes)fail('revision_or_authority_changed',409)
   if(!b.dashboard_id) {
    const body={panels:p.metrics.map((m,i)=>({id:'metric-'+i,title:m.name,signal:'metrics',aggregate:'average',service:b.service,metric:m.name,unit:m.unit,widget:'timeseries'})),variables:{team:b.team,environment:b.environment},range:{from:'0',through:'18446744073709551615'},annotations:[]}
    if(b.pack==='nginx')(body.panels as unknown[]).push({id:'logs',title:'Access and error logs',signal:'logs',aggregate:'count',service:b.service,unit:'records',widget:'log_stream'})
    const response=await writeDashboard(new Request(new URL('/api/porthole/v1/dashboards',request.url),{method:'POST',headers:{'content-type':'application/json','idempotency-key':'integration-'+b.id},body:JSON.stringify({name:p.name+' · '+b.service,scope:bindingScope(b),body})}),env,actor)
    const result=await response.json() as {id:string};b.dashboard_id=result.id
    await env.DB.prepare(`UPDATE porthole_integration_bindings SET dashboard_id=? WHERE id=? AND revision=? AND ${gate}`).bind(result.id,b.id,b.revision,...args).run()
   }
   await release(env,actor)
   return page?new Response(null,{status:303,headers:{...privateHeaders,location:app+'/'+b.id}}):json({version:1,binding:b,configurationUrl:api+'/'+b.id+'/configuration'},201)
  }
  const rows=(await env.DB.prepare('SELECT * FROM porthole_integration_bindings ORDER BY pack,service,environment,team').all<Binding>()).results.filter(b=>visible(b,actor.member.scope))
  if(u.pathname!==api&&u.pathname!==app) {
   const id=u.pathname.split('/').at(configuration?-2:-1),b=rows.find(b=>b.id===id)??fail('integration_not_found',404),p=packFor(b.pack)
   if(configuration) {if(b.state!=='enabled')fail('integration_review_required',409);await liveCredential(env,actor,b);await release(env,actor);return json(collectorConfiguration(b,u.origin))}
   let health;try{await liveCredential(env,actor,b);health=await setupHealth(request,env,b)}catch{health={state:'Unknown',reason:'Collection credential is unavailable or setup is inactive.',nextAction:'Review an active scoped ingest credential.',lastObservedAt:null}}
   await release(env,actor)
   if(!page)return json({version:1,pack:p,binding:b,health})
   return document(p.name+' setup',`<p><a href="${app}">Integration catalog</a></p><p>${escape(b.service)} · ${escape(b.environment)} · ${escape(b.team)}</p><p role="status">${escape(health.state)}: ${escape(health.reason)}</p><p>${escape(health.nextAction)}</p><p>Revision ${b.revision}. Collection state: ${escape(b.state)}.</p><h2>Required permissions</h2><p>${escape(p.permissions)}</p><ol>${p.setup.map(s=>`<li>${escape(s)}</li>`).join('')}</ol><p>${escape(p.recommendedMonitors)}</p>${administrative(actor.member.role)&&b.state==='enabled'?`<p><a href="${app}/${b.id}/configuration">Download collector configuration</a></p>`:''}${b.dashboard_id?`<p><a href="/app/dashboards/${b.dashboard_id}">Open preset dashboard</a></p>`:''}`)
  }
  await release(env,actor)
  if(!page)return json({version:1,packs:packs.map(p=>({...p,state:rows.some(b=>b.pack===p.id&&b.state==='enabled')?'configured':'not-configured',bindings:rows.filter(b=>b.pack===p.id)}))})
  const credentials=administrative(actor.member.role)?(await listCredentials(env.DB)).filter(c=>c.class==='ingest'&&c.status==='active'&&c.expires_at>Date.now()):[]
  await release(env,actor)
  return document('Technology integrations',`<p>Eight local collection packs for the unmodified OpenTelemetry Collector Contrib 0.135.0. Configuration stays under Settings. No monitors are activated.</p><p><a href="/app/settings/integrations">Mail integrations</a> · <a href="/app/settings/credentials">Ingest credentials</a></p>${packs.map(p=>`<section><h2>${escape(p.name)}</h2><p>Service: ${escape(p.serviceImage)}. Receiver: ${escape(p.receiver)}. Signals: ${p.signals.join(', ')}.</p><p>${escape(p.permissions)}</p><p><a href="${escape(p.source)}">Pinned receiver documentation</a></p>${rows.filter(b=>b.pack===p.id).map(b=>`<p><a href="${app}/${b.id}">${escape(b.service)} · ${escape(b.environment)} · ${escape(b.team)}</a>: ${escape(b.state)}, revision ${b.revision}</p>`).join('')||'<p>Not configured. Setup health is Unknown.</p>'}</section>`).join('')}${administrative(actor.member.role)?`<h2>Review local collection</h2><p>Enter no monitored-service secrets here. Resolve them on the collector host. To change an existing setup, enter its current revision.</p><form method="post" action="${app}/enable"><label>Pack <select name="pack">${packs.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></label><label>Service <input name="service" required></label><label>Environment <input name="environment" required></label><label>Team <input name="team" required></label><label>Existing ingest credential <select name="credentialId">${credentials.map(c=>`<option value="${c.id}">${escape(c.name)}</option>`).join('')}</select></label><label>Current revision <input name="revision" type="number" min="0" value="0" required></label><label><input type="checkbox" name="confirm" value="review-local-collection" required> I reviewed this collection scope and its read-only permissions</label><button>Enable collection pack</button></form>`:''}`,200,{forms:true})
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_integration':'integrations_unavailable'
  return page?document('Integration setup unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${app}">Return to integration catalog</a></p>`,status):json({error:code},status)
 }
}
