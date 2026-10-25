import type { Bindings } from '../../../auth.server'
import { authority, fail, proofFence } from '../../security/authority'
import { input } from '../../security/input'
import { noticeGrant } from '../../recovery/mail'
import { healthConfiguration } from '../../health/receipts'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
interface Notice {id:string;state:string;message:string;transport_grant:string|null;configuration_revision:number;provider_id:string|null}

/** Provider reads can confirm acceptance; they never authorize a replacement
 * message. The original transport grant and current owner authority must hold. */
export async function reconcileNotice(request:Request,env:Bindings) {
 const actor=await authority(request,env,{post:true,stepUp:true})
 if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('owner_required')
 const data=await input(request)
 if(Object.keys(data).some(key=>!['noticeId','providerId','confirm'].includes(key))||!uuid(data.noticeId)||!uuid(data.providerId))fail('invalid_receipt_reference',400)
 if(data.confirm!=='verify-provider-receipt')fail('explicit_receipt_confirmation_required',400)
 const notice=await env.DB.prepare('SELECT id,state,message,transport_grant,configuration_revision,provider_id FROM porthole_health_notices WHERE id=?').bind(data.noticeId).first<Notice>()
 if(!notice)fail('notice_not_found',404)
 const config=await healthConfiguration(env.DB),proof=proofFence(actor)
 if(env.MAIL_PROVIDER!=='resend'||!env.MAIL_API_KEY||notice.configuration_revision!==config.revision||!config.notices_enabled)fail('original_notice_configuration_required',409)
 if(!notice.transport_grant||notice.transport_grant!==await noticeGrant(env))fail('original_notice_grant_required',409)
 if(notice.state==='accepted'&&notice.provider_id===data.providerId) {
  if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence} AND ${proof.sql}`).bind(...actor.args,...proof.args).first())fail('authority_changed',409)
  return {id:notice.id,state:'accepted',providerId:notice.provider_id,replayed:true}
 }
 if(notice.state!=='uncertain')fail('held_uncertain_notice_required',409)
 const frozen=JSON.parse(notice.message) as {provider:string;message:{from:string;to:string[];subject:string;text:string;html:string}}
 if(frozen.provider!=='resend'||frozen.message.from!==env.MAIL_FROM||frozen.message.to.length!==1||frozen.message.to[0]!==config.recipient)fail('original_notice_configuration_required',409)
 // Resend Retrieve Email: GET /emails/{email_id}. A send-only key may refuse
 // this read; the owner must resolve that scope rather than silently broaden it.
 let response:Response
 try {response=await fetch('https://api.resend.com/emails/'+data.providerId,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+env.MAIL_API_KEY,accept:'application/json'}})}
 catch {return fail('provider_receipt_unavailable',503)}
 if(response.status!==200) {
  await response.body?.cancel()
  if(response.status===401||response.status===403)fail('provider_receipt_scope_refused',422)
  if(response.status===404)fail('provider_receipt_not_found',422)
  if(response.status===429)fail('provider_receipt_rate_limited',503)
  fail('provider_receipt_unavailable',503)
 }
 const reader=response.body?.getReader()
 if(!reader)fail('provider_receipt_invalid',422)
 const chunks:Uint8Array[]=[];let size=0
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();fail('provider_receipt_invalid',422)}chunks.push(value)}}
 catch {return fail('provider_receipt_invalid',422)}
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let receipt:Record<string,unknown>
 try {receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
 catch {return fail('provider_receipt_invalid',422)}
 if(!receipt||receipt.object!=='email'||receipt.id!==data.providerId||receipt.from!==frozen.message.from||JSON.stringify(receipt.to)!==JSON.stringify(frozen.message.to)||receipt.subject!==frozen.message.subject||receipt.text!==frozen.message.text||receipt.html!==frozen.message.html||!Array.isArray(receipt.cc)||receipt.cc.length||!Array.isArray(receipt.bcc)||receipt.bcc.length)fail('provider_receipt_mismatch',422)
 // A network read is not authority. Recheck session, membership, proof and the
 // original notice and configuration in the same transaction as the receipt.
 const live=await authority(request,env,{post:true,stepUp:true}),currentProof=proofFence(live)
 if(live.member.role!=='owner'||live.member.revision!==actor.member.revision)fail('authority_changed',409)
 const result=await env.DB.prepare(`UPDATE porthole_health_notices SET state='accepted',provider_id=?,lease_id=NULL,lease_until=NULL WHERE id=? AND state='uncertain' AND message=? AND transport_grant=?
  AND EXISTS(SELECT 1 FROM porthole_health_configuration WHERE singleton=1 AND revision=? AND notices_enabled=1 AND recipient=?)
  AND ${live.fence} AND ${currentProof.sql} RETURNING id`)
 .bind(data.providerId,notice.id,notice.message,notice.transport_grant,config.revision,config.recipient,...live.args,...currentProof.args).all<{id:string}>()
 if(!result.results.length)fail('notice_or_authority_changed',409)
 return {id:notice.id,state:'accepted',providerId:data.providerId,replayed:false}
}
