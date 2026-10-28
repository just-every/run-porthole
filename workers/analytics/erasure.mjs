import { fail, integer, keys, limits, text } from './protocol.mjs';
import { state, watermark } from './coverage.mjs';

// Arguments are internal SQL expressions, never request-controlled identifiers.
export const erasedRecord = (batchId, batchDigest, ordinal) => `EXISTS(
 SELECT 1 FROM analytics_erased_batches e WHERE (e.id=${batchId} OR e.content_digest=${batchDigest})
 AND (e.ordinals IS NULL OR EXISTS(SELECT 1 FROM json_each(e.ordinals) o WHERE o.value=${ordinal})))`;

export function guard(db, condition, args = []) {
 return db.prepare(`INSERT INTO analytics_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${condition} THEN 1 ELSE 0 END)
 ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...args);
}
export function sourceStatements(db, sourceIdentity) {
 return [db.prepare('UPDATE analytics_control SET source_identity=? WHERE singleton=1 AND source_identity IS NULL').bind(sourceIdentity),
  guard(db,'(SELECT source_identity FROM analytics_control WHERE singleton=1)=?',[sourceIdentity])];
}

export async function erase(db, input) {
 keys(input, ['sourceIdentity', 'records']); text(input.sourceIdentity);
 if (!Array.isArray(input.records) || input.records.length > 100) fail('invalid_erasure_records');
 let selections = 0;
 for (const entry of input.records) {
  keys(entry, ['id', 'content_digest', 'erased_at', 'ordinals']); text(entry.id, 100);
  if (typeof entry.content_digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.content_digest)) fail('invalid_erasure_digest');
  integer(entry.erased_at);
  if (entry.ordinals !== null) {
   if (!Array.isArray(entry.ordinals) || !entry.ordinals.length) fail('invalid_erasure_ordinals');
   let previous = -1;
   for (const ordinal of entry.ordinals) {
    integer(ordinal); if (ordinal <= previous) fail('invalid_erasure_ordinals'); previous = ordinal;
   }
   selections += entry.ordinals.length;
  }
  if (selections > limits.records) fail('too_many_erasure_ordinals', 413);
 }
 const control = await state(db);
 if (control.source_identity && control.source_identity !== input.sourceIdentity) fail('analytics_source_mismatch', 409);
 const statements = sourceStatements(db, input.sourceIdentity);
 for (const entry of input.records) {
  statements.push(guard(db,`NOT EXISTS(SELECT 1 FROM analytics_erased_batches WHERE id=? AND content_digest<>?)
   AND NOT EXISTS(SELECT 1 FROM analytics_batches WHERE id=? AND digest<>?)`,[entry.id,entry.content_digest,entry.id,entry.content_digest]));
  statements.push(db.prepare(`INSERT INTO analytics_erased_batches(id,content_digest,erased_at,ordinals) VALUES(?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at),
   ordinals=CASE WHEN ordinals IS NULL OR excluded.ordinals IS NULL THEN NULL ELSE
   (SELECT json_group_array(value) FROM (SELECT value FROM json_each(analytics_erased_batches.ordinals)
    UNION SELECT value FROM json_each(excluded.ordinals) ORDER BY value)) END`)
   .bind(entry.id,entry.content_digest,entry.erased_at,entry.ordinals === null ? null : JSON.stringify(entry.ordinals)));
 }
 const selected = erasedRecord('r.batch_id','b.digest','r.ordinal');
 statements.push(db.prepare(`DELETE FROM analytics_records AS r WHERE EXISTS(
  SELECT 1 FROM analytics_batches b WHERE b.id=r.batch_id AND ${selected})`));
 statements.push(db.prepare(`UPDATE analytics_batches SET record_count=(SELECT COUNT(*) FROM analytics_records r WHERE r.batch_id=analytics_batches.id)
  WHERE EXISTS(SELECT 1 FROM analytics_erased_batches e WHERE e.id=analytics_batches.id OR e.content_digest=analytics_batches.digest)`));
 try { await db.batch(statements); }
 catch (error) {
  if (/CHECK constraint failed/.test(String(error?.message))) fail('analytics_identity_conflict', 409);
  throw error;
 }
 return { sourceIdentity: input.sourceIdentity, applied: input.records.length, ...await watermark(db) };
}
