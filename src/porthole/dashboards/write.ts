import type {Bindings} from '../../auth.server'
import {fail,parseScope,scopeWithin,type Authority,type Scope} from '../security/authority'
import {input} from '../security/input'
import {canonical} from '../ingest/model'
import {privateHeaders} from '../document'
import {dashboardBody,label,scopeLabel,type Dashboard} from './model'
import {dashboardPolicy,nativeRelease} from '../authorization/dashboard-policy'
import {currentDashboard} from './store'
export async function writeDashboard(request:Request,env:Bindings,actor:Authority):Promise<Response> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/'),app='/app/dashboards'
 const result=(value:{id:string;revision:number;state:string},replayed:boolean)=>{
  const headers={...privateHeaders,'x-porthole-entity':value.id,'idempotency-replayed':String(replayed)}
  return page?new Response(null,{status:303,headers:{...headers,location:app+'/'+value.id}}):Response.json(value,{status:201,headers})
 }
  const data=await input(request),key=request.headers.get('idempotency-key')
  if(key!==null&&!/^[A-Za-z0-9._:-]{8,120}$/.test(key))fail('idempotency_key_required',400)
  const action=url.pathname.split('/').at(-1),allowed=action==='reorder'?['id','revision','panel','direction','order']:action==='clone'||action==='archive'?['id','revision']:action==='panel'?['id','revision','title','service','signal','metric','unit','widget','note','compareWeek']:action==='annotation'?['id','revision','at','label']:['id','revision','name','scope','body','service','environment','team','metric','from','through']
  if(Object.keys(data).some(key=>!allowed.includes(key)))fail('invalid_dashboard',400)
  const fingerprint=canonical({path:url.pathname,data})
  const lookup=()=>env.DB.prepare(`SELECT fingerprint,response FROM porthole_api_idempotency WHERE actor_ref=? AND request_key=? AND ${actor.fence}`).bind(actor.member.operatorId,key,...actor.args).first<{fingerprint:string;response:string}>()
  const cached=key?await lookup():null
  if(cached) {if(cached.fingerprint!==fingerprint)fail('idempotency_conflict',409);const value=JSON.parse(cached.response);const source=await currentDashboard(env,actor,typeof data.id==='string'?data.id:value.id,true);await nativeRelease(env,actor,[source],true);return result(value,true)}
  const previous=typeof data.id==='string'?await currentDashboard(env,actor,data.id,true):null,now=Date.now()
  if(previous&&Number(data.revision)!==previous.revision)fail('revision_or_authority_changed',409)
  let body:Dashboard,name:string,scope:Scope,state='active',id=previous?.id??crypto.randomUUID(),revision=(previous?.revision??0)+1
  if(url.pathname.endsWith('/clone')||url.pathname.endsWith('/reorder')||url.pathname.endsWith('/archive')||url.pathname.endsWith('/panel')||url.pathname.endsWith('/annotation')) {
   if(!previous)fail('dashboard_not_found',404)
   body=dashboardBody(JSON.parse(previous.body));name=previous.name;scope=JSON.parse(previous.scope)
   if(url.pathname.endsWith('/clone')) {id=crypto.randomUUID();revision=1;name+=' copy'}
   if(url.pathname.endsWith('/archive'))state=!page||previous.state!=='archived'?'archived':'active'
   if(url.pathname.endsWith('/panel')) {
    const signal=String(data.signal),aggregate=({metrics:'average',logs:'count',traces:'p95'} as const)[signal as 'metrics'|'logs'|'traces']
    body=dashboardBody({...body,panels:[...body.panels,{id:crypto.randomUUID(),title:data.title,service:data.service,signal,aggregate,metric:data.metric,...(data.widget?{widget:data.widget}:{}),...(data.compareWeek?{compareWeek:data.compareWeek===true||data.compareWeek==='on'}:{}),...(data.widget==='notes'?{note:data.note??''}:{}),unit:signal==='logs'?'records':signal==='traces'?'ms':data.unit??''}]})
   }
   if(url.pathname.endsWith('/annotation'))body=dashboardBody({...body,annotations:[...body.annotations,{at:data.at,label:data.label}]})
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
  const gate=dashboardPolicy('d',actor.member.operatorId,true)
  const source=previous?` AND EXISTS(SELECT 1 FROM porthole_dashboards d WHERE d.id=? AND d.revision=? AND ${gate.sql})`:''
  const sourceArgs=previous?[previous.id,previous.revision,...gate.args]:[]
  const live=`${actor.fence}${source}`,liveArgs=[...actor.args,...sourceArgs]
  const guard=key?`${live} AND NOT EXISTS(SELECT 1 FROM porthole_api_idempotency WHERE actor_ref=? AND request_key=?)`:live,args=key?[...liveArgs,actor.member.operatorId,key]:liveArgs
  const statement=inserting?env.DB.prepare(`INSERT INTO porthole_dashboards SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(id,name,JSON.stringify(scope),JSON.stringify(body),revision,state,now,now,...args):env.DB.prepare(`UPDATE porthole_dashboards SET name=?,scope=?,body=?,revision=?,state=?,updated_at=? WHERE id=? AND revision=? AND ${guard}`).bind(name,JSON.stringify(scope),JSON.stringify(body),revision,state,now,id,previous.revision,...args)
  const value={id,revision,state}
  const clonePolicy=inserting&&previous?[env.DB.prepare(`INSERT INTO porthole_dashboard_policies SELECT ?,1,'[]','active',? WHERE EXISTS(SELECT 1 FROM porthole_dashboards WHERE id=?) AND EXISTS(SELECT 1 FROM porthole_dashboard_policies WHERE dashboard_id=?) AND ${actor.fence}`).bind(id,now,id,previous.id,...actor.args)]:[]
  if(key) {
   const writes=await env.DB.batch([statement,env.DB.prepare(`INSERT OR IGNORE INTO porthole_api_idempotency SELECT ?,?,?,?,?,? WHERE changes()=1 AND ${actor.fence}`).bind(actor.member.operatorId,key,fingerprint,JSON.stringify(value),201,now,...actor.args),...clonePolicy])
   const receipt=await lookup()
   if(!receipt)fail('revision_or_authority_changed',409)
   if(receipt.fingerprint!==fingerprint)fail('idempotency_conflict',409)
   const committed=JSON.parse(receipt.response)
   if(previous&&inserting)await nativeRelease(env,actor,[previous],true)
   else await nativeRelease(env,actor,[{id:committed.id,revision:committed.revision}],true)
   return result(committed,!writes[0].meta.changes)
  }
  const writes=await env.DB.batch([statement,...clonePolicy])
  if(!writes[0].meta.changes)fail('revision_or_authority_changed',409)
  if(previous&&inserting)await nativeRelease(env,actor,[previous],true)
  else await nativeRelease(env,actor,[{id,revision}],true)
  return result(value,false)
}
