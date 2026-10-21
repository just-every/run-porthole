import { operatorAuth, type Bindings } from '../../auth.server'
import { document, escape, privateHeaders } from '../document'

/** Deployment liveness is deliberately separate from product coverage. Until
 * real workers/collectors exist, none can furnish a fresh accepted/queryable
 * receipt. A working control plane must never turn these gaps green. */
export async function healthResponse(request: Request, env: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!['/app/health', '/api/v1/health'].includes(path)) return null
 const page = path === '/app/health'
 const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders })
 const failure = (message: string, status: number) => page ? document('Pipeline health unavailable', `<p role="alert">${escape(message)}</p><p><a href="/app/health">Try again</a></p>`, status) : json({ error: message }, status)
 if (request.method !== 'GET') return failure('method_not_allowed', 405)
 try {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return failure('authentication_required', 401)
  if (session.operator.role !== 'owner') return failure('owner_required', 403)
  const checkedAt = new Date().toISOString()
  let control = false
  try { control = (await env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>())?.ready === 1 } catch {}
  const components = [
   { component: 'control-plane', status: control ? 'Healthy' : 'Unknown', reason: control ? 'Authenticated request and control-plane database answered.' : 'Control-plane database unavailable.', checkedAt, lastAcceptedAt: null, lastQueryableAt: null },
   ...['collector', 'ingest', 'queue', 'storage', 'query', 'monitor-evaluation', 'delivery'].map(component => ({ component, status: 'Unknown', reason: 'Not configured: no independent fresh product receipt.', checkedAt, lastAcceptedAt: null, lastQueryableAt: null })),
  ]
  const state = { version: 1, status: 'Unknown', checkedAt, lastAcceptedAt: null, lastQueryableAt: null, components }
  if (!page) return json(state)
  return document('Pipeline health', `<p role="status">Unknown — pipeline coverage is incomplete.</p><p>Checked ${escape(checkedAt)} (UTC). This control-plane door does not query an analytical backend.</p><dl><dt>Last accepted</dt><dd>No accepted receipt</dd><dt>Last queryable</dt><dd>No queryable receipt</dd></dl><ul>${components.map(row => `<li><h2>${escape(row.component)}: ${escape(row.status)}</h2><p>${escape(row.reason)}</p></li>`).join('')}</ul><p>Deployment liveness at /health does not establish telemetry health. Independent failure notices, analytical failover and backlog recovery are still being built.</p><p><a href="/api/v1/health">Read health as JSON</a></p>`)
 } catch { return failure('control_plane_unavailable', 503) }
}
