import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {operationDocument,escape,privateHeaders} from '../document'
import {authority,fail,scopeWithin} from '../security/authority'
import {input,text} from '../security/input'
import {objectsResponse,type ObjectRow} from '../objects/http'
import {observeHealth} from '../health/observe'
import {evaluateMonitor} from './evaluate'
import {readMonitors} from './read'
import {monitorsPage,monitorSettingsPage} from './page'
const paths=new Set(['/app/monitors','/app/monitors/state','/app/monitors/evaluate','/app/settings/monitors','/app/settings/monitors/save','/api/porthole/v1/monitors','/api/porthole/v1/monitors/state','/api/porthole/v1/monitors/evaluate'])
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function monitorsResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/')
 if(!paths.has(url.pathname))return null
 try {
  if(request.method==='GET') {
   if([...url.searchParams.keys()].some(key=>!['id','view'].includes(key)))fail('invalid_query',400)
   const id=url.searchParams.get('id')??undefined,{actor,objects,details,revisions}=await readMonitors(request,env,id)
   if(!page)return json({objects:objects.map(row=>({...row,scope:JSON.parse(row.scope),body:JSON.parse(row.body)})),details,revisions})
   if(url.pathname==='/app/settings/monitors')return monitorSettingsPage({object:objects.find(row=>row.id===id),role:actor.member.role})
   return monitorsPage({objects,details,role:actor.member.role,selected:id,triggered:url.searchParams.get('view')==='triggered'})
  }
  const actor=await authority(request,env,{post:true})
  if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
  const data=await input(request)
  if(url.pathname.endsWith('/save')) {
   const list=(key:string)=>String(data[key]??'').split(',').map(value=>value.trim()).filter(Boolean)
   const body={signal:data.signal,operator:data.operator,threshold:Number(data.threshold),windowSeconds:Number(data.windowSeconds),windows:list('windows').length?list('windows').map(Number):[Number(data.windowSeconds)],pendingSeconds:Number(data.pendingSeconds),...(data.recoveryThreshold!==''?{recoveryThreshold:Number(data.recoveryThreshold)}:{}),groupBy:list('groupBy'),noDataPolicy:data.noDataPolicy}
   const proxy=new Request(new URL('/api/porthole/v1/objects',url),{method:'POST',headers:{...Object.fromEntries(request.headers),'content-type':'application/json'},body:JSON.stringify({...(data.id?{id:data.id,revision:Number(data.revision)}:{}),kind:'monitor',name:data.name,scope:data.scope?JSON.parse(String(data.scope)):{services:list('service'),environments:list('environment'),teams:list('team')},body})})
   const response=(await objectsResponse(proxy,env))!
   if(!response.ok)return response
   const saved=await response.json() as {id:string}
   return new Response(null,{status:303,headers:{...privateHeaders,location:'/app/monitors?id='+saved.id}})
  }
  const row=await env.DB.prepare('SELECT * FROM porthole_objects WHERE id=? AND kind=?').bind(text(data.id,36),'monitor').first<ObjectRow>()
  if(!row||!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
  if(row.revision!==Number(data.revision)||row.state==='quarantined'||row.state==='archived')fail('revision_or_authority_changed',409)
  if(url.pathname.endsWith('/state')) {
   if(!['active','inactive'].includes(String(data.state))||data.confirm!==data.state)fail('confirmation_required',400)
   const changed=await env.DB.prepare(`UPDATE porthole_objects SET state=?,updated_at=? WHERE id=? AND revision=? AND state NOT IN ('quarantined','archived') AND ${actor.fence}`).bind(data.state,Date.now(),row.id,row.revision,...actor.args).run()
   if(!changed.meta.changes)fail('revision_or_authority_changed',409)
   return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/monitors?id='+row.id}}):json({id:row.id,revision:row.revision,state:data.state})
  }
  if(!url.pathname.endsWith('/evaluate'))fail('method_not_allowed',405)
  if(row.state!=='active')fail('monitor_inactive',409)
  const result=await evaluateMonitor(env,row,await observeHealth(env))
  if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
  return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/monitors?id='+row.id}}):json(result)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_definition':'monitors_unavailable'
  return page?operationDocument('Monitors unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/monitors">Return to Monitors</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
