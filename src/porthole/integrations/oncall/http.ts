import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {privateHeaders} from '../../document'
import {authority,fail,proofFence} from '../../security/authority'
import {input,text} from '../../security/input'
import {configured,oncallSummary} from './store'
const path='/api/porthole/v1/integrations/oncall'
export async function oncallResponse(request:Request,env:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!==path)return null
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
 try {
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('native_owner_required')
  if(request.method==='GET')return json(await oncallSummary(env))
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request),proof=proofFence(actor)
  if(Object.keys(data).some(key=>!['monitorId','source','destinationService','confirm','disable'].includes(key)))fail('invalid_input',400)
  const id=text(data.monitorId,36)
  if(data.disable===true){
   await env.DB.prepare(`UPDATE porthole_oncall_routes SET enabled=0 WHERE monitor_id=? AND enabled=1 AND ${actor.fence} AND ${proof.sql}`).bind(id,...actor.args,...proof.args).run()
   return json(await oncallSummary(env))
  }
  if(data.confirm!=='send-monitor-events')fail('explicit_outbound_consent_required',400)
  if(!configured(env))fail('oncall_service_binding_required',409)
  const source=text(data.source,100),destination=text(data.destinationService,100)
  if(!/^[a-zA-Z0-9_-]+$/.test(source)||!/^[a-zA-Z0-9_-]+$/.test(destination))fail('invalid_destination',400)
  const monitor=await env.DB.prepare("SELECT revision,scope FROM porthole_objects WHERE id=? AND kind='monitor' AND state='active'").bind(id).first<{revision:number;scope:string}>()
  if(!monitor)fail('active_monitor_required',409)
  const scope=JSON.parse(monitor.scope) as {services:string[];environments:string[];teams:string[]}
  if(Object.values(scope).some(values=>values.length!==1||values[0]==='*'))fail('single_explicit_monitor_scope_required',400)
  const routeId=crypto.randomUUID(),now=Date.now()
  const result=await env.DB.batch([
   env.DB.prepare(`UPDATE porthole_oncall_routes SET enabled=0 WHERE monitor_id=? AND enabled=1 AND ${actor.fence} AND ${proof.sql}`).bind(id,...actor.args,...proof.args),
   env.DB.prepare(`INSERT INTO porthole_oncall_routes SELECT ?,id,revision,?,?,?,?,?,?,1,? FROM porthole_objects WHERE id=? AND revision=? AND state='active' AND ${actor.fence} AND ${proof.sql}`).bind(routeId,source,destination,scope.environments[0],actor.member.operatorId,actor.member.revision,actor.session.operator.version,now,id,monitor.revision,...actor.args,...proof.args),
  ])
  if(!result[1].meta.changes)fail('authority_or_monitor_changed',409)
  return json(await oncallSummary(env),201)
 }catch(error){return json({error:error instanceof AuthError?error.code:'oncall_unavailable'},error instanceof AuthError?error.status:503)}
}
