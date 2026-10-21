/** Only server-selected metadata enters this store. Never pass a body, URL or exception. */
export const genesis = '0'.repeat(64)
export type Phase = 'attempted' | 'succeeded' | 'denied' | 'failed'
export interface AuditInput {
 operationRef: string
 actorRef: string | null
 actorRevision: number | null
 action: string
 entityRef: string | null
 revision: number | null
 phase: Phase
 status: number | null
 occurredAt: number
 rangeStart?: number | null
 rangeEnd?: number | null
}
export interface AuditEntry extends AuditInput {
 version: 1
 sequence: number
 eventId: string
 recordedAt: number
 previousHash: string
 rangeStart: number | null
 rangeEnd: number | null
}
export interface AuditRecord { entry: AuditEntry; hash: string }
export interface Checkpoint { sequence: number; hash: string }
const encoder = new TextEncoder()
export const canonical = (entry: AuditEntry) => JSON.stringify(Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))))
export async function digest(text: string): Promise<string> {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('')
}
export async function checkpoint(db: D1Database): Promise<Checkpoint> {
 return await db.prepare('SELECT sequence,hash FROM porthole_audit_entries ORDER BY sequence DESC LIMIT 1').first<Checkpoint>() ?? { sequence: 0, hash: genesis }
}
export async function append(db: D1Database, input: AuditInput): Promise<AuditRecord> {
 // The unique predecessor and insert trigger serialize concurrent requests. The
 // SELECT guard avoids writing against an obsolete head; no fork is accepted.
 for (let attempt = 0; attempt < 12; attempt++) {
  const head = await checkpoint(db)
  const entry: AuditEntry = { ...input, rangeStart: input.rangeStart ?? null, rangeEnd: input.rangeEnd ?? null,
   version: 1, sequence: head.sequence + 1, eventId: crypto.randomUUID(), recordedAt: Date.now(), previousHash: head.hash }
  const encoded = canonical(entry), hash = await digest(encoded)
  const result = await db.prepare(`INSERT INTO porthole_audit_entries(sequence,event_id,previous_hash,hash,entry)
   SELECT ?,?,?,?,? WHERE COALESCE((SELECT MAX(sequence) FROM porthole_audit_entries),0)=?`)
   .bind(entry.sequence, entry.eventId, entry.previousHash, hash, encoded, head.sequence).run()
  if (result.meta.changes === 1) return { entry, hash }
 }
 throw new Error('audit_busy')
}
export async function read(db: D1Database, after: number, through: number, limit: number): Promise<AuditRecord[]> {
 const rows = (await db.prepare('SELECT entry,hash FROM porthole_audit_entries WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?')
  .bind(after, through, limit).all<{ entry: string; hash: string }>()).results
 return rows.map(row => ({ entry: JSON.parse(row.entry) as AuditEntry, hash: row.hash }))
}
export async function verify(records: AuditRecord[], expected: Checkpoint): Promise<boolean> {
 let sequence = 0, hash = genesis
 for (const record of records) {
  if (record.entry.sequence !== ++sequence || record.entry.previousHash !== hash || await digest(canonical(record.entry)) !== record.hash) return false
  hash = record.hash
 }
 return sequence === expected.sequence && hash === expected.hash
}
