import { fail, proofFence, type Authority } from '../security/authority'
import { newSecret, secretHash, type CredentialClass, type CredentialScope, type Quotas } from './policy'

export interface CredentialRow {
 id: string; name: string; class: CredentialClass; custodian_id: string; scope: string; status: 'active' | 'revoked' | 'suspended'; revision: number
 prefix: string; last_four: string; created_at: number; expires_at: number; revoked_at: number | null; suspended_at: number | null
 predecessor_id: string | null; successor_id: string | null; last_used_at: number | null; last_used_door: string | null
 requests_per_minute: number; accepted_bytes_per_minute: number; scanned_bytes_per_day: number; usd_micros_per_day: number
}
export const metadataColumns = `id,name,class,custodian_id,scope,status,revision,prefix,last_four,created_at,expires_at,revoked_at,suspended_at,predecessor_id,successor_id,last_used_at,last_used_door,requests_per_minute,accepted_bytes_per_minute,scanned_bytes_per_day,usd_micros_per_day`
export function metadata(row: CredentialRow, now = Date.now()) {
 const remaining = row.expires_at - now
 return { id: row.id, name: row.name, class: row.class, custodianId: row.custodian_id, scope: JSON.parse(row.scope) as CredentialScope,
  status: row.status === 'active' && remaining <= 0 ? 'expired' : row.status, revision: row.revision, masked: `${row.prefix}…${row.last_four}`,
  createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, lastUsedDoor: row.last_used_door,
  warning: row.status !== 'active' ? null : remaining <= 0 ? 'expired' : remaining <= 7 * 86400000 ? 'expires_within_7_days' : remaining <= 30 * 86400000 ? 'expires_within_30_days' : null,
  quotas: { requestsPerMinute: row.requests_per_minute, acceptedBytesPerMinute: row.accepted_bytes_per_minute, scannedBytesPerDay: row.scanned_bytes_per_day, usdMicrosPerDay: row.usd_micros_per_day } }
}
export async function listCredentials(db: D1Database): Promise<CredentialRow[]> {
 return (await db.prepare(`SELECT ${metadataColumns} FROM porthole_credentials ORDER BY created_at DESC,id`).all<CredentialRow>()).results
}
export async function credentialFor(db: D1Database, id: string): Promise<CredentialRow> {
 return await db.prepare(`SELECT ${metadataColumns} FROM porthole_credentials WHERE id=?`).bind(id).first<CredentialRow>() ?? fail('credential_not_found', 404)
}
export async function mint(db: D1Database, actor: Authority, options: { name: string; kind: CredentialClass; scope: CredentialScope; expiresAt: number; quotas: Quotas }, previous?: CredentialRow, overlap = 0) {
 const id = crypto.randomUUID(), secret = newSecret(), hash = await secretHash(secret), now = Date.now(), proof = proofFence(actor)
 const q = options.quotas
 const insert = db.prepare(`INSERT INTO porthole_credentials(id,name,class,custodian_id,secret_hash,prefix,last_four,scope,created_at,expires_at,requests_per_minute,accepted_bytes_per_minute,scanned_bytes_per_day,usd_micros_per_day,predecessor_id)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.fence} AND ${proof.sql}${previous ? " AND EXISTS(SELECT 1 FROM porthole_credentials WHERE id=? AND revision=? AND status='active' AND expires_at>? AND successor_id IS NULL AND custodian_id=?)" : ''} RETURNING ${metadataColumns}`)
 .bind(id, options.name, options.kind, actor.member.operatorId, hash, secret.slice(0, 7), secret.slice(-4), JSON.stringify(options.scope), now, options.expiresAt, q.requestsPerMinute, q.acceptedBytesPerMinute, q.scannedBytesPerDay, q.usdMicrosPerDay, previous?.id ?? null,
 ...actor.args, ...proof.args, ...(previous ? [previous.id, previous.revision, now, actor.member.operatorId] : []))
 const statements = [insert]
 if (previous) statements.push(db.prepare(`UPDATE porthole_credentials SET successor_id=?,expires_at=CASE WHEN ?=0 THEN expires_at ELSE MIN(expires_at,?) END,status=CASE WHEN ?=0 THEN 'revoked' ELSE status END,revoked_at=CASE WHEN ?=0 THEN ? ELSE revoked_at END,revision=revision+1
 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM porthole_credentials WHERE id=?) AND ${actor.fence} AND ${proof.sql}`)
 .bind(id, overlap, now + overlap, overlap, overlap, now, previous.id, previous.revision, id, ...actor.args, ...proof.args))
 const results = await db.batch<CredentialRow>(statements), row = results[0].results[0]
 if (!row || previous && !results[1].meta.changes) fail('authority_changed', 409)
 return { credential: metadata(row), secret }
}
export async function rescope(db: D1Database, actor: Authority, previous: CredentialRow, scope: CredentialScope) {
 const proof = proofFence(actor)
 const row = await db.prepare(`UPDATE porthole_credentials SET scope=?,revision=revision+1 WHERE id=? AND revision=? AND status='active' AND expires_at>? AND custodian_id=? AND ${actor.fence} AND ${proof.sql} RETURNING ${metadataColumns}`)
 .bind(JSON.stringify(scope), previous.id, previous.revision, Date.now(), actor.member.operatorId, ...actor.args, ...proof.args).first<CredentialRow>()
 return row ? metadata(row) : fail('authority_changed', 409)
}
export async function revoke(db: D1Database, actor: Authority, previous: CredentialRow) {
 const row = await db.prepare(`UPDATE porthole_credentials SET status='revoked',revoked_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='active' AND ${actor.fence} RETURNING ${metadataColumns}`)
 .bind(Date.now(), previous.id, previous.revision, ...actor.args).first<CredentialRow>()
 if (!row) {
  if (previous.status !== 'active') return metadata(previous)
  fail('authority_changed', 409)
 }
 return metadata(row)
}
// Include before the membership mutation in the SAME D1 batch. The database
// custody trigger validates every moved scope against the live successor.
// Passing a different active successor supports an acting owner's step-down.
export function handoverIngest(db: D1Database, departingId: string, actor: Authority, successorId = actor.member.operatorId): D1PreparedStatement {
 const proof = proofFence(actor)
 if (departingId === successorId) {
  return db.prepare(`UPDATE porthole_credentials SET custodian_id=COALESCE((SELECT m.operator_id FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id
  WHERE m.operator_id!=? AND m.role IN ('owner','admin') AND o.role=m.role AND o.status='active'
  AND NOT EXISTS(SELECT 1 FROM json_each(porthole_credentials.scope,'$.services') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.services') h WHERE h.value='*' OR h.value=w.value))
  AND NOT EXISTS(SELECT 1 FROM json_each(porthole_credentials.scope,'$.environments') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.environments') h WHERE h.value='*' OR h.value=w.value))
  AND NOT EXISTS(SELECT 1 FROM json_each(porthole_credentials.scope,'$.teams') w WHERE NOT EXISTS(SELECT 1 FROM json_each(m.scope,'$.teams') h WHERE h.value='*' OR h.value=w.value))
  ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.operator_id LIMIT 1),custodian_id),revision=revision+1
  WHERE custodian_id=? AND class='ingest' AND status='active' AND ${actor.fence} AND ${proof.sql}`)
  .bind(departingId, departingId, ...actor.args, ...proof.args)
 }
 return db.prepare(`UPDATE porthole_credentials SET custodian_id=?,revision=revision+1 WHERE custodian_id=? AND class='ingest' AND status='active' AND ?!=? AND ${actor.fence} AND ${proof.sql}`)
 .bind(successorId, departingId, departingId, successorId, ...actor.args, ...proof.args)
}
