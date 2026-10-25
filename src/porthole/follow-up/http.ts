import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { authority,fail,proofFence,scopeWithin,memberFor } from '../security/authority'
import { input,text } from '../security/input'
import { operationDocument as document,escape,privateHeaders } from '../document'
import type { Task } from './store'
const paths=new Set(['/app/follow-up','/app/settings/follow-up','/app/settings/follow-up/review','/api/porthole/v1/follow-up','/api/porthole/v1/follow-up/review'])
const reviewDetail=(event:Record<string,unknown>)=>{if(event.kind!=='review')return escape(String(event.detail));try{const value=JSON.parse(String(event.detail));return escape(String(value.note))+' · Due '+escape(new Date(value.dueAt).toISOString())+' · Reminders '+escape(String(value.reminders))}catch{return 'Review retained in private history.'}}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function followUpResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith('/app/')
 if(!paths.has(url.pathname))return null
 try {
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(request.method==='POST'&&actor.member.role!=='owner')fail('owner_required')
  if(url.search)fail('invalid_query',400)
  if(url.pathname.startsWith('/app/settings/')&&actor.member.role!=='owner')fail('owner_required')
  if(request.method==='GET'&&!url.pathname.endsWith('/review')) {
   const tasks=(await env.DB.prepare(`SELECT * FROM porthole_follow_up WHERE ${actor.fence} ORDER BY state,due_at,id`).bind(...actor.args).all<Task>()).results.filter(row=>actor.member.role==='owner'||row.owner_id===actor.member.operatorId&&scopeWithin(JSON.parse(row.scope),actor.member.scope))
   const events=(await env.DB.prepare(`SELECT * FROM porthole_follow_up_events WHERE ${actor.fence} ORDER BY occurred_at,id`).bind(...actor.args).all()).results.filter(row=>tasks.some(task=>task.id===row.task_id))
   if(!page)return json({tasks,events})
   const members=(await env.DB.prepare("SELECT o.id,o.display_name FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND m.role IN ('owner','admin','maintainer','responder') ORDER BY o.id").all<{id:string;display_name:string}>()).results
   const monitors=(await env.DB.prepare("SELECT id,name,scope FROM porthole_objects WHERE kind='monitor' AND state='active' ORDER BY name,id").all<{id:string;name:string;scope:string}>()).results
   return document('Follow-up',`<p>Accountable work from pipeline failures, original provider sends, monitors and pending repairs. Only measured recovery on an unchanged monitor resolves telemetry work.</p><p><a href="/app/operations">Review exact repairs</a> · <a href="/app/settings/members">Review members</a> · <a href="/app/settings/follow-up">Reminder settings and handover</a></p>${tasks.length?tasks.map(row=>`<article data-task-id="${row.id}"><h2>${escape(row.kind)} · ${escape(row.state)}</h2><p>${escape(JSON.parse(row.scope).services.join(', ')==='*'?'Installation':JSON.parse(row.scope).services.join(', '))}</p><p>Owner: ${escape(members.find(m=>m.id===row.owner_id)?.display_name??'Unassigned — owner review required')} · Due: ${escape(new Date(row.due_at).toISOString())}</p><p>${escape(row.reason)}</p><p>Next action: ${escape(row.next_action)}</p><p>Guard: ${escape(monitors.find(m=>m.id===row.guard_id)?.name??(row.guard_id?'Original monitor no longer active':'Not selected'))} · original revision ${row.guard_revision??'none'} · generation ${row.generation}</p>${url.pathname==='/app/settings/follow-up'?`<details><summary>Review assignment and reminders</summary><form method="post" action="/app/settings/follow-up/review"><input type="hidden" name="id" value="${row.id}"><input type="hidden" name="revision" value="${row.revision}"><label>Owner <select name="ownerId"><option value="">Explicitly unassign</option>${members.map(m=>`<option value="${m.id}"${m.id===row.owner_id?' selected':''}>${escape(m.display_name)}</option>`).join('')}</select></label><label>Due time (UTC) <input name="dueAt" type="datetime-local" step="1" value="${new Date(row.due_at).toISOString().slice(0,19)}" required></label><label>Next action <input name="nextAction" value="${escape(row.next_action)}" required maxlength="500"></label><label>Review note or dissent <textarea name="note" required maxlength="500"></textarea></label>${!row.guard_id&&row.kind==='telemetry'?`<label>Recovery monitor <select name="guardId"><option value="">Keep blocked without a guard</option>${monitors.filter(m=>scopeWithin(JSON.parse(row.scope),JSON.parse(m.scope))).map(m=>`<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select></label>`:''}<label>Reminders <select name="reminders"><option value="off">Off</option><option value="on"${row.reminders?' selected':''}>One in-app reminder per generation</option></select></label><label>Suppress until (UTC; blank means off) <input name="suppressedUntil" type="datetime-local" step="1" value="${row.suppressed_until?new Date(row.suppressed_until).toISOString().slice(0,19):''}"></label><label><input type="checkbox" name="confirm" value="review" required> Approve this assignment, due time and reminder policy</label><button>Save reviewed handover</button></form></details>`:''}<p>${events.filter(e=>e.task_id===row.id).map(e=>escape(String(e.kind))+': '+reviewDetail(e)).join('<br>')||'No review or reminder yet.'}</p></article>`).join(''):'<p>No due work yet. Pipeline evaluation records failures here.</p>'}`,200,{forms:true})
  }
  if(request.method!=='POST'||!url.pathname.endsWith('/review'))fail('method_not_allowed',405)
  const data=await input(request),id=text(data.id,36),row=await env.DB.prepare('SELECT * FROM porthole_follow_up WHERE id=?').bind(id).first<Task>()
  if(!row)fail('task_not_found',404)
  if(data.confirm!=='review')fail('review_required',400)
  const ownerId=data.ownerId?text(data.ownerId,36):null,next=text(data.nextAction,500),note=text(data.note,500),due=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?Date.parse(String(data.dueAt)+'Z'):Number(data.dueAt),suppressed=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?(data.suppressedUntil?Date.parse(String(data.suppressedUntil)+'Z'):0):Number(data.suppressedUntil??0)
  if(!Number.isSafeInteger(due)||due<0||!Number.isFinite(new Date(due).getTime())||!Number.isSafeInteger(suppressed)||suppressed<0||!Number.isFinite(new Date(suppressed).getTime())||!['on','off'].includes(String(data.reminders)))fail('invalid_policy',400)
  let successorFence='1',successorArgs:unknown[]=[]
  if(ownerId) {
   const member=await memberFor(env.DB,ownerId)
   if(!member||!['owner','admin','maintainer','responder'].includes(member.role)||!scopeWithin(JSON.parse(row.scope),member.scope))fail('successor_scope_forbidden')
   successorFence="EXISTS(SELECT 1 FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.id=? AND o.status='active' AND m.revision=? AND m.role IN ('owner','admin','maintainer','responder') AND o.role=CASE WHEN m.role IN ('owner','admin') THEN m.role ELSE 'member' END)";successorArgs=[ownerId,member.revision]
  }
  let guard=row.guard_id,guardRevision=row.guard_revision
  if(data.guardId&&!guard) {
   const monitor=await env.DB.prepare("SELECT id,revision,scope FROM porthole_objects WHERE id=? AND kind='monitor' AND state='active'").bind(text(data.guardId,36)).first<{id:string;revision:number;scope:string}>()
   if(!monitor||!scopeWithin(JSON.parse(row.scope),JSON.parse(monitor.scope)))fail('guard_unavailable',409)
   guard=monitor.id;guardRevision=monitor.revision
  }
  const proof=proofFence(actor),now=Date.now(),eventId=crypto.randomUUID()
  const result=await env.DB.batch([
   env.DB.prepare(`UPDATE porthole_follow_up SET owner_id=?,due_at=?,next_action=?,reminders=?,suppressed_until=?,guard_id=?,guard_revision=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND ${actor.fence} AND ${proof.sql} AND ${successorFence}`).bind(ownerId,due,next,data.reminders==='on'?1:0,suppressed,guard,guardRevision,now,id,Number(data.revision),...actor.args,...proof.args,...successorArgs),
   env.DB.prepare(`INSERT INTO porthole_follow_up_events SELECT ?,id,generation,'review',?,?,? FROM porthole_follow_up WHERE id=? AND changes()=1`).bind(eventId,actor.member.operatorId,JSON.stringify({previousOwner:row.owner_id,owner:ownerId,note,dueAt:due,nextAction:next,reminders:data.reminders,suppressedUntil:suppressed}),now,id),
  ])
  if(!result[0].meta.changes)fail('revision_or_authority_changed',409)
  return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/settings/follow-up'}}):json({id,revision:row.revision+1})
 } catch(error) {
  const code=error instanceof AuthError?error.code:'follow_up_unavailable',status=error instanceof AuthError?error.status:503
  return page?document('Follow-up unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/settings/follow-up">Return to Follow-up</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
