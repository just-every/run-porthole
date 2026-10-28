import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { CredentialLimit } from '../../credentials/verify'
import { privateHeaders } from '../../document'
import { IntakeError } from '../../ingest/model'
import { fail } from '../../security/authority'
import { queryRed } from './read'

export async function redResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!=='/api/porthole/v1/red/query')return null
 try {
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(url.search)fail('invalid_query',400)
  return await queryRed(request,env)
 }catch(error){
  const known=error instanceof AuthError||error instanceof IntakeError||error instanceof CredentialLimit
  return Response.json({error:known?error.code:'red_unavailable'},{status:known?error.status:503,headers:{...privateHeaders,...(error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{})}})
 }
}
