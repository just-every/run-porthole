import {fail} from '../../security/authority'

// A fresh upload is untrusted source input until the real planner screens it
// against durable source tombstones. It cannot become portable erased custody.
export const reviewedUploadsAfterErasure=`NOT EXISTS(SELECT 1 FROM porthole_migration_erasure_fences) OR NOT EXISTS(
 SELECT 1 FROM ik_door_uploads u WHERE EXISTS(SELECT 1 FROM ik_door_chunks c WHERE c.upload_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM ik_door_plans p WHERE p.installation_id=u.installation_id AND p.namespace=u.namespace
 AND p.bundle_sha256=u.bundle_sha256 AND p.complete=1 AND EXISTS(SELECT 1 FROM ik_door_plan_chunks c WHERE c.plan_id=p.id)))`

export async function requireReviewedUploads(db:D1Database){
 if(!(await db.prepare(`SELECT (${reviewedUploadsAfterErasure}) AS valid`).first<{valid:number}>())?.valid)fail('migration_custody_unreviewed_after_erasure',409)
}

/** Apply the same rule to the frozen unit, including inactive restored streams.
 * Live-table checks alone cannot validate an independently supplied archive. */
export async function validateErasureUploads(db:D1Database,jobId:string){
 const row=await db.prepare(`WITH custody AS (
  SELECT json_extract(payload,'$.row.stream') AS stream,json_extract(payload,'$.row.source_table') AS source_table,json_extract(payload,'$.row.body') AS body
  FROM porthole_archive_rows WHERE job_id=? AND json_extract(payload,'$.table')='porthole_migration_custody')
 SELECT EXISTS(SELECT 1 FROM porthole_archive_rows WHERE job_id=? AND json_extract(payload,'$.table')='porthole_migration_erasure_fences') AND EXISTS(
  SELECT 1 FROM custody u WHERE u.source_table='ik_door_uploads'
  AND EXISTS(SELECT 1 FROM custody c WHERE c.stream=u.stream AND c.source_table='ik_door_chunks' AND json_extract(c.body,'$.upload_id')=json_extract(u.body,'$.id'))
  AND NOT EXISTS(SELECT 1 FROM custody p WHERE p.stream=u.stream AND p.source_table='ik_door_plans'
   AND json_extract(p.body,'$.installation_id')=json_extract(u.body,'$.installation_id') AND json_extract(p.body,'$.namespace')=json_extract(u.body,'$.namespace')
   AND json_extract(p.body,'$.bundle_sha256')=json_extract(u.body,'$.bundle_sha256') AND json_extract(p.body,'$.complete')=1
   AND EXISTS(SELECT 1 FROM custody c WHERE c.stream=p.stream AND c.source_table='ik_door_plan_chunks' AND json_extract(c.body,'$.plan_id')=json_extract(p.body,'$.id')))) AS invalid`).bind(jobId,jobId).first<{invalid:number}>()
 if(!row||row.invalid)fail('migration_custody_unreviewed_after_erasure',409)
}
