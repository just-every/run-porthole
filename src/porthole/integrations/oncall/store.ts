import type {Bindings} from '../../../auth.server'
import {append} from '../../audit/store'

export interface Route {id:string;monitor_id:string;monitor_revision:number;source:string;destination_service:string;environment:string;configured_by:string;member_revision:number;operator_version:number;enabled:number;created_at:number}
interface Event {id:string;route_id:string;generation:string;intent:'trigger'|'recover';message:string;attempts:number;lease_id:string}
export const liveRoute=`EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id JOIN porthole_objects d ON d.id=r.monitor_id WHERE m.operator_id=r.configured_by AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=r.member_revision AND o.version=r.operator_version AND d.revision=r.monitor_revision AND d.state='active')`
export function configured(env:Bindings) {
 try {const url=new URL(env.ONCALL_ORIGIN!);return !!env.ONCALL_SERVICE && !!env.ONCALL_SOURCE_KEY && url.protocol==='https:' && url.origin===env.ONCALL_ORIGIN && !url.username && !url.password} catch{return false}
}
/** The evaluation, generation handoff and monitor state commit together. */
export function oncallEvaluationStatement(env:Bindings,evaluationId:string) {
 const generation="CASE WHEN e.status='Firing' THEN e.firing_episode ELSE p.firing_episode END"
 const intent="CASE WHEN e.status='Firing' THEN 'trigger' ELSE 'recover' END"
 const identity="r.id||':'||("+generation+")||':'||("+intent+")"
 return env.DB.prepare(`INSERT OR IGNORE INTO porthole_oncall_events(id,route_id,generation,intent,created_at,message,next_attempt_at)
 SELECT ${identity},r.id,${generation},${intent},e.evaluated_at,
 json_object('source',r.source,'eventId',${identity},'service',r.destination_service,'environment',r.environment,'key',r.id,'generation',${generation},'intent',${intent},'severity','warning','title',CASE WHEN e.status='Firing' THEN 'Porthole monitor firing' ELSE 'Porthole monitor recovered' END,'observedAt',strftime('%Y-%m-%dT%H:%M:%fZ',e.evaluated_at/1000.0,'unixepoch'),'evidence',?),e.evaluated_at
 FROM porthole_oncall_routes r JOIN porthole_monitor_evaluations e ON e.object_id=r.monitor_id AND e.revision=r.monitor_revision
 LEFT JOIN porthole_monitor_state p ON p.object_id=e.object_id AND p.revision=e.revision
 WHERE e.id=? AND r.enabled=1 AND e.evaluated_at>=r.created_at AND ${liveRoute}
 AND ((e.status='Firing' AND e.firing_episode IS NOT NULL) OR (e.status='Healthy' AND p.firing_episode IS NOT NULL))`)
 .bind(env.AUTH_ORIGIN+'/app/health',evaluationId)
}
/** A lost response never becomes a fresh send. Native event identities also
 * let the receiver reject changed content and deduplicate manual reconciliation. */
