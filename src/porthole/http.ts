import { runtimeBindings, type Bindings } from '../auth.server'
import { auditResponse } from './audit/http'
import { personalTokenResponse } from './membership/token'
import { membershipResponse } from './membership/http'
import { credentialResponse } from './credentials/http'
import { healthResponse } from './health/http'

export async function portholeResponse(request: Request, bindings: Bindings): Promise<Response | null> {
 const env = runtimeBindings(bindings), url = new URL(request.url)
 if(url.pathname==='/api/porthole/v1/session') return personalTokenResponse(request,env)
 if (url.pathname.startsWith('/app/settings') || url.pathname==='/api/porthole/v1/credential') return await membershipResponse(request,env) ?? await credentialResponse(request,env)
 if (!['/app/audit', '/app/health', '/api/v1/audit', '/api/v1/audit/export', '/api/v1/health'].includes(url.pathname)) return null
 // Native auth enforces this too; check before touching the audit database so
 // a foreign origin cannot create entries or infer a private ledger checkpoint.
 if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase()) || request.headers.get('sec-fetch-site') === 'cross-site') {
  return Response.json({ error: 'invalid_origin' }, { status: 403, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
 }
 return await auditResponse(request, env) ?? await healthResponse(request, env)
}
