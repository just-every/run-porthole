import {agentReadAuthority,agentCredential,type ReadPrincipal} from '../security/agent-read'
import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {verifyCredential,CredentialLimit} from '../credentials/verify'
import {privateHeaders} from '../document'
import {allScope,authority,emptyScope,fail,parseScope,scopeWithin,type Scope} from '../security/authority'
import {dashboardBody,type DashboardRow} from './model'

const root='/api/porthole/v1/dashboards'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...headers}})
function permitted(alias:string,scope:Scope,signals:string[]|null) {
 const parts:string[]=[],args:unknown[]=[]
 for(const key of ['services','environments','teams'] as const) {
  parts.push(`NOT EXISTS(SELECT 1 FROM json_each(${alias}.scope,'$.${key}') wanted WHERE NOT EXISTS(SELECT 1 FROM json_each(?) held WHERE held.value='*' OR held.value=wanted.value))`)
  args.push(JSON.stringify(scope[key]))
 }
 if(signals) {
  parts.push(`NOT EXISTS(SELECT 1 FROM json_each(${alias}.body,'$.panels') panel WHERE NOT EXISTS(SELECT 1 FROM json_each(?) held_signal WHERE held_signal.value=json_extract(panel.value,'$.signal')))`)
  args.push(JSON.stringify(signals))
 }
 return {sql:parts.join(' AND '),args}
}
function representation(row:DashboardRow,scope:Scope,signals:string[]|null) {
 const selected=parseScope(JSON.parse(row.scope)),body=dashboardBody(JSON.parse(row.body))
 if(!scopeWithin(selected,scope)||signals&&body.panels.some(panel=>!signals.includes(panel.signal))||body.panels.some(panel=>!scopeWithin({services:[panel.service],environments:[body.variables.environment],teams:[body.variables.team]},selected)))fail('authority_changed',409)
 return {...row,scope:selected,body}
}
/** A whole definition and every returned historical revision remain subject
 * to the current member, current definition and all panel signal grants. */
export async function dashboardReadResponse(request:Request,env:Bindings,principal?:ReadPrincipal):Promise<Response> {
 const credential=(use:Parameters<typeof verifyCredential>[2])=>principal?.clientId?agentCredential(request,env,principal,use!):verifyCredential(request,env,use)
 const requestId=crypto.randomUUID()
 try {
  let scope:Scope,signals:string[]|null=null,actorRef:string,actorRevision:number,live:{sql:string;args:unknown[]}
  const bearer=!!principal?.clientId||request.headers.has('authorization')
  if(bearer) {
   const auth=await credential({action:'definitions.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
   scope=auth.credential.scope;signals=auth.credential.scope.signals;actorRef=auth.credential.id;actorRevision=auth.credential.revision;live=auth.fence
  } else {
   const actor=principal?await agentReadAuthority(env,principal):await authority(request,env)
   if(actor.member.role==='finance reader')fail('dashboards_forbidden')
   scope=actor.member.scope;actorRef=actor.member.operatorId;actorRevision=actor.member.revision;live={sql:actor.fence,args:actor.args}
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  const url=new URL(request.url),id=url.pathname===root?undefined:url.pathname.slice(root.length+1)
  if(url.pathname!==root&&(!url.pathname.startsWith(root+'/')||!uuid.test(id!)))fail('dashboard_not_found',404)
  const keys=id?['version']:['cursor','limit']
  if([...url.searchParams.keys()].some(key=>!keys.includes(key)||url.searchParams.getAll(key).length!==1))fail('invalid_query',400)
  const cursor=url.searchParams.get('cursor')??'',limit=Number(url.searchParams.get('limit')??50)
  const version=url.searchParams.has('version')?Number(url.searchParams.get('version')):undefined
  if(!Number.isSafeInteger(limit)||limit<1||limit>200||cursor&&!uuid.test(cursor))fail('invalid_pagination',400)
  if(version!==undefined&&(!/^[1-9][0-9]*$/.test(url.searchParams.get('version')!)||!Number.isSafeInteger(version)))fail('invalid_dashboard_version',400)
  const current=permitted('d',scope,signals),history=permitted('h',scope,signals)
  const statements=(fence:{sql:string;args:unknown[]})=>{
   const select=env.DB.prepare(`SELECT d.* FROM porthole_dashboards d WHERE d.id${id?'=':'>'}? AND ${current.sql} AND ${fence.sql} ORDER BY d.id LIMIT ?`).bind(id??cursor,...current.args,...fence.args,id?1:limit+1)
   if(!id)return [select]
   const condition=`h.id=? AND ${history.sql} AND EXISTS(SELECT 1 FROM porthole_dashboards d WHERE d.id=h.id AND ${current.sql}) AND ${fence.sql}`
   const args=[id,...history.args,...current.args,...fence.args]
   return [select,env.DB.prepare(`SELECT h.revision FROM porthole_dashboard_versions h WHERE ${condition} ORDER BY h.revision DESC`).bind(...args),...(version===undefined?[]:[env.DB.prepare(`SELECT h.* FROM porthole_dashboard_versions h WHERE ${condition} AND h.revision=?`).bind(...args,version)])]
  }
  let results:D1Result[]
  if(bearer) {
   const original=JSON.stringify({services:scope.services,environments:scope.environments,teams:scope.teams,signals})
   const auth=await credential({action:'definitions.read',scope:emptyScope,dataScope:allScope,writes(fence,latest) {
    if(JSON.stringify({services:latest.services,environments:latest.environments,teams:latest.teams,signals:latest.signals})!==original)fail('authority_changed',409)
    return statements(fence)
   }})
   results=auth.results
  } else results=await env.DB.batch(statements(live))
  const rows=results[0].results as unknown as DashboardRow[],headers={'x-porthole-actor':actorRef,'x-porthole-actor-revision':String(actorRevision)}
  if(!id)return json({objects:rows.slice(0,limit).map(row=>representation(row,scope,signals)),cursor:rows.length>limit?rows[limit-1].id:null},200,headers)
  if(!rows.length) {
   // Preserve the native app's explicit scope refusal. Bearer reads never
   // reveal whether an inaccessible definition exists.
   if(!principal&&!bearer&&await env.DB.prepare(`SELECT 1 AS present FROM porthole_dashboards WHERE id=? AND ${live.sql}`).bind(id,...live.args).first())fail('scope_forbidden')
   fail('dashboard_not_found',404)
  }
  const selected=version===undefined?rows[0]:(results[2].results as unknown as DashboardRow[])[0]
  if(!selected)fail('dashboard_version_not_found',404)
  const row=rows[0].state==='quarantined'?{...selected,state:'quarantined'}:selected
  return json({...representation(row,scope,signals),versions:results[1].results.map(row=>(row as {revision:number}).revision)},200,{...headers,etag:`"${row.revision}"`,'x-porthole-entity':id})
 } catch(error) {
  const known=error instanceof AuthError||error instanceof CredentialLimit,status=known?error.status:503,code=known?error.code:'dashboards_unavailable'
  return json({error:code,details:{code,status,requestId}},status,error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{})
 }
}
