export type Signal = 'traces' | 'metrics' | 'logs'
export interface TelemetryRecord {
 team: string; service: string; environment: string; eventTimeNs: string
 traceId: string | null; spanId: string | null; payload: Record<string, unknown>
 late: number; outOfOrder: number
}
export class IntakeError extends Error {
 constructor(readonly code: string, readonly status = 400, readonly retryAfter?: number) { super(code) }
}
export const invalid = (code: string, status = 400): never => { throw new IntakeError(code, status) }
export function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('invalid_message')
 return value as Record<string, unknown>
}
export function array(value: unknown): unknown[] {
 if (!Array.isArray(value)) return invalid('invalid_repeated_field')
 return value
}
export function nano(value: unknown): string {
 if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value) || BigInt(value) > 18446744073709551615n) return invalid('invalid_nanosecond_timestamp')
 return value.padStart(20, '0')
}
export const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
export function base64(bytes: Uint8Array): string {
 let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
 return btoa(value)
}
export async function sha256(bytes: Uint8Array): Promise<string> {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(n => n.toString(16).padStart(2, '0')).join('')
}
