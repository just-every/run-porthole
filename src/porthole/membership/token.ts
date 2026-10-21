import type { Bindings } from '../../auth.server'
import { baseOperatorAuth } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { fail, memberFor, sameOrigin } from '../security/authority'
import { privateHeaders } from '../document'

/** The existing Base personal-token door. It reveals only the current person's
 * identity and scope; versioned product queries remain PORT-026's obligation. */
export async function personalTokenResponse(request: Request, env: Bindings): Promise<Response | null> {
 if(new URL(request.url).pathname!=='/api/porthole/v1/session') return null
 try {
  sameOrigin(request,env)
  if(request.method!=='GET') fail('method_not_allowed',405)
  if(new URL(request.url).search) fail('query_credentials_forbidden',400)
  const credential=await baseOperatorAuth(env).authenticateCredential(request)
  if(!credential) fail('invalid_credential',401)
  const member=await memberFor(env.DB,credential.personId)
  if(!member) fail('invalid_credential',401)
  return Response.json({personId:member.operatorId,role:member.role,scope:member.scope,revision:member.revision},{headers:privateHeaders})
 } catch(error) {return Response.json({error:error instanceof AuthError?error.code:'authorization_unavailable'},{status:error instanceof AuthError?error.status:503,headers:privateHeaders})}
}