export async function deliverOncall(env:Bindings) {
 if(!configured(env))return {attempted:0,status:'oncall_binding_required'}
 const now=Date.now(),lease=crypto.randomUUID()
 await env.DB.prepare("UPDATE porthole_oncall_events SET state='uncertain',reason='Interrupted send; inspect the source event in Oncall before any replay',lease_id=NULL,lease_until=NULL WHERE state='sending' AND lease_until<=?").bind(now).run()
 await env.DB.prepare(`UPDATE porthole_oncall_events SET state='cancelled',reason='Route, monitor or owner authority changed' WHERE state='pending' AND NOT EXISTS(SELECT 1 FROM porthole_oncall_routes r WHERE r.id=route_id AND r.enabled=1 AND ${liveRoute})`).run()
 const event=await env.DB.prepare(`UPDATE porthole_oncall_events SET state='sending',lease_id=?,lease_until=?,attempts=attempts+1 WHERE id=(SELECT e.id FROM porthole_oncall_events e JOIN porthole_oncall_routes r ON r.id=e.route_id WHERE e.state='pending' AND e.next_attempt_at<=? AND e.attempts<5 AND r.enabled=1 AND ${liveRoute} AND (e.intent='trigger' OR EXISTS(SELECT 1 FROM porthole_oncall_events t WHERE t.route_id=e.route_id AND t.generation=e.generation AND t.intent='trigger' AND t.state='accepted')) ORDER BY e.created_at,e.id LIMIT 1) RETURNING *`).bind(lease,now+30000,now).first<Event>()
 if(!event)return {attempted:0,status:'idle'}
 const audit={operationRef:lease,actorRef:null,actorRevision:null,action:'oncall.deliver',entityRef:event.route_id,revision:null,occurredAt:now}
 try{await append(env.DB,{...audit,phase:'attempted',status:null})}catch{
  await env.DB.prepare("UPDATE porthole_oncall_events SET state='pending',reason='Audit unavailable; no send attempted',lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?").bind(event.id,lease).run()
  return {attempted:0,status:'audit_unavailable'}
 }
 let state='uncertain',reason='Response unknown; inspect the stable source event in Oncall',providerId:string|null=null,next=now+60000
 try {
  const current=await env.DB.prepare(`SELECT 1 FROM porthole_oncall_routes r WHERE r.id=? AND r.enabled=1 AND ${liveRoute}`).bind(event.route_id).first()
  if(!current){state='cancelled';reason='Owner authority changed before dispatch'}
  else {
   const payload=JSON.parse(event.message) as {source:string;eventId:string;service:string}
   const response=await env.ONCALL_SERVICE!.fetch(new Request(env.ONCALL_ORIGIN+'/api/ingress/'+encodeURIComponent(payload.source),{method:'POST',headers:{authorization:'Bearer '+env.ONCALL_SOURCE_KEY,'content-type':'application/json'},body:event.message,redirect:'manual',signal:AbortSignal.timeout(10000)}))
   if([401,403,404,409,410].includes(response.status)||response.status>=300&&response.status<400){state='rejected';reason='Oncall refused the event; owner must inspect scope, source key or event conflict'}
   else if(response.status===429){
    const retry=response.headers.get('retry-after'),seconds=retry&&/^\d+$/.test(retry)?Math.min(86400,Math.max(1,Number(retry))):60
    state=event.attempts<5?'pending':'rejected';next=Date.now()+seconds*1000;reason=state==='pending'?'Oncall rate limit; retry after the retained due time':'Retry limit reached; owner action required'
   } else if(response.status===200||response.status===201) {
    const reader=response.body?.getReader();let bytes=0,value=''
    if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>8192){await reader.cancel();throw Error('receipt_too_large')}value+=new TextDecoder().decode(chunk.value)}
    const receipt=JSON.parse(value) as Record<string,unknown>
    if(receipt.eventId===payload.eventId && receipt.service===payload.service && typeof receipt.id==='string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(receipt.id) && !receipt.truncation){state='accepted';providerId=receipt.id;reason='Oncall accepted this source event; human receipt, paging and incident resolution are not established'}
   }
  }
 }catch{ /* Never retain a network exception, response body or source key. */ }
 await env.DB.prepare('UPDATE porthole_oncall_events SET state=?,reason=?,provider_id=?,next_attempt_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?').bind(state,reason,providerId,next,event.id,lease).run()
 await append(env.DB,{...audit,phase:state==='accepted'?'succeeded':'failed',status:state==='accepted'?202:503})
 return {attempted:1,status:state}
}
export async function oncallSummary(env:Bindings) {
 const routes=(await env.DB.prepare(`SELECT r.*,${liveRoute} AS live FROM porthole_oncall_routes r ORDER BY r.created_at,r.id LIMIT 100`).all()).results
 const events=(await env.DB.prepare('SELECT id,route_id,generation,intent,created_at,state,attempts,next_attempt_at,provider_id,reason FROM porthole_oncall_events ORDER BY created_at DESC,id DESC LIMIT 100').all()).results
 return {configured:configured(env),routes,events,paging:'Oncall intake acceptance does not establish paging or a human response'}
}
