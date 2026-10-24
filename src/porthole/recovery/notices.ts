import { confirmedRecipient, liveConfigurer } from '../health/recipients'
import {frozenNotice,submitNotice,independentMailConfigured,NoticeConfigurationChanged,noticeGrant} from './mail'
import { append, type AuditInput } from '../audit/store'
import type { HealthBindings, HealthState } from '../health/model'
import { healthConfiguration, recordComponentReceipt } from '../health/receipts'

interface Notice {id:string;first_attempt_at:number|null;created_at:number;message:string;lease_id:string;configuration_revision:number;attempts:number;had_uncertain:number;transport_grant:string|null}
// Resend retains idempotency keys for 24 hours. Stop early rather than create a
// second email after an uncertain request outlives provider deduplication.
const retryWindow = 23*3600000
export async function reconcileHealthIncidents(env: HealthBindings, state: HealthState) {
 const config=await healthConfiguration(env.DB)
 if (!config.notices_enabled || !config.recipient || !await env.DB.prepare(`SELECT 1 FROM porthole_health_configuration c WHERE c.singleton=1 AND ${confirmedRecipient} AND ${liveConfigurer}`).first()) return
 const now=Date.now(),grant=await noticeGrant(env)
 for (const row of state.components) {
  if (row.component==='control-plane') continue // A dead control plane cannot notify itself.
  if (row.status==='Unknown' && (!row.observedAt || row.reason.startsWith('Not configured:'))) continue
  const episode=crypto.randomUUID(),noticeId=crypto.randomUUID()
  const message=frozenNotice(env,noticeId,config.recipient,`Porthole ${row.status==='Unknown'?'failure':'recovery'}: ${row.component}`,
   `${row.component}: ${row.status}\n${row.reason}\nObserved ${state.checkedAt}\nLast accepted: ${row.lastAcceptedAt??'unknown'}\nLast queryable: ${row.lastQueryableAt??'unknown'}\nInspect ${env.AUTH_ORIGIN}/app/health. Unknown means incomplete coverage. This notice authorizes no repair.`)
  if (row.status==='Unknown') {
   await env.DB.batch([
    env.DB.prepare(`INSERT INTO porthole_health_incidents(component,episode,opened_at) VALUES(?,?,?) ON CONFLICT(component) DO UPDATE SET episode=excluded.episode,opened_at=excluded.opened_at,resolved_at=NULL WHERE resolved_at IS NOT NULL`).bind(row.component,episode,now),
    env.DB.prepare(`INSERT OR IGNORE INTO porthole_health_notices(id,episode,component,phase,configuration_revision,created_at,next_attempt_at,message,transport_grant)
     SELECT ?,i.episode,i.component,'failure',?,?,?,?,? FROM porthole_health_incidents i WHERE i.component=? AND i.resolved_at IS NULL
     AND EXISTS(SELECT 1 FROM porthole_health_configuration c WHERE singleton=1 AND revision=? AND notices_enabled=1 AND ${confirmedRecipient} AND ${liveConfigurer})`).bind(noticeId,config.revision,now,now,message,grant,row.component,config.revision),
   ])
  } else {
   await env.DB.batch([
    env.DB.prepare(`UPDATE porthole_health_incidents SET resolved_at=? WHERE component=? AND resolved_at IS NULL`).bind(now,row.component),
    env.DB.prepare(`INSERT OR IGNORE INTO porthole_health_notices(id,episode,component,phase,configuration_revision,created_at,next_attempt_at,message,transport_grant)
     SELECT ?,i.episode,i.component,'recovery',?,?,?,?,? FROM porthole_health_incidents i WHERE i.component=? AND i.resolved_at=?
     AND EXISTS(SELECT 1 FROM porthole_health_notices n WHERE n.episode=i.episode AND n.phase='failure' AND n.state!='cancelled')
     AND EXISTS(SELECT 1 FROM porthole_health_configuration c WHERE singleton=1 AND revision=? AND notices_enabled=1 AND ${confirmedRecipient} AND ${liveConfigurer})`).bind(noticeId,config.revision,now,now,message,grant,row.component,now,config.revision),
   ])
  }
 }
}

/** One real external submission per tick, protected by a durable lease and
 * provider idempotency. The exact frozen body survives process termination. */
