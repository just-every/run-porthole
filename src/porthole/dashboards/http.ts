import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,parseScope,scopeWithin,type Authority,type Scope} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {dashboardBody,label,scopeLabel,type Dashboard,type DashboardRow} from './model'
import {dashboardList,dashboardPage} from './page'
import {dashboardResults} from './read'
const api='/api/porthole/v1/dashboards',app='/app/dashboards'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
async function current(env:Bindings,actor:Authority,id:string) {
 const row=await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE id=? AND ${actor.fence}`).bind(id,...actor.args).first<DashboardRow>()
 if(!row)fail('dashboard_not_found',404)
 if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
 return row
}
export async function dashboardResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith(app)
 if(!page&&!url.pathname.startsWith(api))return null
 if(![app,api,app+'/save',app+'/reorder',app+'/clone',app+'/archive'].includes(url.pathname)&&!new RegExp('^('+app+'|'+api+')/[a-f0-9-]{36}$').test(url.pathname))return null
 try {
  const actor=await authority(request,env,{post:request.method==='POST'}),canEdit=['owner','admin','maintainer'].includes(actor.member.role)
  if(actor.member.role==='finance reader')fail('dashboards_forbidden')
  if(request.method==='GET') {
   if(url.pathname===app||url.pathname===api) {
    const rows=(await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE ${actor.fence} ORDER BY updated_at DESC,id`).bind(...actor.args).all<DashboardRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
    return page?dashboardList(rows,canEdit):json({dashboards:rows.map(row=>({...row,body:JSON.parse(row.body),scope:JSON.parse(row.scope)}))})
   }
   let row=await current(env,actor,url.pathname.split('/').at(-1)!)
   const versions=(await env.DB.prepare(`SELECT * FROM porthole_dashboard_versions WHERE id=? AND ${actor.fence} ORDER BY revision DESC`).bind(row.id,...actor.args).all<DashboardRow>()).results.filter(v=>scopeWithin(JSON.parse(v.scope),actor.member.scope))
   if(url.searchParams.has('version')) {const version=Number(url.searchParams.get('version'));row=versions.find(v=>v.revision===version)??fail('dashboard_version_not_found',404)}
   if(!page)return json({...row,body:JSON.parse(row.body),scope:JSON.parse(row.scope),versions:versions.map(v=>v.revision)})
   return dashboardPage(row,row.state==='quarantined'?[]:await dashboardResults(request,env,row),canEdit&&!url.searchParams.has('version'),url,versions)
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(!canEdit)fail('definition_change_forbidden')
  const data=await input(request),previous=typeof data.id==='string'?await current(env,actor,data.id):null,now=Date.now()
  if(previous&&Number(data.revision)!==previous.revision)fail('revision_or_authority_changed',409)
  let body:Dashboard,name:string,scope:Scope,state='active',id=previous?.id??crypto.randomUUID(),revision=(previous?.revision??0)+1
  if(url.pathname.endsWith('/clone')||url.pathname.endsWith('/reorder')||url.pathname.endsWith('/archive')) {
   if(!previous)fail('dashboard_not_found',404)
   body=dashboardBody(JSON.parse(previous.body));name=previous.name;scope=JSON.parse(previous.scope)
   if(url.pathname.endsWith('/clone')) {id=crypto.randomUUID();revision=1;name+=' copy'}
   if(url.pathname.endsWith('/archive'))state=previous.state==='archived'?'active':'archived'
   if(url.pathname.endsWith('/reorder')) {
    if(data.order) {
     const order=typeof data.order==='string'?JSON.parse(data.order):data.order
     if(!Array.isArray(order)||order.length!==body.panels.length||new Set(order).size!==order.length||order.some(id=>!body.panels.some(p=>p.id===id)))fail('invalid_panel_order',400)
     body.panels=order.map(id=>body.panels.find(p=>p.id===id)!)
    } else {
     const index=body.panels.findIndex(p=>p.id===data.panel),to=index+(data.direction==='up'?-1:data.direction==='down'?1:100)
     if(index<0||to<0||to>=body.panels.length)fail('invalid_panel_order',400)
     ;[body.panels[index],body.panels[to]]=[body.panels[to],body.panels[index]]
    }
   }
  } else {
   name=label(data.name)
   scope=parseScope(typeof data.scope==='string'?JSON.parse(data.scope):data.scope??{services:[scopeLabel(data.service)],environments:[scopeLabel(data.environment)],teams:[scopeLabel(data.team)]})
   body=dashboardBody(data.body?typeof data.body==='string'?JSON.parse(data.body):data.body:{panels:[{id:'metric',title:'Metric average',signal:'metrics',aggregate:'average',service:data.service,metric:data.metric,unit:''},{id:'logs',title:'Log count',signal:'logs',aggregate:'count',service:data.service,unit:'records'},{id:'traces',title:'Trace p95',signal:'traces',aggregate:'p95',service:data.service,unit:'ms'}],variables:{team:data.team,environment:data.environment},range:{from:data.from,through:data.through},annotations:[]})
  }
  if(!scope.services.length||!scope.environments.length||!scope.teams.length||!scopeWithin(scope,actor.member.scope)||body.panels.some(p=>!scopeWithin({services:[p.service],environments:[body.variables.environment],teams:[body.variables.team]},scope)))fail('scope_forbidden')
  const inserting=!previous||id!==previous.id
  const statement=inserting?env.DB.prepare(`INSERT INTO porthole_dashboards SELECT ?,?,?,?,?,?,?,?,? WHERE ${actor.fence}`).bind(id,name,JSON.stringify(scope),JSON.stringify(body),revision,state,now,now,...actor.args):env.DB.prepare(`UPDATE porthole_dashboards SET name=?,scope=?,body=?,revision=?,state=?,updated_at=? WHERE id=? AND revision=? AND ${actor.fence}`).bind(name,JSON.stringify(scope),JSON.stringify(body),revision,state,now,id,previous.revision,...actor.args)
  if(!(await statement.run()).meta.changes)fail('revision_or_authority_changed',409)
  return page?new Response(null,{status:303,headers:{...privateHeaders,location:app+'/'+id}}):json({id,revision,state},201)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_dashboard':'dashboards_unavailable'
  return page?document('Dashboard unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${app}">Return to Dashboards</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
