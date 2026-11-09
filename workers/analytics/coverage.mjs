import { fail, integer, keys, text } from './protocol.mjs';

export async function state(db) {
 const row = await db.prepare('SELECT stopped,source_identity FROM analytics_control WHERE singleton=1').first();
 if (!row) fail('analytics_schema_unavailable', 503);
 return row;
}
export async function activeInventory(db) {
 const rows=(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('analytics_active_batches','analytics_batches','analytics_recoveries')").all()).results
 if(rows.some(row=>row.name==='analytics_active_batches'))return true
 // Only the actual pre-recovery schema can use its original inventory. A
 // missing current projection must never release fenced historical rows.
 const legacy=rows.find(row=>row.name==='analytics_batches')
 if(rows.some(row=>row.name==='analytics_recoveries')||!legacy||!/completion_sequence\s+INTEGER\s+NOT\s+NULL\s+UNIQUE\b/i.test(legacy.sql??''))fail('analytics_schema_unavailable',503)
 return false
}
export async function watermark(db) {
 const active=await activeInventory(db),table=active?'analytics_active_batches':'analytics_batches'
 // Include sequence zero: a replica containing sequence 2 without 1 covers zero.
 // The smallest sequence with no successor is the contiguous prefix, even
 // when later completed batches have arrived out of order.
 return db.prepare(`SELECT
  (SELECT MIN(p.sequence) FROM (SELECT 0 AS sequence UNION ALL SELECT completion_sequence FROM ${table}) p
   WHERE NOT EXISTS(SELECT 1 FROM ${table} n WHERE n.completion_sequence=p.sequence+1)) AS watermark,
  COALESCE(MAX(${active?'v':'b'}.completion_sequence),0) AS highestSequence,
  COUNT(*) AS batchCount,COALESCE(SUM(record_count),0) AS recordCount,
  MAX(replicated_at) AS lastReplicatedAt,MAX(accepted_at) AS lastAcceptedAt,
  MAX(completed_at) AS lastQueryableAt FROM analytics_batches b ${active?'JOIN analytics_active_batches v ON v.batch_id=b.id':''}`).first();
}
export async function coverage(db, input, { allowStopped = false } = {}) {
 text(input.sourceIdentity); integer(input.requiredWatermark);
 const control = await state(db);
 if (control.stopped && !allowStopped) fail('analytics_stopped', 503);
 if (control.source_identity !== input.sourceIdentity) fail('analytics_source_mismatch', 409);
 const result = await watermark(db);
 if (result.watermark < input.requiredWatermark) fail('analytics_incomplete_coverage', 409);
 const recovery=await activeInventory(db)?await db.prepare('SELECT inventory_digest,retained_batches,retained_records,fenced_batches,fenced_records,recovered_at FROM analytics_recoveries WHERE destination_identity=? ORDER BY recovered_at DESC LIMIT 1').bind(control.source_identity).first():null;
 return { ...result, sourceIdentity: control.source_identity, requiredWatermark: input.requiredWatermark, complete: true, recovery };
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
