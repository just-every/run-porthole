import type { HealthBindings } from './model'
import { secretHash, newSecret } from '../credentials/policy'
const validToken=(value:unknown):value is string=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value)
import { operatorMail } from '../../mail.server.mjs'
import { fail, sameOrigin } from '../security/authority'
import { input } from '../security/input'
import { operationDocument as document, escape } from '../document'

// A confirmation is valid only for the current grant and a live administrator.
// Removed, replaced, expired and restored grants cannot authorize delivery.
export const liveConfigurer = `EXISTS(SELECT 1 FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.id=c.configured_by AND o.status='active' AND o.role=m.role AND m.role IN ('owner','admin'))`
export const confirmedRecipient = `EXISTS(SELECT 1 FROM porthole_health_recipients r WHERE r.configuration_revision=c.revision AND r.recipient=c.recipient AND r.configured_by=c.configured_by AND r.confirmed_at IS NOT NULL AND r.removed_at IS NULL)`
export async function recipientChallenge() {
 const token=newSecret().slice(3)
 return {token,hash:await secretHash('health-recipient:'+token)}
}
export async function sendConfirmation(env:HealthBindings,id:string,recipient:string,token:string) {
 const link=`${env.AUTH_ORIGIN}/app/health/confirm?token=${encodeURIComponent(token)}`
 let status='failed'
 try {
  const sender=operatorMail(env)
  const result=await sender?.send({deliveryId:`porthole-recipient/${id}`,from:env.MAIL_FROM??'',to:[recipient],subject:'Confirm Porthole independent notices',
   text:`An installation administrator requested independent pipeline failure and recovery notices for this address. Confirm only if you want these notices: ${link} . This single-use link expires in 24 hours. Opening it does not confirm. Ignore it to receive no pipeline notices.`,
   html:`<p>An installation administrator requested independent pipeline failure and recovery notices for this address.</p><p><a href="${escape(link)}">Review and confirm notices</a></p><p>This single-use link expires in 24 hours. Opening it does not confirm. Ignore it to receive no pipeline notices.</p>`,headers:{'Auto-Submitted':'auto-generated'}})
  status=result?.status==='accepted'?'accepted':result?.status==='development'?'development':'failed'
 } catch { /* Never expose transport failures or the bearer link. */ }
 await env.DB.prepare('UPDATE porthole_health_recipients SET confirmation_delivery=? WHERE id=? AND removed_at IS NULL').bind(status,id).run()
}
export async function confirmationResponse(request:Request,env:HealthBindings):Promise<Response> {
 sameOrigin(request,env)
 const url=new URL(request.url)
 if (request.method==='GET' || request.method==='HEAD') {
  const token=url.searchParams.get('token')
  if ([...url.searchParams.keys()].some(key=>key!=='token') || url.searchParams.getAll('token').length!==1 || !validToken(token)) fail('invalid_confirmation',400)
  const response=await document('Confirm independent notices',`<p>Confirm that you want automatic pipeline failure and recovery emails from this Porthole installation. This does not sign you in or authorize any repair.</p><form method="post" action="/app/health/confirm"><input type="hidden" name="token" value="${escape(token!)}"><button type="submit">Confirm independent notices</button></form>`,200,{forms:true})
  response.headers.set('referrer-policy','strict-origin')
  return request.method==='HEAD'?new Response(null,response):response
 }
 if(request.method!=='POST') fail('method_not_allowed',405)
 sameOrigin(request,env,true)
 if(url.search) fail('invalid_confirmation',400)
 const data=await input(request)
 if(Object.keys(data).some(key=>key!=='token') || !validToken(data.token)) fail('invalid_confirmation',400)
 const hash=await secretHash('health-recipient:'+data.token),now=Date.now()
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE porthole_health_recipients SET confirmed_at=?,token_hash=NULL WHERE token_hash=? AND confirmed_at IS NULL AND removed_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM porthole_health_configuration c WHERE c.revision=configuration_revision AND c.recipient=porthole_health_recipients.recipient AND c.configured_by=porthole_health_recipients.configured_by AND ${liveConfigurer}) RETURNING id`).bind(now,hash,now),
  env.DB.prepare(`UPDATE porthole_health_configuration AS c SET notices_enabled=1 WHERE c.notices_enabled=0 AND ${confirmedRecipient} AND ${liveConfigurer} AND EXISTS(SELECT 1 FROM porthole_health_recipients r WHERE r.configuration_revision=c.revision AND r.confirmed_at=?)`).bind(now),
 ])
 if(!results[0].results.length)fail('confirmation_expired_or_used',410)
 return document('Independent notices confirmed','<p role="status">This address is confirmed for independent pipeline failure and recovery notices. An owner or admin can remove it in Pipeline health.</p>')
}
