import type { Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import type { Operator } from '../../modules/operator-auth/index.mjs'
import { administrative, allScope, authority, baseRole, emptyScope, fail, memberFor, parseScope, proofFence, roles, scopeWithin, type Authority, type ProductRole, type Scope } from '../security/authority'
import { text } from '../security/input'
import { handoverIngest } from '../credentials/store'

export interface MemberRow extends Operator { productRole: ProductRole; scope: Scope; revision: number }
export const columns = `o.id,o.email,o.display_name AS displayName,o.role,o.status,o.version,o.created_at AS createdAt,m.role AS productRole,m.scope,m.revision`
export async function listMembers(env: Bindings, actor: Authority): Promise<MemberRow[]> {
 const rows = (await env.DB.prepare(`SELECT ${columns} FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE ${actor.fence} ORDER BY o.created_at,o.id`).bind(...actor.args).all<Omit<MemberRow,'scope'> & {scope: string}>()).results
 return rows.map(row => ({...row,scope:JSON.parse(row.scope) as Scope}))
}
function productRole(value: unknown): ProductRole {
 // The old member-tier transport maps to the least privileged migrated role.
 const role = value === 'member' ? 'read-only analyst' : value
 if (!roles.includes(role as ProductRole)) fail('invalid_role',400)
 return role as ProductRole
}
function canManage(actor: Authority, targetRole: ProductRole, desiredRole: ProductRole) {
 if (!administrative(actor.member.role)) fail('membership_forbidden')
 if (actor.member.role !== 'owner' && (administrative(targetRole) || administrative(desiredRole))) fail('owner_required')
}
function selectedScope(raw: unknown, role: ProductRole, actor: Authority): Scope {
 const scope = role === 'owner' ? allScope : raw === undefined ? administrative(role) ? allScope : emptyScope : parseScope(raw,role)
 parseScope(scope,role)
 if (!scopeWithin(scope,actor.member.scope)) fail('scope_exceeds_authority')
 return scope
}
const normalizeEmail = (raw: unknown) => {
 const value=text(raw,254).toLowerCase()
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('invalid_email',400)
 return value
}
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
async function linkHash(secret: string, token: string) {
 const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(`link\0${token}`)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function inviteMember(request: Request, env: Bindings, data: Record<string,unknown>) {
 const role=productRole(data.role ?? 'read-only analyst'),actor=await authority(request,env,{manage:true,post:true,stepUp:administrative(role)})
 canManage(actor,role,role)
 if(role==='owner') fail('owner_requires_active_member',409)
 const email=normalizeEmail(data.email),displayName=text(data.displayName),scope=selectedScope(data.scope,role,actor)
 const id=crypto.randomUUID(),tokenId=crypto.randomUUID(),token=randomToken(),now=Date.now(),expiresAt=now+7*86400000
 const proof=administrative(role) ? proofFence(actor) : {sql:'1',args:[]}
 const guard=`${actor.fence} AND ${proof.sql}`; const args=[...actor.args,...proof.args]
 // Both Base and product records, the final revision and the invitation are
 // committed together; only the hashed Base-format link enters storage.
 try {
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) SELECT ?,?,?,?,'invited',? WHERE ${guard}`).bind(id,email,displayName,baseRole(role),now,...args),
   env.DB.prepare(`UPDATE porthole_members SET role=?,scope=? WHERE operator_id=? AND ${guard}`).bind(role,JSON.stringify(scope),id,...args),
   env.DB.prepare(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at)
    SELECT ?,?,'invite',o.id,o.version,?,?, '/app',?,? FROM oa_operators o WHERE o.id=? AND ${guard}`).bind(tokenId,await linkHash(env.SESSION_SECRET,token),actor.member.operatorId,actor.session.operator.version,now,expiresAt,id,...args),
   ...(actor.session.kind === 'dev' ? [env.DB.prepare(`INSERT INTO oa_dev_credentials(credential,id,created_at) SELECT 'oa_tokens',id,? FROM oa_tokens WHERE id=?`).bind(now,tokenId)] : []),
  ])
 } catch (error) { if(String(error).includes('UNIQUE')) fail('invitation_conflict',409); throw error }
 const inserted=await env.DB.prepare('SELECT id FROM oa_tokens WHERE id=?').bind(tokenId).first()
 if(!inserted) fail('authority_changed',409)
 const sender=operatorMail(env),url=new URL('/auth/confirm',env.AUTH_ORIGIN);url.searchParams.set('token',token)
 try {
  if(!sender || !env.MAIL_FROM) throw Error('mail_unavailable')
  const sent=await sender.send({deliveryId:tokenId,from:env.MAIL_FROM,to:[email],subject:'Your Porthole invitation',text:`Confirm your invitation: ${url.href}`,html:`<p>Confirm your invitation: <a href="${url.href}">Join Porthole</a></p>`,headers:{'Auto-Submitted':'auto-generated'}})
  if(sent.status!=='accepted' && !(sent.status==='development' && (env.AUTH_LOCAL==='true' || env.RER_DEMO==='1'))) throw Error('mail_unavailable')
 } catch {
  await env.DB.prepare('UPDATE oa_tokens SET revoked_at=? WHERE id=?').bind(Date.now(),tokenId).run();fail('mail_unavailable',503)
 }
 return {status:'accepted' as const}
}
export async function changeMember(request: Request, env: Bindings, id: string, data: Record<string,unknown>) {
 const actor=await authority(request,env,{manage:true,post:true}),target=await memberFor(env.DB,id)
 if(!target) fail('operator_not_found',404)
 const role=productRole(data.role),scope=selectedScope(data.scope,role,actor)
 canManage(actor,target.role,role)
 const own=id===actor.member.operatorId
 if(own && !(actor.member.role==='owner' && role!=='owner')) fail('self_change_forbidden')
 const row=await env.DB.prepare('SELECT email,status,version FROM oa_operators WHERE id=?').bind(id).first<{email:string;status:string;version:number}>()
 if(!row) fail('operator_not_found',404)
 if(role==='owner' && target.role!=='owner') {
  if(row.status!=='active') fail('owner_requires_active_member',409)
  if(data.confirmEmail!==row.email) fail('typed_email_required',400)
 }
 const needsProof=administrative(role) || administrative(target.role)
 if(needsProof) await authority(request,env,{manage:true,post:true,stepUp:true})
 const proof=needsProof ? proofFence(actor) : {sql:'1',args:[]}
 const statements: D1PreparedStatement[]=[]
 if(administrative(target.role) && !administrative(role)) statements.push(handoverIngest(env.DB,id,actor))
 statements.push(env.DB.prepare(`UPDATE porthole_members SET role=?,scope=? WHERE operator_id=? AND revision=? AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=?) AND ${actor.fence} AND ${proof.sql} RETURNING operator_id`).bind(role,JSON.stringify(scope),id,target.revision,id,row.version,...actor.args,...proof.args))
 try {
  statements.push(env.DB.prepare('INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,changes()) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness'))
  const result=await env.DB.batch(statements)
  if(!result.at(-2)?.results.length) fail('authority_changed',409)
 } catch(error) { if(String(error).includes('follow_up_handover_required')) fail('follow_up_handover_required',409);if(String(error).includes('last_owner')) fail('last_owner',409);if(String(error).includes('CHECK constraint failed')) fail('authority_changed',409);throw error }
 return env.DB.prepare(`SELECT ${columns} FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.id=?`).bind(id).first()
}
export async function removeMember(request: Request, env: Bindings, id: string) {
 const actor=await authority(request,env,{manage:true,post:true,stepUp:true}),target=await memberFor(env.DB,id)
 if(!target) fail('operator_not_found',404)
 canManage(actor,target.role,target.role)
 const row=await env.DB.prepare('SELECT version FROM oa_operators WHERE id=?').bind(id).first<{version:number}>()
 const proof=proofFence(actor)
 try {
  const result=await env.DB.batch([
   handoverIngest(env.DB,id,actor),
   env.DB.prepare(`UPDATE oa_operators SET status='inactive' WHERE id=? AND version=? AND ${actor.fence} AND ${proof.sql} RETURNING id`).bind(id,row!.version,...actor.args,...proof.args),
   env.DB.prepare('INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,changes()) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness'),
  ])
  if(!result[1].results.length) fail('authority_changed',409)
 } catch(error) { if(String(error).includes('follow_up_handover_required')) fail('follow_up_handover_required',409);if(String(error).includes('last_owner')) fail('last_owner',409);if(String(error).includes('CHECK constraint failed')) fail('authority_changed',409);throw error }
 return env.DB.prepare(`SELECT ${columns} FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.id=?`).bind(id).first()
}
