import { baseOperatorAuth, type Bindings } from '../../auth.server'
import { AuthError, type Session } from '../../modules/operator-auth/index.mjs'

export const roles = ['owner', 'admin', 'maintainer', 'responder', 'read-only analyst', 'finance reader', 'restricted contractor'] as const
export type ProductRole = typeof roles[number]
export interface Scope { services: string[]; environments: string[]; teams: string[] }
export interface Member { operatorId: string; role: ProductRole; scope: Scope; revision: number }
export interface Authority { session: Session; member: Member; fence: string; args: unknown[] }
export function fail(code: string, status = 403): never { throw new AuthError(code, status) }
export const baseRole = (role: ProductRole) => role === 'owner' || role === 'admin' ? role : 'member'
export const administrative = (role: ProductRole) => role === 'owner' || role === 'admin'
export const allScope: Scope = { services: ['*'], environments: ['*'], teams: ['*'] }
export const emptyScope: Scope = { services: [], environments: [], teams: [] }

export async function memberFor(db: D1Database, id: string): Promise<Member | null> {
 const row = await db.prepare(`SELECT m.operator_id,m.role,m.scope,m.revision,o.role AS base_role FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=?`).bind(id).first<{operator_id: string;role: ProductRole;scope: string;revision: number;base_role: string}>()
 if (!row || !roles.includes(row.role) || row.base_role !== baseRole(row.role)) return null
 return { operatorId: row.operator_id, role: row.role, scope: JSON.parse(row.scope) as Scope, revision: row.revision }
}
export function sameOrigin(request: Request, env: Bindings, post = false) {
 const url = new URL(request.url)
 if (url.origin !== env.AUTH_ORIGIN || request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase() || request.headers.get('sec-fetch-site') === 'cross-site') fail('invalid_origin')
 if (post && (request.method !== 'POST' || request.headers.get('origin') !== env.AUTH_ORIGIN)) fail('invalid_origin')
}
export async function authority(request: Request, env: Bindings, options: { manage?: boolean; stepUp?: boolean; post?: boolean } = {}): Promise<Authority> {
 sameOrigin(request, env, options.post)
 if (request.headers.has('authorization')) fail('native_session_required')
 const session = await baseOperatorAuth(env).getSession(request)
 if (!session) fail('unauthenticated', 401)
 const member = await memberFor(env.DB, session.operator.id)
 if (!member) fail('authority_changed', 409)
 if (options.manage && !administrative(member.role)) fail('membership_forbidden')
 const now = Date.now()
 // Base has already checked provider/session provenance. Repeat its live session
 // and generation fence alongside the product revision in each SQL mutation.
 const fence = `EXISTS(SELECT 1 FROM oa_sessions a JOIN oa_operators ao ON ao.id=a.operator_id JOIN porthole_members am ON am.operator_id=ao.id
 WHERE a.id=? AND a.revoked_at IS NULL AND a.expires_at>? AND a.operator_version=ao.version AND ao.id=? AND ao.version=? AND ao.status='active' AND am.revision=?
 AND ao.role=CASE WHEN am.role IN ('owner','admin') THEN am.role ELSE 'member' END
 AND (a.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings c ON c.singleton=1 AND c.idp_sign_in=1 AND c.generation=p.generation WHERE p.session_id=a.id)))`
 const args: unknown[] = [session.id, now, member.operatorId, session.operator.version, member.revision]
 if (options.stepUp) await freshProof(env.DB, session)
 return { session, member, fence, args }
}
export async function freshProof(db: D1Database, session: Session) {
 const since = Date.now() - 300000
 const proof = await db.prepare(`SELECT EXISTS(SELECT 1 FROM oa_step_up_challenges WHERE session_id=? AND operator_id=? AND operator_version=? AND consumed_at>=?)
 OR EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_tokens t ON t.id=s.source_token_id WHERE s.id=? AND s.kind='native' AND s.created_at>=? AND t.consumed_at>=?) AS fresh`)
 .bind(session.id, session.operator.id, session.operator.version, since, session.id, since, since).first<{fresh: number}>()
 if (!proof?.fresh) fail('step_up_required')
}
export function proofFence(actor: Authority): { sql: string; args: unknown[] } {
 const since = Date.now() - 300000
 return { sql: `(EXISTS(SELECT 1 FROM oa_step_up_challenges WHERE session_id=? AND operator_id=? AND operator_version=? AND consumed_at>=?) OR EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_tokens t ON t.id=s.source_token_id WHERE s.id=? AND s.kind='native' AND s.created_at>=? AND t.consumed_at>=?))`, args: [actor.session.id, actor.member.operatorId, actor.session.operator.version, since, actor.session.id, since, since] }
}
export function scopeWithin(wanted: Scope, held: Scope): boolean {
 return (['services','environments','teams'] as const).every(key => wanted[key].every(value => held[key].includes('*') || held[key].includes(value)))
}
export function parseScope(input: unknown, role?: ProductRole): Scope {
 const scope = input as Scope
 if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['services','environments','teams'].includes(key))) fail('invalid_scope', 400)
 for (const key of ['services','environments','teams'] as const) {
  if (!Array.isArray(scope[key]) || scope[key].length > 100 || scope[key].some(value => typeof value !== 'string' || !/^(\*|[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119})$/.test(value)) || new Set(scope[key]).size !== scope[key].length) fail('invalid_scope', 400)
 }
 if (role === 'restricted contractor' && (!scope.services.length || !scope.environments.length || Object.values(scope).some(values => values.includes('*')))) fail('contractor_requires_explicit_scope', 400)
 return scope
}
