import { operatorAuth, type Bindings } from '../../auth.server'
import { verifyCredential } from '../credentials/verify'
import { transactionalAudit } from './transaction'
import { projectFacts } from './facts'
import { append, digest, type AuditInput } from './store'

// Each existing administrative HTTP mutation has a fixed label. Future product
// handlers must adopt this seam; this list does not claim to implement them.
const actions: Record<string, string> = {
 '/api/porthole/v1/slos':'slo.revision', '/api/porthole/v1/slos/evaluate':'slo.evaluate', '/api/porthole/v1/reports/slo':'slo.report',
 '/api/porthole/v1/retention/preview':'retention.preview', '/api/porthole/v1/retention/approve':'retention.approve',
 '/api/porthole/v1/subject-erasure/journal':'privacy.erasure-journal', '/api/porthole/v1/subject-erasure':'privacy.preview-subject', '/api/porthole/v1/subject-erasure/apply':'privacy.erase-subject',
 '/app/settings/integrations/reconcile':'integration.notice-reconcile',
 '/app/settings/instrumentation':'instrumentation.baggage',
 '/app/settings/analytics':'analytics.configure','/app/settings/analytics/reconcile':'analytics.reconcile','/api/porthole/v1/analytics/configuration':'analytics.configure','/api/porthole/v1/analytics/reconcile':'analytics.reconcile',
 '/app/settings/members/invite':'membership.invite', '/app/settings/members/change':'membership.role', '/app/settings/members/remove':'membership.status',
 '/app/settings/credentials/rescope':'credentials.rescope',
 '/app/settings/credentials/mint':'credentials.mint', '/app/settings/credentials/rotate':'credentials.rotate', '/app/settings/credentials/revoke':'credentials.revoke',
 '/api/porthole/v1/ingest/control':'ingest.control', '/api/porthole/v1/ingest/drain':'ingest.reconcile', '/api/porthole/v1/ingest/loss':'ingest.loss',
 '/api/porthole/v1/query':'telemetry.query', '/app/explore':'telemetry.query', '/api/porthole/v1/mcp':'telemetry.tool',
 '/api/porthole/v1/objects':'objects.change', '/app/operations/save':'objects.change',
 '/api/porthole/v1/objects/activate':'objects.monitor-activate', '/app/operations/activate':'objects.monitor-activate',
 '/app/health/confirm':'health.recipient-confirm',
 '/api/v1/health/configuration':'health.configure', '/app/health/configuration':'health.configure', '/api/v1/health/tick':'health.reconcile', '/app/health/tick':'health.reconcile',
 '/api/porthole/v1/approvals':'repair.approve', '/app/operations/approve':'repair.approve',
 '/api/porthole/v1/actors/erase':'privacy.erase-actor', '/app/settings/privacy/erase':'privacy.erase-actor',
 '/api/porthole/v1/follow-up/review':'follow-up.review', '/app/settings/follow-up/review':'follow-up.review',
 '/auth/signout':'identity.signout', '/auth/owner-signin':'identity.signin', '/auth/magic-link':'identity.request-signin', '/auth/review-session':'identity.review-session', '/auth/setup-complete':'identity.setup-complete',
 '/auth/step-up':'identity.step-up', '/auth/confirm':'identity.confirm',
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
// Attempts with neither a session nor a live credential reach the permanent
// ledger within a budget per trusted client address and window, counted in the
// shared rate-limit store; past it they are refused before any append.
const budgetWindow = 15 * 60_000, unauthenticatedBudget = 200
const liveCredential = (request: Request, env: Bindings) => request.headers.has('authorization') && verifyCredential(request, env, { inspectOnly: true }).then(() => true, () => false)
async function overBudget(request: Request, env: Bindings, now: number): Promise<Response | null> {
 const window = Math.floor(now / budgetWindow), key = 'porthole-audit:' + await digest(request.headers.get('CF-Connecting-IP') ?? '')
 const spent = await env.DB.prepare(`INSERT INTO oa_limits(key,window,count) VALUES(?,?,1)
  ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN oa_limits.window=excluded.window THEN oa_limits.count+1 ELSE 1 END RETURNING count`).bind(key, window).first<{ count: number }>()
 if (spent && spent.count <= unauthenticatedBudget) return null
 return Response.json({ error: 'rate_limited' }, { status: 429, headers: { ...headers, 'retry-after': String(Math.ceil(((window + 1) * budgetWindow - now) / 1000)) } })
}

/** Durable intent gates each action. Target mutation facts commit with the
 * write; HTTP outcomes follow projection. An absent HTTP result is uncertain. */
export async function capture(request: Request, env: Bindings, handle: (env: Bindings) => Promise<Response | null>): Promise<Response | null> {
 const path=new URL(request.url).pathname
 const action=request.method==='GET'&&(path.startsWith('/app/dashboards')||path.startsWith('/api/porthole/v1/dashboards'))?'dashboards.read':path.startsWith('/api/porthole/v1/configuration/')?request.method==='GET'?'configuration.read':'configuration.change':path==='/api/porthole/v1/export-exclusions'?'signals.export-exclusions':request.method==='POST'
  ? (path.startsWith('/app/dashboards/')||path.startsWith('/api/porthole/v1/dashboards')?'dashboards.change':undefined) ?? (path.startsWith('/api/porthole/v1/exports')?'signals.export':undefined) ?? actions[path] ?? (path.startsWith('/api/operator/import/')||path.startsWith('/app/import/')?'migration.request':undefined) ?? (path.startsWith('/api/porthole/v1/storage/history')?'storage.history':undefined) ?? (path.startsWith('/auth/dependencies/')?'connector.attempt':undefined) ?? (path.startsWith('/api/porthole/v1/archive/')||path.startsWith('/app/settings/archive/')?'installation.archive':undefined)
  : request.method==='GET' && path.startsWith('/api/porthole/v1/exports/')?'signals.export-read'
  : request.method==='GET' && (path.startsWith('/api/porthole/v1/archive/')||path.startsWith('/app/settings/archive/jobs/'))?'installation.archive-read'
  : request.method==='GET' && (path.startsWith('/api/porthole/v1/traces/')||path.startsWith('/app/traces')||path==='/api/porthole/v1/ingest/records'||path==='/api/porthole/v1/ingest/archive'||/^\/api\/porthole\/v1\/query\/[a-f0-9-]{36}$/.test(path))?'telemetry.query'
  : ['GET','HEAD'].includes(request.method) && path.startsWith('/api/porthole/v1/storage/history')?'storage.history-read' : undefined
 if (!action) return handle(env)
 const operationRef = crypto.randomUUID(), occurredAt = Date.now()
 let input: AuditInput | null = null
 try {
  const session = await operatorAuth(env).getSession(request)
  // Signing out without a session ends nothing, so it is not an audited action.
  if (session || action !== 'identity.signout') {
   if (!session && !await liveCredential(request, env)) { const refusal = await overBudget(request, env, occurredAt); if (refusal) return refusal }
   // Only server-produced opaque references and numeric revisions may cross
   // this boundary. Bodies and identity labels are never persisted.
   input = { operationRef, occurredAt, actorRef: session?.operator.id ?? null, actorRevision: session?.operator.version ?? null, action,
    entityRef: null, revision: null, phase: 'attempted', status: null }
   await append(env.DB, input)
  }
 } catch { return auditUnavailable() }
 if (!input) return handle(env)
 let response: Response
 try { response = await handle({ ...env,DB:transactionalAudit(env.DB,input) }) ?? new Response(null, { status: 404 }) } catch { response = Response.json({ error: 'action_unavailable' }, { status: 503, headers }) }
 try {
  await projectFacts(env.DB)
  // Successful native operator mutations return the target and its revision.
  // Select only those fields, validate against native storage, and discard the
  // response's identity fields. Invitations with no returned target stay null.
  if (request.method!=='HEAD' && response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
   const target = await response.clone().json() as { id?: unknown }
   if (typeof target.id === 'string' && /^[a-f0-9-]{36}$/.test(target.id)) {
    const row = await env.DB.prepare('SELECT id,version FROM oa_operators WHERE id=?').bind(target.id).first<{ id: string; version: number }>()
    if (row) { input.entityRef = row.id; input.revision = row.version }
   }
  }
  const attributed=response.headers.get('x-porthole-actor'),attributedRevision=Number(response.headers.get('x-porthole-actor-revision'))
  if(attributed && /^[a-f0-9-]{36}$/.test(attributed) && Number.isSafeInteger(attributedRevision)) {input.actorRef=attributed;input.actorRevision=attributedRevision}
  const reference=response.headers.get('x-porthole-entity')
  if(reference && /^[a-f0-9-]{36}$/.test(reference)) input.entityRef=reference
  await append(env.DB, { ...input, phase: outcome(response.status), status: response.status })
 }
 catch { return auditUnavailable(operationRef) }
 const responseHeaders = new Headers(response.headers)
 responseHeaders.set('x-porthole-operation', operationRef)
 return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}
