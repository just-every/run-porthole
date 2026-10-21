import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { document,escape,privateHeaders } from '../../document'
import { authority,fail,proofFence } from '../../security/authority'
import { input,text } from '../../security/input'
const paths=new Set(['/app/settings/privacy','/app/settings/privacy/erase','/api/porthole/v1/actors/erase'])
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function erasureResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(!paths.has(url.pathname))return null
 const page=url.pathname.startsWith('/app/'),form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
 try {
  const actor=await authority(request,env,{manage:true,post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.member.role!=='owner')fail('owner_required')
  if(request.method==='GET' && url.pathname==='/app/settings/privacy') {
   const rows=(await env.DB.prepare(`SELECT o.id,o.status,EXISTS(SELECT 1 FROM porthole_erased_actors e WHERE e.actor_ref=o.id) AS erased FROM oa_operators o WHERE ${actor.fence} ORDER BY o.created_at`).bind(...actor.args).all<{id:string;status:string;erased:number}>()).results
   return document('Actor privacy',`<p>Erase an inactive member’s sign-in identity after removal. Opaque action history remains attributable to the same reference. This does not erase telemetry subjects or shorten audit retention.</p>${rows.map(row=>`<section><h2>${escape(row.id)}</h2><p>${row.erased?'Anonymized':escape(row.status)}</p>${row.status==='inactive' && !row.erased?`<form method="post" action="/app/settings/privacy/erase"><input type="hidden" name="actorRef" value="${row.id}"><label><input name="confirm" type="checkbox" value="erase" required> Erase identity permanently</label><button>Erase inactive actor</button></form>`:''}</section>`).join('')}`,200,{forms:true})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request),id=text(data.actorRef,36)
  if(!/^[a-f0-9-]{36}$/.test(id)||data.confirm!=='erase')fail('confirmation_required',400)
  if(id===actor.member.operatorId)fail('self_erasure_forbidden')
  const target=await env.DB.prepare('SELECT id,email,status,version FROM oa_operators WHERE id=?').bind(id).first<{id:string;email:string;status:string;version:number}>()
  if(!target)fail('actor_not_found',404)
  if(target.status!=='inactive')fail('remove_member_before_erasure',409)
  const proof=proofFence(actor),guard=`${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='inactive')`,args=[...actor.args,...proof.args,id,target.version],now=Date.now()
  // Erasure never changes opaque ids. Authentication values become unusable;
  // native Base directory labels and external subject linkage are removed.
  const statements=[
   env.DB.prepare(`INSERT INTO porthole_erased_actors SELECT ?,? WHERE ${guard} ON CONFLICT DO NOTHING`).bind(id,now,...args),
   env.DB.prepare(`UPDATE oa_operators SET email=?||'@erased.invalid',display_name='Erased actor',last_signin_at=NULL WHERE id=? AND ${guard}`).bind(id,id,...args),
   env.DB.prepare(`DELETE FROM oa_provider_sessions WHERE session_id IN(SELECT id FROM oa_sessions WHERE operator_id=?) AND ${guard}`).bind(id,...args),
   env.DB.prepare(`DELETE FROM oa_external_identities WHERE operator_id=? AND ${guard}`).bind(id,...args),
   env.DB.prepare(`UPDATE oa_sessions SET token_hash='erased:'||id,revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ${guard}`).bind(now,id,...args),
   env.DB.prepare(`UPDATE oa_tokens SET token_hash='erased:'||id,revoked_at=COALESCE(revoked_at,?) WHERE (operator_id=? OR issuer_id=?) AND ${guard}`).bind(now,id,id,...args),
   env.DB.prepare(`UPDATE oa_credentials SET token_hash='erased:'||id,revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ${guard}`).bind(now,id,...args),
   env.DB.prepare(`DELETE FROM oa_step_up_challenges WHERE operator_id=? AND ${guard}`).bind(id,...args),
   env.DB.prepare(`DELETE FROM oa_owner_signins WHERE operator_id=? AND ${guard}`).bind(id,...args),
   env.DB.prepare(`UPDATE porthole_credentials SET secret_hash=lower(hex(randomblob(32))),prefix='erased',last_four='none',name='Erased credential',suspended_at=COALESCE(suspended_at,?),revision=revision+1 WHERE custodian_id=? AND status!='active' AND ${guard}`).bind(now,id,...args),
   env.DB.prepare(`UPDATE oa_auth_audit SET value='{"erased":true}' WHERE (actor_id=? OR instr(value,?)>0) AND ${guard}`).bind(id,target.email,...args),
   env.DB.prepare(`UPDATE oa_policy_approvals SET revoked_at=COALESCE(revoked_at,?),definition='{}',actions='[]' WHERE owner_id=? AND ${guard}`).bind(now,id,...args),
  ]
  const result=await env.DB.batch(statements)
  if(!result[1].meta.changes)fail('authority_changed',409)
  return form?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/settings/privacy'}}):json({actorRef:id,erasedAt:now})
 }catch(error) {
  const code=error instanceof AuthError?error.code:'erasure_unavailable',status=error instanceof AuthError?error.status:503
  return page?document('Actor privacy unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/settings/privacy">Return to Actor privacy</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
