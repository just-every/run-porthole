import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,proofFence} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {configuration,coverage,ready,reconcile,roles,watermark,type Role} from './client'
export async function analyticalResponse(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url),page=['/app/settings/analytics','/app/settings/analytics/reconcile'].includes(url.pathname)
 if(!page&&!['/api/porthole/v1/analytics/configuration','/api/porthole/v1/analytics/reconcile'].includes(url.pathname))return null
 try{
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('owner_required')
  if(url.search)fail('invalid_query',400)
  let config=await configuration(env)
  if(request.method==='POST'){
   if(url.pathname.endsWith('/reconcile')){const result=await reconcile(env);return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/settings/analytics'}}):Response.json(result,{headers:privateHeaders})}
   const data=await input(request)
   if(Object.keys(data).some(key=>!['revision','role','enabled','confirm'].includes(key)))fail('invalid_configuration',400)
   const enabled=data.enabled===true||data.enabled==='true'?1:data.enabled===false||data.enabled==='false'?0:fail('invalid_configuration',400),role=String(data.role) as Role
   if(!roles.includes(role)||Number(data.revision)!==config.revision||data.confirm!=='connect-analytical-workers')fail('configuration_confirmation_required',400)
   if(enabled&&roles.some(role=>!ready(env,role)))fail('analytics_binding_missing',503)
   const required=await watermark(env)
   if(config.enabled&&enabled&&role!==config.active_role)await coverage(env,config,role,required)
   const proof=proofFence(actor)
   const changed=await env.DB.prepare(`UPDATE porthole_analytical_configuration SET enabled=?,active_role=?,revision=revision+1,changed_at=?,configured_by=?,configurer_revision=?,configurer_version=? WHERE singleton=1 AND revision=? AND ${actor.fence} AND ${proof.sql} AND (SELECT COALESCE(MAX(completion_sequence),0) FROM porthole_ingest_batches WHERE state='complete')=? RETURNING revision`).bind(enabled,role,Date.now(),actor.member.operatorId,actor.member.revision,actor.session.operator.version,config.revision,...actor.args,...proof.args,required).all()
   if(!changed.results.length)fail('configuration_changed',409)
   config=await configuration(env)
   if(!page)return Response.json({revision:config.revision,enabled:!!config.enabled,role:config.active_role},{headers:privateHeaders})
   return new Response(null,{status:303,headers:{...privateHeaders,location:'/app/settings/analytics'}})
  }
  if(url.pathname.endsWith('/reconcile'))fail('method_not_allowed',405)
  if(request.method!=='GET')fail('method_not_allowed',405)
  const states=await Promise.all(roles.map(async role=>{try{const state=await coverage(env,config,role);return {role,status:'Caught up',watermark:state.watermark}}catch{return {role,status:ready(env,role)?'Unavailable or behind':'Binding missing',watermark:null}}}))
  if(!page)return Response.json({revision:config.revision,enabled:!!config.enabled&&!!config.live,role:config.active_role,requiredWatermark:await watermark(env),workers:states},{headers:privateHeaders})
  return document('Analytical workers',`<p role="status">${config.enabled&&config.live?'Connection authorized':'Explicit owner connection required'} · selected ${escape(config.active_role)} · revision ${config.revision}.</p><p>The primary and standby are separate from this Base control-plane store. Queries and monitor counts use the selected worker. An unavailable or incomplete worker produces Unknown; there is no local analytical fallback after connection.</p><ul>${states.map(row=>`<li>${row.role}: ${escape(row.status)}; coverage watermark ${row.watermark??'Unknown'}</li>`).join('')}</ul><form method="post" action="/app/settings/analytics"><input type="hidden" name="revision" value="${config.revision}"><label>Selected worker <select name="role"><option${config.active_role==='primary'?' selected':''}>primary</option><option${config.active_role==='standby'?' selected':''}>standby</option></select></label><label>Connection <select name="enabled"><option value="true">Connect</option><option value="false">Pause</option></select></label><label><input type="checkbox" name="confirm" value="connect-analytical-workers" required> I authorize bounded replication of retained telemetry to the installation's selected analytical workers.</label><p>A fresh native owner proof is required. Failover and failback refuse a lagging destination. Pausing never deletes data or activates a different worker.</p><button>Apply reviewed connection</button></form><form method="post" action="/app/settings/analytics/reconcile"><button>Resume bounded replication</button></form><p>Resume bounded replication through the owner reconciliation API or the installation's scheduled drain. <a href="/app/health">Pipeline health</a> · <a href="/app/explore">Query telemetry</a>.</p>`,200,{forms:true})
 }catch(error){const code=error instanceof AuthError?error.code:'analytics_configuration_unavailable',status=error instanceof AuthError?error.status:503;return page?document('Analytical workers unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/settings/analytics">Retry analytical configuration</a></p>`,status):Response.json({error:code},{status,headers:privateHeaders})}
}
