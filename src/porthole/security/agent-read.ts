import { type Bindings } from '../../auth.server'
import { fail, memberFor } from './authority'
import { verifyCredentialId, type CredentialUse } from '../credentials/verify'

/** Trusted server capability, never parsed from HTTP input or tool arguments. */
export interface ReadPrincipal { personId: string; clientId?: string }
export async function agentReadAuthority(env: Bindings, principal: ReadPrincipal) {
 const member = await memberFor(env.DB, principal.personId)
 const operator = await env.DB.prepare('SELECT status,version FROM oa_operators WHERE id=?').bind(principal.personId).first<{status:string;version:number}>()
 if (!member || operator?.status !== 'active') fail('unauthenticated',401)
 const fence = {sql:`EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=? AND m.revision=? AND o.version=? AND o.status='active' AND o.role=CASE WHEN m.role IN ('owner','admin') THEN m.role ELSE 'member' END)`,args:[member.operatorId,member.revision,operator.version]}
 return {member,fence:fence.sql,args:fence.args}
}
export const agentCredential = (request:Request, env:Bindings, principal:ReadPrincipal, use:CredentialUse) => {
 if (!principal.clientId) fail('invalid_credential',401)
 return verifyCredentialId(request,env,principal.clientId,principal.personId,use)
}
