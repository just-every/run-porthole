/** Import custody is evidence. None of these projections is inserted into a
 * live import-kit table on restore. The allow-list also closes over future kit
 * domains: a populated table without a projection refuses the export. */
export interface CustodySpec {table:string;columns:string[];key:string[];query:string}
const spec=(table:string,columns:string,key:string,query?:string):CustodySpec=>({table,columns:columns.split(','),key:key.split(','),query:query??`SELECT ${columns} FROM ${table}`})
export const custodyCatalog:CustodySpec[]=[
 spec('ik_door_uploads','id,installation_id,namespace,name,bundle_sha256,total_bytes,total_chunks','id'),
 spec('ik_door_chunks','upload_id,ordinal,sha256,size,base64','upload_id,ordinal'),
 spec('ik_door_namespaces','installation_id,namespace,head_id,pending_id','installation_id,namespace'),
 spec('ik_door_plans','id,installation_id,namespace,bundle_sha256,fingerprint,previous_id,job_id,snapshot_hash,complete','id'),
 spec('ik_door_plan_chunks','plan_id,ordinal,body','plan_id,ordinal'),
 // Keep the historical act and its opaque native actor, never the approval
 // identifier, email, grant reviewer or any field accepted as approval proof.
 spec('ik_door_approval_history','plan_id,actor_ref,approved_at,fingerprint,reviewer_kind','plan_id',`SELECT a.plan_id,(SELECT id FROM oa_operators WHERE lower(email)=lower(a.owner)) AS actor_ref,a.approved_at,a.fingerprint,'native-owner' AS reviewer_kind FROM ik_door_approvals a`),
 spec('ik_door_apply_failures','plan_id,reason_code','plan_id'),
 spec('ik_door_scopes','installation_id,namespace,destination','installation_id,namespace'),
 spec('ik_door_archives','id,installation_id,namespace,upload_id,tool,taken_at,name,bundle_sha256,total_bytes,total_chunks,counts_json','id'),
 spec('ik_door_archive_chunks','archive_id,ordinal,sha256,size,base64','archive_id,ordinal'),
 // Lease credentials and lease expiry are not portable, even as history.
 spec('ik_jobs','id,destination,namespace,mapping_version,principal_id,fingerprint,operation_key,plan_json,state,checkpoint,total,fence,error,reversal_policy,reversal_policy_hash,reversal_cursor,reversal_hash,reversal_conversion_hash','id'),
 spec('ik_original_sets','job_id,version','job_id'),
 spec('ik_originals','job_id,kind,original_key,name,sha256,size,bytes','job_id,kind,original_key'),
 spec('ik_d1_original_chunks','job_id,kind,original_key,ordinal,bytes','job_id,kind,original_key,ordinal'),
 spec('ik_d1_plan_chunks','job_id,ordinal,body','job_id,ordinal'),
 spec('ik_d1_creation_plans','job_id,ordinal,body,released','job_id,ordinal'),
 spec('ik_sources','identity,source_hash,mapping_version,effects_hash,job_id','identity'),
 spec('ik_provenance','id,job_id,ordinal,effect_ordinal,source_identity,destination,target_kind,target_id,reversed,record_json','id'),
 spec('ik_batches','job_id,action,position,end_position,fence','job_id,action,position'),
 spec('ik_d1_entries','job_id,ordinal,source_identity,owner_job_id,effects_hash','job_id,ordinal'),
 spec('ik_d1_history','id,job_id,ordinal,effect_ordinal,source_identity,destination,target_kind,target_id,reversed,record_json,successor_id','id'),
 spec('ik_d1_reversal_reports','job_id,effect_id,position,record_json','job_id,effect_id'),
 spec('ik_d1_indexed_jobs','job_id,fingerprint','job_id'),
 spec('ik_d1_plan_index','job_id,ordinal,source_identity,target_identity','job_id,ordinal,target_identity'),
 spec('ik_d1_erased_sources','destination,identity','destination,identity'),
 spec('ik_d1_erased_targets','destination,identity','destination,identity'),
 spec('ik_d1_retirements','id,kind,destination,receipt_id,retired_at','id,kind'),
 spec('ik_d1_erasure_journal','id,destination,recorded_at,records_erased,jobs_retired,streams_retired,stores_json','id'),
 spec('ik_d1_policy_conversions','job_id,record_json','job_id'),
]
export const custodyByTable=new Map(custodyCatalog.map(item=>[item.table,item]))
export const custodyColumns=['stream','source_table','source_key','body','state']
export function custodyQueries(stream:string):string[] {
 // D1 intentionally limits compound SELECT terms. Keep one live domain and
 // its inert historical projection together, never one large UNION.
 return [...custodyCatalog].sort((a,b)=>a.table.localeCompare(b.table)).map(item=>`SELECT '${stream}' AS stream,'${item.table}' AS source_table,json_array(${item.key.join(',')}) AS source_key,json_object(${item.columns.map(column=>`'${column}',${column}`).join(',')}) AS body,'inactive' AS state FROM (${item.query}) UNION ALL SELECT stream,source_table,source_key,body,state FROM porthole_migration_custody WHERE source_table='${item.table}'`)
}
/** Counters and publication seals are derived concurrency controls, never
 * source content. They cannot authorize a destination import. */
export const omittedCustodyTables=new Set(['ik_door_settings','ik_door_revoked_keys','ik_door_grants','ik_door_approvals','ik_d1_assertions','ik_d1_custody_states','ik_d1_custody_revisions'])
