import { operatorAuth, type Bindings } from '../../auth.server'
import { append, type AuditInput } from './store'

// Each existing administrative HTTP mutation has a fixed label. Future product
// handlers must adopt this seam; this list does not claim to implement them.
const actions: Record<string, string> = {
 '/auth/invite': 'membership.invite', '/auth/invite/cancel': 'membership.cancel-invitation',
 '/auth/operator/status': 'membership.status', '/auth/operator/role': 'membership.role',
 '/auth/session/revoke': 'credentials.revoke-session', '/auth/settings/identity': 'identity.settings',
 '/auth/domain-rules': 'identity.domain-rule', '/auth/providers/unlink': 'connector.unlink',
 '/auth/providers/relink': 'connector.relink', '/auth/policy/approve': 'approval.policy',
 '/auth/policy/revoke': 'approval.revoke-policy', '/auth/email': 'membership.email',
 '/auth/display-name': 'membership.display-name',
}
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' }
export const auditUnavailable = (operationRef?: string) => Response.json({ error: 'audit_unavailable', ...(operationRef ? { operationRef, result: 'inspect_attempt_before_retry' } : {}) }, { status: 503, headers })
export const outcome = (status: number) => status >= 500 ? 'failed' as const : status >= 400 ? 'denied' as const : 'succeeded' as const

/** Durable intent gates the action. An absent outcome is explicitly uncertain,
 * never success. Base's mutation and the result append are separate commits. */
export async function capture(request: Request, env: Bindings, handle: () => Promise<Response | null>): Promise<Response | null> {
 const action = request.method === 'POST' ? actions[new URL(request.url).pathname] : undefined
 if (!action) return handle()
 const operationRef = crypto.randomUUID(), occurredAt = Date.now()
 let input: AuditInput
 try {
  const session = await operatorAuth(env).getSession(request)
  // UUIDs are opaque native references. No identity directory or request field
  // is copied. For these doors the actor revision is the native auth revision;
  // target-object revision capture is still a future integration obligation.
  input = { operationRef, occurredAt, actorRef: session?.operator.id ?? null, action,
   entityRef: session?.operator.id ?? null, revision: session?.operator.version ?? null, phase: 'attempted', status: null }
  await append(env.DB, input)
 } catch { return auditUnavailable() }
 let response: Response
 try { response = await handle() ?? new Response(null, { status: 404 }) } catch { response = Response.json({ error: 'action_unavailable' }, { status: 503, headers }) }
 try { await append(env.DB, { ...input, phase: outcome(response.status), status: response.status }) }
 catch { return auditUnavailable(operationRef) }
 const responseHeaders = new Headers(response.headers)
 responseHeaders.set('x-porthole-operation', operationRef)
 return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}
