import { baseOperatorAuth, type Bindings } from '../../auth.server'
import { defaultRolePolicy, type OperatorAuth, type PolicyInput } from '../../modules/operator-auth/index.mjs'
import { authority, fail, memberFor } from '../security/authority'
import { changeMember, inviteMember, listMembers, removeMember } from './store'

/** Compose with Base's policy. This is never a replacement for its active
 * session guard or the last-owner database constraint. */
export const rolePolicy = (env: Bindings) => async (input: PolicyInput) => {
 if (!defaultRolePolicy(input)) return false
 const member=await memberFor(env.DB,input.actor.id)
 if(!member || member.role==='restricted contractor') return false
 if(input.action.startsWith('operators:') && member.role!=='owner' && member.role!=='admin') return false
 if(input.action==='operators:role' && input.target?.id===input.actor.id && !(member.role==='owner' && input.role!=='owner')) return false
 return true
}
export function productAuth(env: Bindings, base: OperatorAuth): OperatorAuth {
 return {
  ...base,
  async getSession(request) {
   if(request.headers.has('authorization')) return null
   const session=await base.getSession(request)
   if(!session || !await memberFor(env.DB,session.operator.id)) return null
   return session
  },
  invite: (request,data) => inviteMember(request,env,data as unknown as Record<string,unknown>),
  async listOperators(request) { return listMembers(env,await authority(request,env,{manage:true})) },
  async setRole(request,id,role) { return await changeMember(request,env,id,{role}) as never },
  async setOperatorStatus(request,id,status) {
   if(status!=='inactive') return fail('use_members_settings',403)
   return await removeMember(request,env,id) as never
  },
  async cancelInvitation(request,id) { return await removeMember(request,env,id) as never },
  // Product credentials have their own native-only classed minting door.
  async mintCredential() { return fail('use_credentials_settings') },
 }
}
// Administrative Base methods that use their own owner check still pass the
// product five-minute gate. Session revocation deliberately remains exempt.
export async function guardNativeRequest(request: Request,env: Bindings) {
 const path=new URL(request.url).pathname
 if(request.headers.has('authorization') && path.startsWith('/auth/') && !['/auth/confirm','/auth/magic-link'].includes(path)) fail('native_session_required')
 const settings=path.startsWith('/auth/settings/') || ['/auth/providers','/auth/domain-rules','/auth/sessions'].includes(path)
 const privileged=['/auth/settings/identity','/auth/domain-rules','/auth/providers/unlink','/auth/providers/relink','/auth/email','/auth/policy/approve']
 if(settings) {
  const session=await baseOperatorAuth(env).getSession(request)
  if(session && (await memberFor(env.DB,session.operator.id))?.role==='restricted contractor') fail('settings_forbidden')
 }
 if(request.method==='POST' && privileged.includes(path)) await authority(request,env,{post:true,stepUp:true})
}
