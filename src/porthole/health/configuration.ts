import type { HealthBindings } from './model'
import { authority, fail, proofFence } from '../security/authority'
import { healthConfiguration } from './receipts'
import { input } from '../security/input'

export async function configureHealth(request: Request, env: HealthBindings) {
 const actor=await authority(request,env,{post:true,stepUp:true})
 if (actor.member.role!=='owner') fail('owner_required')
 if (actor.session.kind!=='native') fail('native_session_required')
 const data=await input(request), previous=await healthConfiguration(env.DB), proof=proofFence(actor)
 if (Object.keys(data).some(key=>!['revision','freshnessSeconds','noticesEnabled','recipient','confirm'].includes(key))) fail('invalid_input',400)
 const revision=Number(data.revision), freshness=Number(data.freshnessSeconds)
 const enabled=data.noticesEnabled===true || data.noticesEnabled==='yes'
 if (!Number.isSafeInteger(revision) || revision!==previous.revision) fail('health_configuration_changed',409)
 if (!Number.isSafeInteger(freshness) || freshness<10 || freshness>3600) fail('invalid_freshness',400)
 if (data.noticesEnabled!==undefined && ![true,false,'yes','no'].includes(data.noticesEnabled as boolean|string)) fail('invalid_input',400)
 const recipient=enabled && typeof data.recipient==='string'?data.recipient.trim():null
 if (enabled && (!recipient || recipient.length>254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(recipient))) fail('invalid_recipient',400)
 if (enabled && data.confirm!=='enable-independent-notices') fail('explicit_notice_confirmation_required',400)
 if (enabled && (!env.PORTHOLE_HEALTH_MAIL_KEY || !env.PORTHOLE_HEALTH_MAIL_FROM) && env.AUTH_LOCAL!=='true' && env.RER_DEMO!=='1') fail('independent_mail_bindings_required',409)
 const now=Date.now()
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE porthole_health_configuration SET revision=revision+1,freshness_ms=?,notices_enabled=?,recipient=?,configured_by=?,changed_at=? WHERE singleton=1 AND revision=? AND ${actor.fence} AND ${proof.sql} RETURNING revision`)
   .bind(freshness*1000,enabled?1:0,recipient,actor.member.operatorId,now,revision,...actor.args,...proof.args),
  env.DB.prepare(`UPDATE porthole_health_notices SET state='cancelled' WHERE state='pending' AND EXISTS(SELECT 1 FROM porthole_health_configuration WHERE singleton=1 AND revision=? AND changed_at=? AND configured_by=?)`).bind(revision+1,now,actor.member.operatorId),
  env.DB.prepare(`UPDATE porthole_health_incidents SET resolved_at=? WHERE resolved_at IS NULL AND EXISTS(SELECT 1 FROM porthole_health_configuration WHERE singleton=1 AND revision=? AND changed_at=? AND configured_by=?)`).bind(now,revision+1,now,actor.member.operatorId),
 ])
 if (!results[0].results.length) fail('authority_changed',409)
 return healthConfiguration(env.DB)
}
