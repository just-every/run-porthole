import type { HealthConfiguration, ReceiptInput, ReceiptRow } from './model'

/** Call only after a real worker action. Reading this receipt never refreshes it.
 * Last-known arrival/index times survive a failed observation and restart. */
export async function recordComponentReceipt(db: D1Database, input: ReceiptInput) {
 const now = Date.now(), freshness = input.freshnessMs ?? (await healthConfiguration(db)).freshness_ms
 await db.prepare(`INSERT INTO porthole_health_receipts(component,source,status,reason,observed_at,expires_at,last_accepted_at,last_queryable_at,evidence)
 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(component,source) DO UPDATE SET status=excluded.status,reason=excluded.reason,
 observed_at=excluded.observed_at,expires_at=excluded.expires_at,
 last_accepted_at=CASE WHEN excluded.last_accepted_at IS NULL THEN last_accepted_at WHEN last_accepted_at IS NULL THEN excluded.last_accepted_at ELSE MAX(last_accepted_at,excluded.last_accepted_at) END,
 last_queryable_at=CASE WHEN excluded.last_queryable_at IS NULL THEN last_queryable_at WHEN last_queryable_at IS NULL THEN excluded.last_queryable_at ELSE MAX(last_queryable_at,excluded.last_queryable_at) END,
 evidence=CASE WHEN excluded.evidence='{}' AND excluded.status='Unknown' THEN evidence ELSE excluded.evidence END`)
 .bind(input.component,input.source,input.status,input.reason,now,now+freshness,input.lastAcceptedAt??null,input.lastQueryableAt??null,JSON.stringify(input.evidence??{})).run()
}
export async function healthConfiguration(db: D1Database): Promise<HealthConfiguration> {
 const row = await db.prepare('SELECT revision,freshness_ms,notices_enabled,recipient,configured_by,changed_at FROM porthole_health_configuration WHERE singleton=1').first<HealthConfiguration>()
 if (!row) throw new Error('health_configuration_unavailable')
 return row
}
export async function healthReceipts(db: D1Database): Promise<ReceiptRow[]> {
 return (await db.prepare('SELECT * FROM porthole_health_receipts').all<ReceiptRow>()).results
}
