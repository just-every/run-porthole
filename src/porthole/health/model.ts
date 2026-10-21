import type { Bindings } from '../../auth.server'
export const components = ['control-plane','collector','ingest','queue','storage','query','monitor-evaluation','delivery'] as const
export type Component = typeof components[number]
export type HealthStatus = 'Healthy' | 'Unknown'
export type HealthBindings = Bindings
export interface ReceiptInput {
 component: Component; source: string; status: HealthStatus; reason: string
 lastAcceptedAt?: number | null; lastQueryableAt?: number | null
 evidence?: Record<string, unknown>; freshnessMs?: number
}
export interface ReceiptRow {
 component: Component; source: string; status: HealthStatus; reason: string
 observed_at: number; expires_at: number; last_accepted_at: number | null; last_queryable_at: number | null; evidence: string
}
export interface HealthConfiguration {
 revision: number; freshness_ms: number; notices_enabled: number; recipient: string | null; configured_by: string | null; changed_at: number
}
export interface HealthComponent {
 component: Component; status: HealthStatus; reason: string; checkedAt: string
 observedAt: string | null; lastAcceptedAt: string | null; lastQueryableAt: string | null
 evidence: Record<string, unknown>
}
export interface HealthState {
 version: number; status: HealthStatus; checkedAt: string; lastAcceptedAt: string | null; lastQueryableAt: string | null
 components: HealthComponent[]; configuration: { revision: number; freshnessSeconds: number; noticesEnabled: boolean; recipient: string | null; transport: string }
}
export const iso = (value: number | null | undefined) => value == null ? null : new Date(value).toISOString()
