import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {fail} from '../../security/authority'

/** Current native-owner authority is supplied by the migration door. Historical
 * source state and the fact of a review never become destination permission. */
export async function readRestoredHistory(db:D1Database,predicate:D1Sql){
 const guard=()=>db.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('OWNER_REQUIRED') END`).bind(...predicate.params??[])
 const results=await db.batch<{stream:string;body:string;job_body:string|null;approved_at:string|null}>([
  guard(),db.prepare(`SELECT p.stream,p.body,j.body AS job_body,json_extract(a.body,'$.approved_at') AS approved_at
   FROM porthole_migration_custody p
   LEFT JOIN porthole_migration_custody j ON j.stream=p.stream AND j.source_table='ik_jobs' AND json_extract(j.body,'$.id')=json_extract(p.body,'$.job_id')
   LEFT JOIN porthole_migration_custody a ON a.stream=p.stream AND a.source_table='ik_door_approval_history' AND json_extract(a.body,'$.plan_id')=json_extract(p.body,'$.id')
   WHERE p.source_table='ik_door_plans' ORDER BY p.stream,p.source_key`),guard(),
 ])
 return results[1].results.map(row=>{
  const plan=JSON.parse(row.body),job=row.job_body?JSON.parse(row.job_body):null
  return {stream:row.stream,planId:plan.id,namespace:plan.namespace,fingerprint:plan.fingerprint,bundleSha256:plan.bundle_sha256,previousPlanId:plan.previous_id,jobId:plan.job_id,sourceState:job?.state??'preview',sourceCheckpoint:job?.checkpoint??0,sourceTotal:job?.total??null,historicalApprovalAt:row.approved_at,state:'inactive' as const,destinationConsentRequired:true as const}
 })
}
export async function refuseRestoredAction(db:D1Database,planId:unknown):Promise<void> {
 if(typeof planId!=='string')return
 const restored=await db.prepare("SELECT 1 FROM porthole_migration_custody WHERE source_table='ik_door_plans' AND json_extract(body,'$.id')=? LIMIT 1").bind(planId).first()
 if(restored)fail('restored_import_requires_fresh_preview',409)
}
