import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {customEvent,eventFilter,representation,type FilterRow} from './model'
import {createEvent,eventById,searchEvents,release} from './store'
import {label} from '../dashboards/model'
import {eventsPage,settingsPage,detailPage} from './page'
const api='/api/porthole/v1/events',app='/app/events',settings='/app/settings/events'
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...headers}})
export async function eventsResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith(app)||url.pathname.startsWith(settings)
 if(![api,api+'/filters',app,app+'/filters',settings,settings+'/create'].includes(url.pathname)&&!/^\/(?:api\/porthole\/v1\/events|app\/events)\/[a-f0-9-]{36}$/.test(url.pathname))return null
 try {
  const actor=await authority(request,env,{post:request.method==='POST'})
  if(actor.member.role==='finance reader')fail('events_forbidden')
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  const filters=async()=> (await env.DB.prepare(`SELECT * FROM porthole_event_filters WHERE owner_ref=? AND state='active' AND ${actor.fence} ORDER BY name,id`).bind(actor.member.operatorId,...actor.args).all<FilterRow>()).results
  if(request.method==='POST') {
   if(url.search)fail('invalid_event_query',400)
   const data=await input(request)
   if(url.pathname.endsWith('/filters')) {
    if(Object.keys(data).some(k=>!['id','revision','name','definition'].includes(k)))fail('invalid_event_filter',400)
    const definition=eventFilter(typeof data.definition==='string'?JSON.parse(data.definition):data.definition),name=label(data.name),id=typeof data.id==='string'?data.id:crypto.randomUUID(),revision=data.id?Number(data.revision)+1:1
    if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(revision)||revision<1)fail('invalid_event_filter',400)
    // Resolving the proposed search validates its scope without storing results.
    await searchEvents(env,actor,definition,1)
    const result=data.id?await env.DB.prepare(`UPDATE porthole_event_filters SET name=?,definition=?,revision=? WHERE id=? AND owner_ref=? AND revision=? AND state='active' AND ${actor.fence}`).bind(name,JSON.stringify(definition),revision,id,actor.member.operatorId,revision-1,...actor.args).run():await env.DB.prepare(`INSERT INTO porthole_event_filters SELECT ?,?,?,?,1,'active',? WHERE ${actor.fence}`).bind(id,actor.member.operatorId,name,JSON.stringify(definition),Date.now(),...actor.args).run()
    if(!result.meta.changes)fail('revision_or_authority_changed',409)
    await release(env,actor)
    return page?new Response(null,{status:303,headers:{...privateHeaders,location:app+'?filter='+id}}):json({id,name,definition,revision},201,{'x-porthole-entity':id})
   }
   if(url.pathname!==api&&url.pathname!==settings+'/create')fail('method_not_allowed',405)
   const {event,replayed}=await createEvent(env,actor,customEvent(data))
   return page?new Response(null,{status:303,headers:{...privateHeaders,location:app+'/'+event.id}}):json({event,replayed},201,{'x-porthole-entity':event.id,'idempotency-replayed':String(replayed)})
  }
  if(url.pathname===settings) {if(url.search)fail('invalid_event_query',400);return settingsPage(actor.member.role==='owner')}
  if(url.pathname===api+'/filters') {if(url.search)fail('invalid_event_query',400);const rows=await filters();await release(env,actor);return json({filters:rows.map(row=>({...row,definition:JSON.parse(row.definition)}))})}
  if(url.pathname!==api&&url.pathname!==app) {
   if(url.search)fail('invalid_event_query',400)
   const event=await eventById(env,actor,url.pathname.split('/').at(-1)!)
   if(!event)fail('event_not_found',404)
   await release(env,actor,[event.id])
   return page?detailPage(representation(event)):json({event:representation(event)})
  }
  if([...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1))fail('invalid_event_query',400)
  const params=Object.fromEntries(url.searchParams),{limit:rawLimit,cursor,filter:filterId,...fields}=params
  const limit=Number(rawLimit??50)
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('invalid_event_limit',400)
  let filter=eventFilter(fields)
  const saved=await filters()
  if(filterId) {
   if(Object.keys(fields).length)fail('invalid_event_query',400)
   const row=saved.find(row=>row.id===filterId);if(!row)fail('event_filter_not_found',404)
   filter=eventFilter(JSON.parse(row.definition))
  }
  const result=await searchEvents(env,actor,filter,limit,cursor)
  return page?eventsPage(result.events,filter,saved,result.cursor,url):json(result)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_event':'events_unavailable'
  return page?document('Events unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${app}">Return to Events</a></p>`,status):json({error:code,details:{status,code,requestId:crypto.randomUUID()}},status)
 }
}