export async function deliverHealthNotice(env: HealthBindings): Promise<{attempted:number;status:string}> {
 if (env.AUTH_LOCAL==='true' || env.RER_DEMO==='1') return {attempted:0,status:'development_suppressed'}
 if (!independentMailConfigured(env)) return {attempted:0,status:'unconfigured'}
 const config=await healthConfiguration(env.DB)
 if (!config.notices_enabled) return {attempted:0,status:'disabled'}
 const authorized=await env.DB.prepare(`SELECT 1 FROM porthole_health_configuration c WHERE c.singleton=1 AND ${confirmedRecipient} AND ${liveConfigurer}`).first()
 if (!authorized) return {attempted:0,status:'recipient_not_authorized'}
 const now=Date.now(), lease=crypto.randomUUID(),idempotent=env.MAIL_PROVIDER==='resend'
 if(!idempotent)await env.DB.prepare(`UPDATE porthole_health_notices SET state='uncertain',lease_id=NULL,lease_until=NULL WHERE first_attempt_at IS NOT NULL AND (state='pending' OR (state='sending' AND lease_until<?))`).bind(now).run()
 await env.DB.prepare(`UPDATE porthole_health_notices SET state='uncertain',lease_id=NULL,lease_until=NULL WHERE state IN ('pending','sending') AND first_attempt_at IS NOT NULL AND first_attempt_at<=?`).bind(now-retryWindow).run()
 const notice=await env.DB.prepare(`UPDATE porthole_health_notices SET had_uncertain=CASE WHEN state='sending' THEN 1 ELSE had_uncertain END,state='sending',lease_id=?,lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?)
  WHERE id=(SELECT n.id FROM porthole_health_notices n WHERE n.configuration_revision=? AND ((n.state='pending' AND n.next_attempt_at<=?) OR (n.state='sending' AND n.lease_until<?))
   AND (n.first_attempt_at IS NULL OR n.first_attempt_at>?)
   AND (n.phase='failure' OR EXISTS(SELECT 1 FROM porthole_health_notices f WHERE f.episode=n.episode AND f.phase='failure' AND f.state='accepted'))
   ORDER BY n.created_at,n.id LIMIT 1)
  AND EXISTS(SELECT 1 FROM porthole_health_configuration c JOIN oa_operators o ON o.id=c.configured_by JOIN porthole_members m ON m.operator_id=o.id WHERE c.singleton=1 AND c.notices_enabled=1 AND c.revision=? AND o.status='active' AND o.role=m.role AND m.role IN ('owner','admin') AND ${confirmedRecipient}) RETURNING *`)
 .bind(lease,now+60000,now,config.revision,now,now,now-retryWindow,config.revision).first<Notice>()
 if (!notice) return {attempted:0,status:'idle'}
 const audit:AuditInput={operationRef:lease,actorRef:null,actorRevision:null,action:'health.notice',entityRef:notice.id,revision:notice.configuration_revision,phase:'attempted',status:null,occurredAt:now}
 try { await append(env.DB,audit) } catch {
  await env.DB.prepare(`UPDATE porthole_health_notices SET state='pending',first_attempt_at=CASE WHEN attempts=1 THEN NULL ELSE first_attempt_at END,next_attempt_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?`).bind(Date.now()+60000,notice.id,lease).run()
  return {attempted:0,status:'audit_unavailable'}
 }
 let status:'accepted'|'rejected'|'pending'|'uncertain'=idempotent?'pending':'uncertain', providerId:string|null=null,rateLimited=false,configurationChanged=false,nextAttemptAt=Date.now()+60000
 try {
  const result=await submitNotice(env,notice.message,config.recipient!,notice.transport_grant)
  providerId=result.providerMessageId
  rateLimited=result.status==='rate_limited'
  if(rateLimited)nextAttemptAt=result.retryAfter??Date.now()+60000
  status=result.status==='accepted'?'accepted':result.status==='rejected'?'rejected':rateLimited||idempotent?'pending':'uncertain'
 } catch(error) {
  if(error instanceof NoticeConfigurationChanged){configurationChanged=true;status=notice.had_uncertain===1?'uncertain':'rejected'}
  // Other unknown outcomes retain the same provider identity and retry fence.
 }
 // A later refusal cannot establish what happened on a prior unknown attempt.
 // Hold the original receipt for reconciliation rather than invite a new send.
 if(idempotent&&notice.had_uncertain===1&&status==='rejected')status='uncertain'
 // A 429 certifies no acceptance. Clear only the non-idempotent uncertainty
 // marker; attempts/audit retain the refusal. Resend retains its original window.
 await env.DB.prepare(`UPDATE porthole_health_notices SET state=?,provider_id=?,next_attempt_at=?,had_uncertain=CASE WHEN ? THEN 1 ELSE had_uncertain END,first_attempt_at=CASE WHEN ? THEN NULL ELSE first_attempt_at END,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?`).bind(status,providerId,nextAttemptAt,status==='uncertain'||status==='pending'&&!rateLimited?1:0,rateLimited&&!idempotent?1:0,notice.id,lease).run()
 await append(env.DB,{...audit,phase:status==='accepted'?'succeeded':'failed',status:status==='accepted'?202:status==='rejected'?422:503})
 await recordComponentReceipt(env.DB,{component:'delivery',source:'independent-mail',status:status==='accepted'?'Healthy':'Unknown',reason:configurationChanged?'Notice transport grant changed; automatic submission is held. Review the original notice and provider account before authorizing another message.':status==='accepted'?'Independent mail provider accepted the durable notice; mailbox delivery is not established.':status==='rejected'?'Independent mail provider rejected the notice; owner action required.':rateLimited?'Independent mail provider refused this attempt for a rate limit; the same durable notice will retry after the provider deadline.':idempotent&&status==='pending'?'Independent mail result uncertain; durable retry retains the exact idempotency key.':'Independent mail result uncertain; automatic resubmission is stopped. Reconcile the original notice with the provider before authorizing another message.',evidence:{noticeId:notice.id,providerStatus:status,providerId,...(configurationChanged?{configurationChanged:true}:{}),...(rateLimited?{acceptance:'not_accepted',nextAttemptAt}:{})}})
 return {attempted:1,status}
}
export async function noticeSummary(db:D1Database) {
 return (await db.prepare(`SELECT id,component,phase,state,created_at,first_attempt_at,next_attempt_at,attempts,provider_id,had_uncertain FROM porthole_health_notices ORDER BY created_at DESC,id DESC LIMIT 50`).all()).results
}
