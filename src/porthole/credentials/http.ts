import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { document, escape, privateHeaders } from '../document'
import { authority, fail, sameOrigin } from '../security/authority'
import { input, text } from '../security/input'
import { credentialClass, credentialScope, expiry, mayMint, quotas, type CredentialScope } from './policy'
import { credentialFor, listCredentials, metadata, mint, rescope, revoke } from './store'
import { credentialsPage, revealPage } from './view'
import { CredentialLimit, verifyCredential } from './verify'

const root = '/app/settings/credentials', api = '/api/porthole/v1/credential'
const paths = new Set([root, `${root}/mint`, `${root}/rotate`, `${root}/revoke`, `${root}/rescope`, api])
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { ...privateHeaders, ...extra } })
function scopeInput(data: Record<string, unknown>): unknown {
 if (data.scope !== undefined) {
  if (typeof data.scope === 'string') { try { return JSON.parse(data.scope) } catch { fail('invalid_scope', 400) } }
  return data.scope
 }
 const result: Record<string, string[]> = {}
 for (const key of ['services', 'environments', 'teams', 'signals', 'actions']) {
  if (typeof data[key] !== 'string') fail('invalid_scope', 400)
  result[key] = (data[key] as string).split(',').map(value => value.trim()).filter(Boolean)
 }
 return result
}
export async function credentialResponse(request: Request, env: Bindings): Promise<Response | null> {
 const url = new URL(request.url)
 if (!paths.has(url.pathname)) return null
 const isApi = url.pathname === api, wantsJson = isApi || request.headers.get('content-type')?.split(';')[0] === 'application/json' || request.headers.get('accept')?.includes('application/json')
 try {
  sameOrigin(request, env, request.method === 'POST')
  if (url.search) fail('query_credentials_forbidden', 400)
  if (isApi) {
   if (request.method !== 'GET') fail('credential_operation_forbidden', 403)
   const value = await verifyCredential(request, env)
   return json(value.credential)
  }
  if (url.pathname === root) {
   if (request.method !== 'GET') fail('method_not_allowed', 405)
   const actor = await authority(request, env, { manage: true })
   if (actor.session.kind !== 'native') fail('native_session_required')
   const rows = await listCredentials(env.DB)
   return wantsJson ? json({ credentials: rows.map(row => metadata(row)) }) : credentialsPage(rows, actor.member.role === 'owner')
  }
  if (request.method !== 'POST') fail('method_not_allowed', 405)
  const operation = url.pathname.slice(root.length + 1)
  const actor = await authority(request, env, { manage: true, post: true, stepUp: operation !== 'revoke' })
  if (actor.session.kind !== 'native') fail('native_session_required')
  const data = await input(request)
  if (operation === 'mint') {
   const kind = credentialClass(data.class); mayMint(actor.member, kind)
   const value = await mint(env.DB, actor, { name: text(data.name), kind, scope: credentialScope(scopeInput(data), kind, actor.member), expiresAt: expiry(data.expiresAt, kind, Date.now()), quotas: quotas(data, kind) })
   const response = wantsJson ? json(value, 201) : await revealPage(value)
   response.headers.set('x-porthole-entity', value.credential.id)
   return response
  }
  const previous = await credentialFor(env.DB, text(data.id, 36))
  if (operation === 'revoke') {
   const value = await revoke(env.DB, actor, previous)
   return wantsJson ? json({ credential: value }) : new Response(null, { status: 303, headers: { ...privateHeaders, location: root } })
  }
  mayMint(actor.member, previous.class)
  if (previous.custodian_id !== actor.member.operatorId) fail('credential_custody_forbidden')
  if (operation === 'rescope') {
   const value = await rescope(env.DB, actor, previous, credentialScope(scopeInput(data), previous.class, actor.member))
   return wantsJson ? json({ credential: value }) : new Response(null, { status: 303, headers: { ...privateHeaders, location: root } })
  }
  if (operation === 'rotate') {
   let overlap = data.overlapSeconds === undefined || data.overlapSeconds === '' ? 0 : typeof data.overlapSeconds === 'number' ? data.overlapSeconds : typeof data.overlapSeconds === 'string' && /^(0|[1-9][0-9]*)$/.test(data.overlapSeconds) ? Number(data.overlapSeconds) : NaN
   if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap > 604800 || previous.class === 'execution' && overlap !== 0) fail('invalid_overlap', 400)
   overlap *= 1000
   const value = await mint(env.DB, actor, { name: previous.name, kind: previous.class, scope: credentialScope(JSON.parse(previous.scope) as CredentialScope, previous.class, actor.member), expiresAt: expiry(data.expiresAt, previous.class, Date.now()), quotas: metadata(previous).quotas }, previous, overlap)
   const response = wantsJson ? json(value, 201) : await revealPage(value)
   response.headers.set('x-porthole-entity', value.credential.id)
   return response
  }
  fail('method_not_allowed', 405)
 } catch (error) {
  const code = error instanceof AuthError || error instanceof CredentialLimit ? error.code : 'credentials_unavailable'
  const status = error instanceof AuthError || error instanceof CredentialLimit ? error.status : 503
  const headers = error instanceof CredentialLimit ? { 'retry-after': String(error.retryAfter) } : {}
  return wantsJson ? json({ error: code }, status, headers) : document('Credentials unavailable', `<p role="alert">${escape(code.replaceAll('_', ' '))}. Verify your identity or contact the installation owner.</p><p><a href="${root}">Return to Credentials</a></p>`, status)
 }
}
