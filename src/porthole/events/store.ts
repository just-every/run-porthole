import type {Bindings} from '../../auth.server'
import {authority,fail,scopeWithin,type Authority} from '../security/authority'
import {eventScope,eventDigest,representation,eventFacets,type EventRow,type CustomEvent,type EventFilter} from './model'
import {canonical} from '../ingest/model'
import {digest} from '../audit/store'
import {timestamp} from '../dashboards/model'

export function visible(actor:Authority,alias='e') {
 const clauses=[`${alias}.state='active'`,`NOT EXISTS(SELECT 1 FROM porthole_erased_actors erased WHERE erased.actor_ref=${alias}.actor_ref)`,actor.fence],args:unknown[]=[...actor.args]
 for(const [plural,singular]of [['services','service'],['environments','environment'],['teams','team']] as const) {
  clauses.push(`EXISTS(SELECT 1 FROM json_each(?) held WHERE held.value='*' OR held.value=${alias}.${singular})`);args.push(JSON.stringify(actor.member.scope[plural]))
 }
 return {sql:clauses.join(' AND '),args}
}
export async function release(env:Bindings,actor:Authority,ids:string[]=[] ) {
 if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
 if(ids.length) {
  const gate=visible(actor),found=await env.DB.prepare(`SELECT COUNT(*) AS n FROM porthole_custom_events e WHERE e.id IN (SELECT value FROM json_each(?)) AND ${gate.sql}`).bind(JSON.stringify(ids),...gate.args).first<{n:number}>()
  if(found?.n!==new Set(ids).size)fail('event_evidence_changed',409)
 }
}
export async function eventById(env:Bindings,actor:Authority,id:string):Promise<EventRow|null> {
 const gate=visible(actor)
 return env.DB.prepare(`SELECT e.* FROM porthole_custom_events e WHERE e.id=? AND ${gate.sql}`).bind(id,...gate.args).first<EventRow>()
}
export async function createEvent(env:Bindings,actor:Authority,value:CustomEvent) {
 if(actor.member.role!=='owner')fail('event_owner_required')
 if(!scopeWithin(eventScope(value),actor.member.scope))fail('scope_forbidden')
 const hash=await eventDigest(value),id=crypto.randomUUID(),now=Date.now()
 await env.DB.prepare(`INSERT INTO porthole_custom_events(id,source,source_id,service,environment,team,occurred_ns,received_at,body,digest,actor_ref,actor_revision,state)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'active' WHERE ${actor.fence} AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=?) ON CONFLICT(source,source_id) DO NOTHING`)
 .bind(id,value.source,value.sourceId,value.service,value.environment,value.team,value.occurredAt,now,canonical(value),hash,actor.member.operatorId,actor.member.revision,...actor.args,actor.member.operatorId).run()
 const gate=visible(actor),row=await env.DB.prepare(`SELECT e.* FROM porthole_custom_events e WHERE e.source=? AND e.source_id=? AND ${gate.sql}`).bind(value.source,value.sourceId,...gate.args).first<EventRow>()
 if(!row)fail('event_identity_or_authority_conflict',409)
 if(row.digest!==hash||row.actor_ref!==actor.member.operatorId)fail('event_identity_conflict',409)
 await release(env,actor,[row.id])
 return {event:representation(row),replayed:row.id!==id}
}
interface Cursor {snapshot:number;time:string;id:string;binding:string}
async function key(env:Bindings) {return crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
const decode=(v:string)=>Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
async function pack(env:Bindings,value:Cursor) {
 const raw=new TextEncoder().encode(JSON.stringify(value)),signature=await crypto.subtle.sign('HMAC',await key(env),raw)
 return encode(raw)+'.'+encode(new Uint8Array(signature))
}
async function unpack(env:Bindings,value:string):Promise<Cursor> {
 try {
  const parts=value.split('.');if(parts.length!==2||value.length>2000)throw Error()
  const raw=decode(parts[0]);if(!await crypto.subtle.verify('HMAC',await key(env),decode(parts[1]),raw))throw Error()
  const v=JSON.parse(new TextDecoder().decode(raw)) as Cursor
  if(!Number.isSafeInteger(v.snapshot)||v.snapshot<0||typeof v.binding!=='string'||!(v.time===''&&v.id===''||timestamp(v.time)===v.time&&/^[a-f0-9-]{36}$/.test(v.id)))throw Error()
  return v
 }catch{fail('invalid_event_cursor',400)}
}
export async function searchEvents(env:Bindings,actor:Authority,filter:EventFilter,limit=50,cursor?:string) {
 for(const [singular,plural]of [['service','services'],['environment','environments'],['team','teams']] as const)if(filter[singular]&&!actor.member.scope[plural].some(x=>x==='*'||x===filter[singular]))fail('scope_forbidden')
 const binding=await digest(canonical({filter,actor:actor.member.operatorId,revision:actor.member.revision,session:actor.session.id})),gate=visible(actor)
 const current=cursor?await unpack(env,cursor):null
 if(current&&current.binding!==binding)fail('event_cursor_context_changed',409)
 const snapshot=current?.snapshot??(await env.DB.prepare(`SELECT COALESCE(MAX(e.sequence),0) AS n FROM porthole_custom_events e WHERE ${gate.sql}`).bind(...gate.args).first<{n:number}>())!.n
 const clauses=[gate.sql,'e.sequence<=?'],args:unknown[]=[...gate.args,snapshot]
 for(const [name,value]of Object.entries(filter)) {
  if(name==='from'||name==='through') {clauses.push(`e.occurred_ns${name==='from'?'>=':'<='}?`);args.push(value)}
  else if(name==='text') {clauses.push(`(instr(lower(json_extract(e.body,'$.title')),lower(?))>0 OR instr(lower(json_extract(e.body,'$.text')),lower(?))>0)`);args.push(value,value)}
  else if(name==='sourceId') {clauses.push('e.source_id=?');args.push(value)}
  else if(name==='tag') {clauses.push("EXISTS(SELECT 1 FROM json_each(e.body,'$.tags') tag WHERE tag.value=?)");args.push(value)}
  else if(['severity','resource','correlationKey'].includes(name)) {clauses.push(`json_extract(e.body,'$.${name}')=?`);args.push(value)}
  else {clauses.push(`e.${name}=?`);args.push(value)}
 }
 if(current?.time) {clauses.push('(e.occurred_ns>? OR (e.occurred_ns=? AND e.id>?))');args.push(current.time,current.time,current.id)}
 const rows=(await env.DB.prepare(`SELECT e.* FROM porthole_custom_events e WHERE ${clauses.join(' AND ')} ORDER BY e.occurred_ns,e.id LIMIT ?`).bind(...args,limit+1).all<EventRow>()).results
 const selected=rows.slice(0,limit),last=selected.at(-1)
 const next=rows.length>limit&&last?await pack(env,{snapshot,time:last.occurred_ns,id:last.id,binding}):null
 const pageCursor=cursor??await pack(env,{snapshot,time:'',id:'',binding})
 await release(env,actor,selected.map(row=>row.id))
 const events=selected.map(representation)
 return {events,snapshot,cursor:next,pageCursor,facets:eventFacets(events)}
}
export async function overlayRows(request:Request,env:Bindings,ids:string[]) {
 if(!ids.length)return []
 if(request.headers.has('authorization'))return ids.map(()=>null)
 const actor=await authority(request,env)
 if(actor.member.role==='finance reader')fail('events_forbidden')
 const rows=await Promise.all(ids.map(id=>eventById(env,actor,id)))
 await release(env,actor,rows.filter((row):row is EventRow=>!!row).map(row=>row.id))
 return rows.map(row=>row?representation(row):null)
}
