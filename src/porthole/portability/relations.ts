import { fail } from '../security/authority'
/** Read only staged rows. The product transaction repeats structural FK and
 * lifecycle guards, so concurrent changes cannot turn validation into a write. */
export async function validateRelations(db:D1Database,jobId:string):Promise<void> {
 const result=await db.prepare(`WITH staged AS (
 SELECT table_name,json_extract(payload,'$.row') AS value FROM porthole_archive_rows WHERE job_id=?
 ), batches AS (SELECT value FROM staged WHERE table_name='porthole_ingest_batches'),
 retained AS (SELECT table_name,value FROM staged WHERE table_name IN ('porthole_telemetry_records','porthole_telemetry_archive'))
 SELECT EXISTS(SELECT 1 FROM staged v WHERE v.table_name='porthole_dashboard_versions' AND NOT EXISTS(SELECT 1 FROM staged d WHERE d.table_name='porthole_dashboards' AND json_extract(d.value,'$.id')=json_extract(v.value,'$.id') AND json_extract(d.value,'$.revision')>=json_extract(v.value,'$.revision')))
 OR EXISTS(SELECT 1 FROM retained r LEFT JOIN batches b ON json_extract(b.value,'$.id')=json_extract(r.value,'$.batch_id')
 WHERE b.value IS NULL OR json_extract(r.value,'$.source_id')!=json_extract(b.value,'$.source_id')
 OR json_extract(r.value,'$.signal')!=json_extract(b.value,'$.signal')
 OR json_extract(r.value,'$.ordinal')>=json_extract(b.value,'$.record_count')
 OR json_extract(r.value,'$.id')!=json_extract(r.value,'$.batch_id')||':'||json_extract(r.value,'$.ordinal')
 OR json_extract(r.value,'$.team') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].team')
 OR json_extract(r.value,'$.service') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].service')
 OR json_extract(r.value,'$.environment') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].environment')
 OR json_extract(r.value,'$.event_time_ns') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].eventTimeNs')
 OR json_extract(r.value,'$.trace_id') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].traceId')
 OR json_extract(r.value,'$.span_id') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].spanId')
 OR json(json_extract(r.value,'$.payload')) IS NOT json(json_extract(json_extract(b.value,'$.records'),'$['||json_extract(r.value,'$.ordinal')||'].payload')))
 OR EXISTS(SELECT 1 FROM batches b WHERE
 (SELECT COUNT(*) FROM retained r WHERE r.table_name='porthole_telemetry_records' AND json_extract(r.value,'$.batch_id')=json_extract(b.value,'$.id'))!=CASE WHEN json_extract(b.value,'$.state')='complete' THEN json_extract(b.value,'$.record_count') ELSE 0 END
 OR (SELECT COUNT(*) FROM retained r WHERE r.table_name='porthole_telemetry_archive' AND json_extract(r.value,'$.batch_id')=json_extract(b.value,'$.id'))!=CASE WHEN json_extract(b.value,'$.state')='complete' THEN json_extract(b.value,'$.record_count') ELSE 0 END)
 OR EXISTS(SELECT 1 FROM staged q WHERE q.table_name='porthole_archive_quarantine' AND NOT EXISTS(SELECT 1 FROM staged o WHERE o.table_name='porthole_objects' AND json_extract(o.value,'$.id')=json_extract(q.value,'$.object_id')))
 AS invalid`).bind(jobId).first<{invalid:number}>()
 if(!result||result.invalid)fail('archive_semantics_invalid',422)
}
