import { fail } from '../security/authority'
/** Materialize each intake record once, so validation never reparses its entire
 * large source envelope for every retained copy. All relationship, scope,
 * payload and completeness predicates remain inside the same guarded restore.
 * Read only staged rows. The product transaction repeats structural FK and
 * lifecycle guards, so concurrent changes cannot turn validation into a write. */
export async function validateRelations(db:D1Database,jobId:string):Promise<void> {
 const result=await db.prepare(`WITH staged AS MATERIALIZED (
 SELECT table_name,json_extract(payload,'$.row') AS value FROM porthole_archive_rows WHERE job_id=?
 ), batches AS MATERIALIZED (SELECT value,json_extract(value,'$.id') AS batch_id,json_extract(value,'$.records') AS records,json_extract(value,'$.source_id') AS source_id,json_extract(value,'$.signal') AS signal,json_extract(value,'$.record_count') AS record_count,json_extract(value,'$.state') AS state FROM staged WHERE table_name='porthole_ingest_batches'),
 batch_records AS MATERIALIZED (SELECT b.batch_id,CAST(j.key AS INTEGER) AS ordinal,j.value FROM batches b,json_each(b.records) j),
 log_points AS (SELECT value FROM staged WHERE table_name='porthole_log_metric_points'),
 pipelines AS (SELECT value FROM staged WHERE table_name='porthole_pipeline_versions'),
 retained AS MATERIALIZED (SELECT table_name,value,json_extract(value,'$.batch_id') AS batch_id,json_extract(value,'$.ordinal') AS ordinal FROM staged WHERE table_name IN ('porthole_telemetry_records','porthole_telemetry_archive')),
 retained_counts AS MATERIALIZED (SELECT table_name,batch_id,COUNT(*) AS n FROM retained GROUP BY table_name,batch_id),
 eligible_counts AS MATERIALIZED (SELECT batch_id,COUNT(*) AS n FROM batch_records WHERE COALESCE(json_extract(value,'$.payload.inputStage'),'accepted')!='pre-sampling' AND COALESCE(json_extract(value,'$.payload.pipeline.excluded'),0)=0 GROUP BY batch_id)
 SELECT EXISTS(SELECT 1 FROM batches b WHERE json_extract(b.value,'$.identity')='erased:'||json_extract(b.value,'$.id') AND (json_extract(b.value,'$.wire_base64')!='' OR json_extract(b.value,'$.records')!='[]' OR json_extract(b.value,'$.record_count')!=0 OR json_extract(b.value,'$.byte_count')!=0 OR NOT EXISTS(SELECT 1 FROM staged e WHERE e.table_name='porthole_erased_batches' AND json_extract(e.value,'$.id')=json_extract(b.value,'$.id') AND json_extract(e.value,'$.content_digest')=json_extract(b.value,'$.digest'))))
 OR EXISTS(SELECT 1 FROM staged p WHERE p.table_name='porthole_metric_points' AND (NOT EXISTS(SELECT 1 FROM staged d WHERE d.table_name='porthole_metric_rules' AND json_extract(d.value,'$.id')=json_extract(p.value,'$.rule_id') AND json_extract(d.value,'$.revision')=json_extract(p.value,'$.revision')) OR NOT EXISTS(SELECT 1 FROM batches b WHERE json_extract(b.value,'$.id')=json_extract(p.value,'$.batch_id') AND json_extract(p.value,'$.ordinal')<json_extract(b.value,'$.record_count'))))
 OR EXISTS(SELECT 1 FROM log_points p
 LEFT JOIN pipelines d ON json_extract(d.value,'$.revision')=json_extract(p.value,'$.revision')
 LEFT JOIN batches b ON json_extract(b.value,'$.id')=json_extract(p.value,'$.batch_id')
 WHERE d.value IS NULL OR b.value IS NULL OR json_extract(b.value,'$.signal')!='logs' OR json_extract(b.value,'$.state')!='complete'
 OR json_extract(p.value,'$.ordinal')>=json_extract(b.value,'$.record_count')
 OR json_extract(p.value,'$.revision') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].payload.pipeline.revision')
 OR json_extract(p.value,'$.event_time_ns') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].eventTimeNs')
 OR json_extract(p.value,'$.team') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].team')
 OR json_extract(p.value,'$.service') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].service')
 OR json_extract(p.value,'$.environment') IS NOT json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].environment')
 OR json_extract(p.value,'$.team') IS NOT json_extract(json_extract(d.value,'$.definition'),'$.team')
 OR json_extract(p.value,'$.service') IS NOT json_extract(json_extract(d.value,'$.definition'),'$.service')
 OR json_extract(p.value,'$.environment') IS NOT json_extract(json_extract(d.value,'$.definition'),'$.environment')
 OR NOT EXISTS(SELECT 1 FROM json_each(json_extract(d.value,'$.definition'),'$.metrics') m WHERE json_extract(m.value,'$.name')=json_extract(p.value,'$.name'))
 OR NOT EXISTS(SELECT 1 FROM json_each(json_extract(json_extract(b.value,'$.records'),'$['||json_extract(p.value,'$.ordinal')||'].payload.pipeline.metrics')) m WHERE m.value=json_extract(p.value,'$.name')))
 OR EXISTS(SELECT 1 FROM staged p WHERE p.table_name='porthole_notebook_publications' AND NOT EXISTS(SELECT 1 FROM staged n WHERE n.table_name='porthole_notebooks' AND json_extract(n.value,'$.id')=json_extract(p.value,'$.notebook_id') AND json_extract(n.value,'$.revision')>=json_extract(p.value,'$.source_revision')))
 OR EXISTS(SELECT 1 FROM staged n WHERE n.table_name='porthole_notebooks' AND NOT EXISTS(SELECT 1 FROM staged v WHERE v.table_name='porthole_notebook_versions' AND json_extract(v.value,'$.id')=json_extract(n.value,'$.id') AND json_extract(v.value,'$.revision')=json_extract(n.value,'$.revision') AND json_extract(v.value,'$.body')=json_extract(n.value,'$.body') AND json_extract(v.value,'$.scope')=json_extract(n.value,'$.scope')))
 OR EXISTS(SELECT 1 FROM staged p WHERE p.table_name='porthole_dashboard_publications' AND NOT EXISTS(SELECT 1 FROM staged d WHERE d.table_name='porthole_dashboards' AND json_extract(d.value,'$.id')=json_extract(p.value,'$.dashboard_id') AND json_extract(d.value,'$.revision')>=json_extract(p.value,'$.source_revision')))
 OR EXISTS(SELECT 1 FROM staged d WHERE d.table_name='porthole_dashboards' AND NOT EXISTS(SELECT 1 FROM staged v WHERE v.table_name='porthole_dashboard_versions' AND json_extract(v.value,'$.id')=json_extract(d.value,'$.id') AND json_extract(v.value,'$.revision')=json_extract(d.value,'$.revision') AND json_extract(v.value,'$.body')=json_extract(d.value,'$.body') AND json_extract(v.value,'$.scope')=json_extract(d.value,'$.scope') AND json_extract(v.value,'$.name')=json_extract(d.value,'$.name')))
 OR EXISTS(SELECT 1 FROM staged v WHERE v.table_name='porthole_dashboard_versions' AND NOT EXISTS(SELECT 1 FROM staged d WHERE d.table_name='porthole_dashboards' AND json_extract(d.value,'$.id')=json_extract(v.value,'$.id') AND json_extract(d.value,'$.revision')>=json_extract(v.value,'$.revision')))
 OR EXISTS(SELECT 1 FROM retained r LEFT JOIN batches b ON b.batch_id=r.batch_id LEFT JOIN batch_records original ON original.batch_id=r.batch_id AND original.ordinal=r.ordinal
 WHERE b.value IS NULL OR original.value IS NULL OR json_extract(r.value,'$.source_id')!=b.source_id
 OR json_extract(r.value,'$.signal')!=b.signal
 OR json_extract(r.value,'$.ordinal')>=b.record_count
 OR COALESCE(json_extract(original.value,'$.payload.pipeline.excluded'),0)!=0
 OR json_extract(r.value,'$.id')!=json_extract(r.value,'$.batch_id')||':'||json_extract(r.value,'$.ordinal')
 OR json_extract(r.value,'$.team') IS NOT json_extract(original.value,'$.team')
 OR json_extract(r.value,'$.service') IS NOT json_extract(original.value,'$.service')
 OR json_extract(r.value,'$.environment') IS NOT json_extract(original.value,'$.environment')
 OR json_extract(r.value,'$.event_time_ns') IS NOT json_extract(original.value,'$.eventTimeNs')
 OR json_extract(r.value,'$.trace_id') IS NOT json_extract(original.value,'$.traceId')
 OR json_extract(r.value,'$.span_id') IS NOT json_extract(original.value,'$.spanId')
 OR json(json_extract(r.value,'$.payload')) IS NOT json(json_extract(original.value,'$.payload')))
 OR EXISTS(SELECT 1 FROM batches b WHERE
 COALESCE((SELECT n FROM retained_counts r WHERE r.table_name='porthole_telemetry_records' AND r.batch_id=b.batch_id),0)!=CASE WHEN b.state='complete' THEN COALESCE((SELECT n FROM eligible_counts e WHERE e.batch_id=b.batch_id),0) ELSE 0 END
 OR COALESCE((SELECT n FROM retained_counts r WHERE r.table_name='porthole_telemetry_archive' AND r.batch_id=b.batch_id),0)!=CASE WHEN b.state='complete' THEN COALESCE((SELECT n FROM eligible_counts e WHERE e.batch_id=b.batch_id),0) ELSE 0 END)
 OR EXISTS(SELECT 1 FROM staged q WHERE q.table_name='porthole_archive_quarantine' AND NOT EXISTS(SELECT 1 FROM staged o WHERE o.table_name='porthole_objects' AND json_extract(o.value,'$.id')=json_extract(q.value,'$.object_id')))
 AS invalid`).bind(jobId).first<{invalid:number}>()
 if(!result||result.invalid)fail('archive_semantics_invalid',422)
}
