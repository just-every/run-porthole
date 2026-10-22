import { fail, integer, keys, limits, nano, object, signal, text } from './protocol.mjs';
import { coverage } from './coverage.mjs';

function cursor(value) {
 if (typeof value !== 'string' || value.length > 1024) fail('invalid_query_cursor');
 try {
  const decoded = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
  if (!Array.isArray(decoded) || decoded.length !== 2) fail('invalid_query_cursor');
  return [nano(decoded[0]), text(decoded[1], 128)];
 } catch { fail('invalid_query_cursor'); }
}
export async function query(db, input) {
 keys(input, ['sourceIdentity', 'requiredWatermark', 'signal', 'from', 'through', 'scope', 'team', 'service', 'environment', 'limit', 'cursor', 'snapshot', 'archive', 'mode']);
 signal(input.signal); object(input.scope); keys(input.scope, ['teams', 'services', 'environments']);
 const from = nano(input.from), through = nano(input.through);
 if (from > through) fail('invalid_query_range');
 if (input.mode !== undefined && !['records', 'count'].includes(input.mode)) fail('invalid_query_mode');
 if (input.archive !== undefined && typeof input.archive !== 'boolean') fail('invalid_archive');
 const limit = input.limit ?? 100; integer(limit, 1, limits.page);
 const clauses = ['r.signal=?', 'r.event_time_ns>=?', 'r.event_time_ns<=?', 'b.completion_sequence<=?'];
 const snapshot = input.snapshot ?? input.requiredWatermark;
 integer(snapshot); integer(input.requiredWatermark);
 if (snapshot > input.requiredWatermark) fail('invalid_query_snapshot');
 const args = [input.signal, from, through, snapshot];
 for (const [column, plural] of [['team', 'teams'], ['service', 'services'], ['environment', 'environments']]) {
  const granted = input.scope[plural];
  if (!Array.isArray(granted) || granted.length > 100) fail('invalid_query_scope');
  granted.forEach(value => text(value, 1024, true));
  clauses.push(`EXISTS(SELECT 1 FROM json_each(?) s WHERE s.value='*' OR s.value=r.${column})`);
  args.push(JSON.stringify(granted));
  if (input[column] !== undefined) {
   text(input[column], 1024, true);
   if (!granted.includes('*') && !granted.includes(input[column])) fail('scope_forbidden', 403);
   clauses.push(`r.${column}=?`); args.push(input[column]);
  }
 }
 if (input.cursor !== undefined) {
  if (input.mode === 'count') fail('invalid_query_cursor');
  const [time, id] = cursor(input.cursor);
  clauses.push('(r.event_time_ns>? OR (r.event_time_ns=? AND r.id>?))'); args.push(time, time, id);
 }
 const covered = await coverage(db, input);
 const selection = `FROM analytics_records r JOIN analytics_batches b ON b.id=r.batch_id WHERE ${clauses.join(' AND ')}`;
 if (input.mode === 'count') {
  const row = await db.prepare(`SELECT COUNT(*) AS count ${selection}`).bind(...args).first();
  await coverage(db, input);
  return { ...covered, snapshot, from, through, count: row.count };
 }
 // Both row count and encoded payload bytes bound a page before D1 releases
 // it. A large source envelope cannot multiply into an unbounded query reply.
 const result = await db.prepare(`WITH candidates AS (
  SELECT r.*,length(CAST(r.payload AS BLOB))+1024 AS row_bytes ${selection} ORDER BY r.event_time_ns,r.id LIMIT ?
 ), sized AS (
  SELECT *,SUM(row_bytes) OVER (ORDER BY event_time_ns,id) AS cumulative_bytes FROM candidates
 ) SELECT *,(SELECT COUNT(*) FROM candidates) AS candidate_count FROM sized WHERE cumulative_bytes<=? ORDER BY event_time_ns,id`)
  .bind(...args, limit + 1, limits.responseBytes - 32768).all();
 let rows = result.results;
 if (!rows.length) {
  const first = await db.prepare(`SELECT r.id ${selection} LIMIT 1`).bind(...args).first();
  if (first) fail('query_record_too_large', 413);
 }
 const candidates = rows[0]?.candidate_count ?? 0;
 const more = candidates > Math.min(rows.length, limit);
 rows = rows.slice(0, limit).map(({ row_bytes: _bytes, cumulative_bytes: _sum, candidate_count: _count, ...row }) => ({ ...row, payload: JSON.parse(row.payload) }));
 await coverage(db, input);
 const last = rows.at(-1);
 const next = more && last ? btoa(JSON.stringify([last.event_time_ns, last.id])).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') : null;
 const response = { ...covered, snapshot, from, through, records: rows, cursor: next, archive: !!input.archive };
 if (new TextEncoder().encode(JSON.stringify(response)).byteLength > limits.responseBytes) fail('query_response_too_large', 413);
 return response;
}
