import { administrative, fail, parseScope, scopeWithin, type Member, type Scope } from '../security/authority'

export const classes = ['ingest', 'change-event', 'read', 'proposal', 'execution'] as const
export type CredentialClass = typeof classes[number]
export interface CredentialScope extends Scope { signals: string[]; actions: string[] }
export interface Quotas { requestsPerMinute: number; acceptedBytesPerMinute: number; scannedBytesPerDay: number; usdMicrosPerDay: number }
const day = 86_400_000
export const lifetime: Record<CredentialClass, [number, number]> = {
 ingest: [365 * day, 730 * day], 'change-event': [365 * day, 730 * day], read: [365 * day, 730 * day], proposal: [30 * day, 90 * day], execution: [day, 7 * day],
}
export const actions: Record<CredentialClass, string[]> = {
 ingest: ['telemetry.write'], 'change-event': ['change.deploy', 'change.config', 'change.flag'],
 read: ['telemetry.read', 'definitions.read'], proposal: ['telemetry.read', 'definitions.read', 'proposal.create'], execution: ['plan.execute'],
}
export function credentialClass(value: unknown): CredentialClass {
 if (typeof value !== 'string' || !classes.includes(value as CredentialClass)) return fail('invalid_class', 400)
 return value as CredentialClass
}
export function mayMint(member: Member, kind: CredentialClass) {
 if (!administrative(member.role) || (['proposal', 'execution'].includes(kind) && member.role !== 'owner')) fail('credential_forbidden')
}
function list(value: unknown): string[] {
 if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(v => typeof v !== 'string' || !/^(\*|[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119})$/.test(v)) || new Set(value).size !== value.length) fail('invalid_scope', 400)
 return value as string[]
}
export function credentialScope(value: unknown, kind: CredentialClass, member: Member): CredentialScope {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['services', 'environments', 'teams', 'signals', 'actions'].includes(key))) fail('invalid_scope', 400)
 const raw = value as CredentialScope
 const scope = parseScope({ services: raw.services, environments: raw.environments, teams: raw.teams })
 if (!scope.services.length || !scope.environments.length || !scopeWithin(scope, member.scope)) fail('scope_forbidden')
 const signals = list(raw.signals), granted = list(raw.actions)
 if (signals.some(signal => !['logs', 'metrics', 'traces', 'profiles', 'events'].includes(signal)) || granted.some(action => !actions[kind].includes(action))) fail('scope_forbidden')
 return { ...scope, signals, actions: granted }
}
export function expiry(value: unknown, kind: CredentialClass, now: number): number {
 const result = value === undefined || value === '' ? now + lifetime[kind][0] : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
 if (!Number.isSafeInteger(result) || result <= now || result > now + lifetime[kind][1]) fail('invalid_expiry', 400)
 return result
}
export function positive(value: unknown, fallback: number): number {
 if (value === undefined || value === '') return fallback
 const result = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN
 return Number.isSafeInteger(result) && result > 0 ? result : fail('invalid_quota', 400)
}
export function quotas(value: Record<string, unknown>, kind: CredentialClass): Quotas {
 let budget = value.usdMicrosPerDay
 if (value.usdPerDay !== undefined) {
  if (budget !== undefined || typeof value.usdPerDay !== 'string' || !/^[0-9]+(?:\.[0-9]{1,6})?$/.test(value.usdPerDay)) fail('invalid_quota', 400)
  const [dollars, fraction = ''] = value.usdPerDay.split('.')
  budget = Number(BigInt(dollars) * 1000000n + BigInt(fraction.padEnd(6, '0')))
 }
 return { requestsPerMinute: positive(value.requestsPerMinute, 600), acceptedBytesPerMinute: positive(value.acceptedBytesPerMinute, 10 * 1024 * 1024), scannedBytesPerDay: positive(value.scannedBytesPerDay, 10 * 1024 ** 3), usdMicrosPerDay: positive(budget, 10_000_000) }
}
export function intersect(scope: CredentialScope, member: Scope): CredentialScope {
 const values = (wanted: string[], held: string[]) => held.includes('*') ? wanted : wanted.includes('*') ? held : wanted.filter(value => held.includes(value))
 return { ...scope, services: values(scope.services, member.services), environments: values(scope.environments, member.environments), teams: values(scope.teams, member.teams) }
}
export async function secretHash(secret: string): Promise<string> {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export function newSecret(): string {
 const bytes = crypto.getRandomValues(new Uint8Array(32))
 return `ph_${btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`
}
