import type { Bindings } from '../../auth.server'
import { fail, sameOrigin, type ProductRole, type Scope } from '../security/authority'
import { intersect, secretHash, type CredentialScope } from './policy'
import { metadata, type CredentialRow } from './store'

interface LiveCredential extends CredentialRow {
 custodian_scope: string; custodian_role: ProductRole; member_revision: number; operator_version: number
 minute: number; minute_requests: number; minute_bytes: number; utc_day: number; day_scanned_bytes: number; day_usd_micros: number
}
export class CredentialLimit extends Error {
 readonly status = 429
 readonly code = 'credential_quota_exceeded'
 constructor(readonly retryAfter: number) { super('credential_quota_exceeded') }
}
export interface CredentialUse {
 acceptedBytes?: number; scannedBytes?: number; usdMicros?: number
 action?: string; scope?: Scope; dataScope?: Scope
 /** A later door's writes MUST include the supplied SQL fence and arguments.
  * They execute in the quota reservation's transaction; a refused reservation
  * leaves the request marker absent, so a late write cannot pass the fence. */
 writes?: (fence: { sql: string; args: unknown[] }, effectiveScope: CredentialScope) => D1PreparedStatement[]
}
const join = `FROM porthole_credentials c JOIN porthole_members m ON m.operator_id=c.custodian_id JOIN oa_operators o ON o.id=m.operator_id`
const live = `c.status='active' AND c.expires_at>? AND o.status='active' AND m.role IN ('owner','admin') AND o.role=m.role AND (c.class NOT IN ('proposal','execution') OR m.role='owner')`
const cost = (value = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fail('invalid_usage', 400)
function fits(wanted: Scope, held: Scope) {
 return (['services', 'environments', 'teams'] as const).every(key => wanted[key].every(value => held[key].includes('*') || held[key].includes(value)))
}
/** No cache: read live custody, reserve quotas, and fence every write together.
 * Header-only authentication. PORT-062 can add its declared source header when
 * that wire contract ships; currently Authorization: Bearer is the only door. */
export async function verifyCredential(request: Request, env: Bindings, use: CredentialUse = {}) {
 sameOrigin(request, env)
 const url = new URL(request.url)
 if ([...url.searchParams.keys()].some(key => /token|secret|credential|api.?key|authorization/i.test(key))) fail('query_credentials_forbidden', 400)
 const authorization = request.headers.get('authorization') ?? ''
 if (!/^Bearer ph_[A-Za-z0-9_-]{43}$/.test(authorization)) fail('invalid_credential', 401)
 const hash = await secretHash(authorization.slice(7)), now = Date.now()
 const row = await env.DB.prepare(`SELECT c.*,m.scope AS custodian_scope,m.role AS custodian_role,m.revision AS member_revision,o.version AS operator_version ${join} WHERE c.secret_hash=? AND ${live}`)
 .bind(hash, now).first<LiveCredential>()
 if (!row) fail('invalid_credential', 401)
 let scope = intersect(JSON.parse(row.scope) as CredentialScope, JSON.parse(row.custodian_scope) as Scope)
 if (use.dataScope) scope = intersect(scope, use.dataScope)
 if (!scope.services.length || !scope.environments.length) fail('credential_scope_forbidden')
 if (use.action) {
  if (!scope.actions.includes(use.action) || !use.scope || !use.dataScope || !fits(use.scope, scope)) fail('credential_scope_forbidden')
  // The plan approver and immutable plan contract belongs to PORT-036b/029.
  if (use.action === 'plan.execute') fail('plan_approval_required')
 }
 if (use.writes && !use.action) fail('credential_action_required')
 const bytes = cost(use.acceptedBytes), scanned = cost(use.scannedBytes), usd = cost(use.usdMicros)
 if (bytes && row.class !== 'ingest' || scanned && !['read', 'proposal'].includes(row.class) || usd && !['read', 'proposal', 'execution'].includes(row.class)) fail('credential_usage_forbidden')
 const minute = Math.floor(now / 60000), day = Math.floor(now / 86400000), requestId = crypto.randomUUID()
 const authoritySql = `EXISTS(SELECT 1 ${join} WHERE c.id=? AND c.revision=? AND c.custodian_id=? AND m.revision=? AND o.version=? AND ${live})`
 const authorityArgs: unknown[] = [row.id, row.revision, row.custodian_id, row.member_revision, row.operator_version, now]
 const fence = { sql: `${authoritySql} AND EXISTS(SELECT 1 FROM porthole_credentials WHERE id=? AND last_request_id=?)`, args: [...authorityArgs, row.id, requestId] }
 const statements = [env.DB.prepare(`UPDATE porthole_credentials SET
 minute=?,minute_requests=CASE WHEN minute=? THEN minute_requests+1 ELSE 1 END,
 minute_bytes=CASE WHEN minute=? THEN minute_bytes+? ELSE ? END,
 utc_day=?,day_scanned_bytes=CASE WHEN utc_day=? THEN day_scanned_bytes+? ELSE ? END,
 day_usd_micros=CASE WHEN utc_day=? THEN day_usd_micros+? ELSE ? END,
 last_used_at=CASE WHEN last_used_at IS NULL OR last_used_at<=? THEN ? ELSE last_used_at END,
 last_used_door=CASE WHEN last_used_at IS NULL OR last_used_at<=? THEN ? ELSE last_used_door END,last_request_id=?
 WHERE id=? AND ${authoritySql}
 AND (CASE WHEN minute=? THEN minute_requests ELSE 0 END)+1<=requests_per_minute
 AND (CASE WHEN minute=? THEN minute_bytes ELSE 0 END)+?<=accepted_bytes_per_minute
 AND (CASE WHEN utc_day=? THEN day_scanned_bytes ELSE 0 END)+?<=scanned_bytes_per_day
 AND (CASE WHEN utc_day=? THEN day_usd_micros ELSE 0 END)+?<=usd_micros_per_day
 RETURNING id`)
 .bind(minute, minute, minute, bytes, bytes, day, day, scanned, scanned, day, usd, usd, now - 60000, now, now - 60000, url.pathname, requestId, row.id,
 ...authorityArgs, minute, minute, bytes, day, scanned, day, usd), ...(use.writes?.(fence, scope) ?? [])]
 const results = await env.DB.batch(statements)
 if (!results[0].results.length) {
  const stillLive = await env.DB.prepare(`SELECT c.id,c.revision,m.revision AS member_revision,o.version AS operator_version ${join} WHERE c.id=? AND ${live}`).bind(row.id, Date.now()).first<{id: string;revision: number;member_revision: number;operator_version: number}>()
  if (!stillLive) fail('invalid_credential', 401)
  if (stillLive.revision !== row.revision || stillLive.member_revision !== row.member_revision || stillLive.operator_version !== row.operator_version) fail('authority_changed', 409)
  const daily = (row.utc_day === day ? row.day_scanned_bytes : 0) + scanned > row.scanned_bytes_per_day || (row.utc_day === day ? row.day_usd_micros : 0) + usd > row.usd_micros_per_day
  throw new CredentialLimit(Math.max(1, Math.ceil(((daily ? (day + 1) * 86400000 : (minute + 1) * 60000) - now) / 1000)))
 }
 return { credential: { ...metadata(row, now), scope, lastUsedAt: row.last_used_at === null || row.last_used_at <= now - 60000 ? now : row.last_used_at, lastUsedDoor: row.last_used_at === null || row.last_used_at <= now - 60000 ? url.pathname : row.last_used_door }, fence, results: results.slice(1) }
}
