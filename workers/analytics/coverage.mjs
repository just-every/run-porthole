import { fail, integer, keys, text } from './protocol.mjs';

export async function state(db) {
 const row = await db.prepare('SELECT stopped,source_identity FROM analytics_control WHERE singleton=1').first();
 if (!row) fail('analytics_schema_unavailable', 503);
 return row;
}
export async function watermark(db) {
 // Include sequence zero: a replica containing sequence 2 without 1 covers zero.
 // The smallest sequence with no successor is the contiguous prefix, even
 // when later completed batches have arrived out of order.
 return db.prepare(`SELECT
  (SELECT MIN(p.sequence) FROM (SELECT 0 AS sequence UNION ALL SELECT completion_sequence FROM analytics_batches) p
   WHERE NOT EXISTS(SELECT 1 FROM analytics_batches n WHERE n.completion_sequence=p.sequence+1)) AS watermark,
  COALESCE(MAX(completion_sequence),0) AS highestSequence,
  COUNT(*) AS batchCount,COALESCE(SUM(record_count),0) AS recordCount,
  MAX(replicated_at) AS lastReplicatedAt,MAX(accepted_at) AS lastAcceptedAt,
  MAX(completed_at) AS lastQueryableAt FROM analytics_batches`).first();
}
export async function coverage(db, input, { allowStopped = false } = {}) {
 text(input.sourceIdentity); integer(input.requiredWatermark);
 const control = await state(db);
 if (control.stopped && !allowStopped) fail('analytics_stopped', 503);
 if (control.source_identity !== input.sourceIdentity) fail('analytics_source_mismatch', 409);
 const result = await watermark(db);
 if (result.watermark < input.requiredWatermark) fail('analytics_incomplete_coverage', 409);
 return { ...result, sourceIdentity: control.source_identity, requiredWatermark: input.requiredWatermark, complete: true };
}
export async function coverageRequest(db, input) {
 keys(input, ['sourceIdentity', 'requiredWatermark']);
 return coverage(db, input);
}
export async function health(db) {
 const control = await state(db);
 return { status: control.stopped ? 'stopped' : 'ready', stopped: !!control.stopped, sourceIdentity: control.source_identity, ...await watermark(db) };
}
export async function control(db, input) {
 keys(input, ['stopped']);
 if (typeof input.stopped !== 'boolean') fail('invalid_control');
 await db.prepare('UPDATE analytics_control SET stopped=? WHERE singleton=1').bind(input.stopped ? 1 : 0).run();
 return health(db);
}
