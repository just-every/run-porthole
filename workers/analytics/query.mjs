import {compileLogSearch} from './log-search.mjs';
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
 keys(input, ['sourceIdentity', 'requiredWatermark', 'signal', 'from', 'through', 'scope', 'team', 'service', 'environment', 'limit', 'cursor', 'snapshot', 'archive', 'mode', 'trace', 'metric', 'uncertain', 'logSearch', 'scanLimit']);
 signal(input.signal); object(input.scope); keys(input.scope, ['teams', 'services', 'environments']);
 const from = nano(input.from), through = nano(input.through);
 if (from > through) fail('invalid_query_range');
 if (input.mode !== undefined && !['records', 'count','estimate'].includes(input.mode)) fail('invalid_query_mode');
 if (input.archive !== undefined && typeof input.archive !== 'boolean') fail('invalid_archive');
 const limit = input.limit ?? 100; integer(limit, 1, input.trace ? 2000 : limits.page);
 const scanLimit=input.scanLimit??null;
 if(scanLimit!==null){integer(scanLimit,1,Math.min(limit,limits.page));if(input.mode==='count')fail('invalid_query_mode')}
 const time=input.uncertain?"printf('%020d',CAST(json_extract(r.payload,'$.delivery.receivedTimeUnixNano') AS INTEGER))":'r.event_time_ns';
 const clauses = ['r.signal=?', `${time}>=?`, `${time}<=?`, 'b.completion_sequence<=?'];
 if(input.uncertain!==undefined){if(input.uncertain!==true||input.mode!=='count')fail('invalid_query');clauses.push("json_extract(r.payload,'$.delivery.uncertainTime')=1")}
 if(input.trace!==undefined){if(input.signal!=='traces'||typeof input.trace!=='string'||!/^[a-f0-9]{32}$/.test(input.trace))fail('invalid_trace_id');clauses.push('r.trace_id=?')}
 if(input.metric!==undefined){if(input.signal!=='metrics'||typeof input.metric!=='string'||!input.metric.trim().length||input.metric.length>120||/[\u0000-\u001f\u007f-\u009f]/u.test(input.metric))fail('invalid_metric_name');clauses.push("json_extract(r.payload,'$.metric.name')=?")}
 const snapshot = input.snapshot ?? input.requiredWatermark;
 integer(snapshot); integer(input.requiredWatermark);
 if (snapshot > input.requiredWatermark) fail('invalid_query_snapshot');
 const args = [input.signal, from, through, snapshot];
 if(input.trace!==undefined)args.push(input.trace);
 if(input.metric!==undefined)args.push(input.metric);
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
 let logSearch;
 if (input.logSearch !== undefined) {
  if (input.signal !== 'logs') fail('invalid_log_search_signal');
  logSearch = compileLogSearch(input.logSearch, input.scope);
  if(scanLimit===null&&input.mode!=='estimate'){clauses.push(logSearch.sql);args.push(...logSearch.args)}
 }
 const covered = await coverage(db, input);
 const selection = `FROM analytics_records r JOIN analytics_batches b ON b.id=r.batch_id WHERE ${clauses.join(' AND ')}`;
 if(input.mode==='estimate'){
  const estimate=await db.prepare(`SELECT COUNT(*) AS candidateRecords,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS payloadBytes FROM (SELECT r.payload ${selection} ORDER BY r.event_time_ns,r.id LIMIT 10001)`).bind(...args).first();
  await coverage(db,input);
  return {...covered,snapshot,from,through,records:[],cursor:null,estimate:{...estimate,exact:estimate.candidateRecords<=10000,basis:'authorized-candidates-before-log-predicate',measurementCap:10001},coverage:{state:'estimate',complete:false}};
 }
 if(scanLimit!==null){
  const result=await db.prepare(`WITH candidates AS MATERIALIZED (SELECT r.* ${selection} ORDER BY r.event_time_ns,r.id LIMIT ?) SELECT r.*,CASE WHEN ${logSearch?.sql??'1'} THEN 1 ELSE 0 END AS query_match FROM candidates r ORDER BY r.event_time_ns,r.id`).bind(...args,scanLimit,...(logSearch?.args??[])).all();
  const candidates=result.results,last=candidates.at(-1),next=candidates.length===scanLimit&&last?btoa(JSON.stringify([last.event_time_ns,last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null;
  let records=candidates.filter(row=>row.query_match===1).map(({query_match,...row})=>({...row,payload:JSON.parse(row.payload)}));
  if(input.archive){if(records.some(row=>row.archived_at===null))fail('analytics_archive_coverage_missing',503);records=records.map(({indexed_at,late,out_of_order,...row})=>row)}else records=records.map(({archived_at,...row})=>row);
  const response={...covered,snapshot,from,through,records,cursor:next,archive:!!input.archive,coverage:{state:next?'partial':'complete',reason:next?'scan_limit':null,scannedCandidates:candidates.length,scannedPayloadBytes:candidates.reduce((sum,row)=>sum+new TextEncoder().encode(row.payload).length,0),matchedRecords:records.length}};
  if(new TextEncoder().encode(JSON.stringify(response)).byteLength>limits.responseBytes)fail('query_response_too_large',413);
  await coverage(db,input);return response;
 }
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
 if(input.archive){if(rows.some(row=>row.archived_at===null))fail('analytics_archive_coverage_missing',503);rows=rows.map(({indexed_at,late,out_of_order,...row})=>row)}else rows=rows.map(({archived_at,...row})=>row);
 const last = rows.at(-1);
 const next = more && last ? btoa(JSON.stringify([last.event_time_ns, last.id])).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') : null;
 const response = { ...covered, snapshot, from, through, records: rows, cursor: next, archive: !!input.archive };
 if (new TextEncoder().encode(JSON.stringify(response)).byteLength > limits.responseBytes) fail('query_response_too_large', 413);
 return response;
}
