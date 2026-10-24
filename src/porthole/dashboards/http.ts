import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,parseScope,scopeWithin,type Authority,type Scope} from '../security/authority'
import {operationDocument as document,escape,privateHeaders} from '../document'
import type {DashboardRow} from './model'
import {dashboardReadResponse} from './api-read'
import {dashboardList,dashboardPage} from './page'
import {currentDashboard} from './store'
import {writeDashboard} from './write'
import {dashboardResults} from './read'
const api='/api/porthole/v1/dashboards',app='/app/dashboards'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function dashboardResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith(app)
 if(!page&&!url.pathname.startsWith(api))return null
 if(![app,api,app+'/save',app+'/reorder',app+'/clone',app+'/archive',app+'/panel',app+'/annotation',api+'/archive'].includes(url.pathname)&&!new RegExp('^('+app+'|'+api+')/[a-f0-9-]{36}$').test(url.pathname))return null
 try {
  if(!page&&request.method==='GET')return await dashboardReadResponse(request,env)
  const actor=await authority(request,env,{post:request.method==='POST'}),canEdit=['owner','admin','maintainer'].includes(actor.member.role)
  if(actor.member.role==='finance reader')fail('dashboards_forbidden')
  if(request.method==='GET') {
   const allowed=['team','environment','from','through','version','tv']
   if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)||url.pathname===app&&url.search)fail('invalid_query',400)
   if(url.pathname===app) {
    const rows=(await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE ${actor.fence} ORDER BY updated_at DESC,id`).bind(...actor.args).all<DashboardRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
    return dashboardList(rows,canEdit)
   }
   let row=await currentDashboard(env,actor,url.pathname.split('/').at(-1)!)
   const quarantined=row.state==='quarantined'
   const versions=(await env.DB.prepare(`SELECT * FROM porthole_dashboard_versions WHERE id=? AND ${actor.fence} ORDER BY revision DESC`).bind(row.id,...actor.args).all<DashboardRow>()).results.filter(v=>scopeWithin(JSON.parse(v.scope),actor.member.scope))
   if(url.searchParams.has('version')) {const version=Number(url.searchParams.get('version'));row=versions.find(v=>v.revision===version)??fail('dashboard_version_not_found',404)}
   if(quarantined)row={...row,state:'quarantined'}
   return await dashboardPage(row,row.state==='quarantined'?[]:await dashboardResults(request,env,row),canEdit&&!url.searchParams.has('version'),url,versions,actor.member.role==='owner')
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(!canEdit)fail('definition_change_forbidden')
  return await writeDashboard(request,env,actor)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_dashboard':'dashboards_unavailable'
  return page?document('Dashboard unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${app}">Return to Dashboards</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
