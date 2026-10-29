import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { authority, fail, scopeWithin } from '../security/authority'
import { input } from '../security/input'
import { privateHeaders, operationDocument as document, escape } from '../document'
import type { ObjectRow } from '../objects/http'
import { hostSettings, hostMonitorPage } from '../objects/page'
import { evaluateHostMonitor } from './types/host-heartbeat'
const api='/api/porthole/v1/monitors'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function monitorsResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),settings=url.pathname==='/app/settings/monitors',page=['/app/monitors','/app/monitors/evaluate'].includes(url.pathname)
 if(!settings&&!page&&url.pathname!==api&&url.pathname!==api+'/evaluate')return null
 try {
  const actor=await authority(request,env,{post:request.method==='POST'})
  if(actor.member.role==='finance reader')fail('monitors_forbidden')
  const rows=(await env.DB.prepare(`SELECT * FROM porthole_objects WHERE kind='monitor' AND ${actor.fence} ORDER BY name,id`).bind(...actor.args).all<ObjectRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope)&&JSON.parse(row.body).type==='host-heartbeat')
  if(request.method==='POST'&&[api+'/evaluate','/app/monitors/evaluate'].includes(url.pathname)) {
   if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
   const data=await input(request),row=rows.find(row=>row.id===data.id)
   if(!row)fail('monitor_not_found',404)
   if(row.state!=='active'||row.revision!==Number(data.revision))fail('revision_or_authority_changed',409)
   const result=await evaluateHostMonitor(env,row,actor)
   return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/monitors'}}):json(result)
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(settings) {
   if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
   return hostSettings(rows)
  }
  const monitors=[]
  for(const row of rows) {
   const history=(await env.DB.prepare('SELECT id,revision,host_id,evaluated_at,evidence FROM porthole_host_monitor_evaluations WHERE object_id=? ORDER BY evaluated_at DESC,id DESC LIMIT 200').bind(row.id).all<{id:string;revision:number;host_id:string;evaluated_at:number;evidence:string}>()).results.map(item=>({...item,evidence:JSON.parse(item.evidence)}))
   const versions=(await env.DB.prepare('SELECT revision,name,scope,body,created_at FROM porthole_host_monitor_versions WHERE object_id=? ORDER BY revision DESC LIMIT 100').bind(row.id).all<{scope:string;body:string}>()).results.filter(version=>scopeWithin(JSON.parse(version.scope),actor.member.scope)).map(version=>({...version,scope:JSON.parse(version.scope),body:JSON.parse(version.body)}))
   monitors.push({...row,scope:JSON.parse(row.scope),body:JSON.parse(row.body),history:history.filter(item=>versions.some(version=>Number((version as {revision?:number}).revision)===item.revision)),versions})
  }
  if(!await env.DB.prepare(`SELECT 1 AS live WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
  return page?hostMonitorPage(monitors):json({monitors})
 } catch(error) {
  const code=error instanceof AuthError?error.code:'monitors_unavailable',status=error instanceof AuthError?error.status:503
  return page||settings?document('Monitors unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/monitors">Return to Monitors</a></p>`,status):json({error:code},status)
 }
}
