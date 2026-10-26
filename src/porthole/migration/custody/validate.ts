import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {originalsFor} from '../../../modules/import-kit/src/storage/originals.ts'
import {custodyCatalog} from './catalog'
import {doorSnapshot,jobPlan,originalBytes,sourceBytes,chunkText,validatePlan} from './documents'
import {CustodyReader} from './reader'
import {invalid,validateCustodyRow,type Row} from './rows'
import {validateErasureUploads} from './erasure-fence'

/** Validate only the immutable archive snapshot, never a second live read. */
export async function validateCustody(db:D1Database,jobId:string):Promise<void> {
 for(let offset=0;;offset+=24){
  const rows=(await db.prepare("SELECT json_extract(payload,'$.row') AS value FROM porthole_archive_rows WHERE job_id=? AND json_extract(payload,'$.table')='porthole_migration_custody' ORDER BY ordinal LIMIT 24 OFFSET ?").bind(jobId,offset).all<{value:string}>()).results
  for(const row of rows)validateCustodyRow(JSON.parse(row.value))
  if(rows.length<24)break
 }
 await validateReferences(db,jobId)
 await validateErasureUploads(db,jobId)
 const reader=new CustodyReader(db,jobId)
 for(const stream of await reader.streams()){
  for await(const upload of reader.rows('ik_door_uploads',stream)){
   const chunks=await reader.list('ik_door_chunks',stream,'upload_id',upload.id)
   // Planned uploads legitimately keep only their digest and sanitized plan.
   // An incomplete unplanned upload cannot establish credential exclusion.
   if(chunks.length)sourceBytes(upload,chunks)
  }
  for await(const archive of reader.rows('ik_door_archives',stream)){
   const chunks=await reader.list('ik_door_archive_chunks',stream,'archive_id',archive.id)
   if(chunks.length)sourceBytes(archive,chunks) // Erasure withdraws exact bytes.
  }
  const headers=await reader.list('ik_door_plans',stream)
  const plans=new Map(headers.map(row=>[String(row.id),row]))
  for(const header of headers){
   const seen=new Set<string>();let next:unknown=header.id
   while(next!==null){if(typeof next!=='string'||seen.has(next)||!plans.has(next))invalid();seen.add(next);next=plans.get(next)!.previous_id}
   const reviewed=doorSnapshot(header,await reader.list('ik_door_plan_chunks',stream,'plan_id',header.id))
   if(reviewed&&header.job_id!==null){
    const jobs=await reader.list('ik_jobs',stream,'id',header.job_id)
    if(jobs.length!==1||jobs[0].operation_key!=='door:'+header.id)invalid()
    // Later erasure may legitimately re-fingerprint the kit's copy. The source
    // reviewed snapshot stays exact; neither fingerprint authorizes restore.
    if(jobs[0].fingerprint!==header.fingerprint){const plan=jobPlan(jobs[0],await reader.list('ik_d1_plan_chunks',stream,'job_id',header.job_id));if(plan.erasure?.reviewedFingerprint!==header.fingerprint)invalid()}
   }
  }
  for await(const job of reader.rows('ik_jobs',stream)){
   const plan=jobPlan(job,await reader.list('ik_d1_plan_chunks',stream,'job_id',job.id))
   for(const entry of plan.entries.filter(entry=>entry.erased)){
    const sources=await reader.list('ik_d1_erased_sources',stream,'identity',entry.identity),targets=await reader.list('ik_d1_erased_targets',stream,'identity',entry.erasedTargetIdentity)
    if(!sources.some(row=>row.destination===plan.destination)||!targets.some(row=>row.destination===plan.destination))invalid()
   }
   const creation=await reader.list('ik_d1_creation_plans',stream,'job_id',job.id)
   if(creation.length&&validatePlan(JSON.parse(chunkText(creation))).fingerprint!==job.fingerprint)invalid()
   const originals=await reader.list('ik_originals',stream,'job_id',job.id),expected=originalsFor(plan,String(job.id))
   if(originals.length!==expected.length)invalid()
   const sets=await reader.list('ik_original_sets',stream,'job_id',job.id)
   if(sets.length!==1||sets[0].version!==3)invalid()
   for(const original of originals){
    const wanted=expected.find(row=>row.kind===original.kind&&row.key===original.original_key)
    if(!wanted||wanted.name!==original.name||wanted.sha256!==original.sha256||wanted.size!==original.size)invalid()
    const chunks=(await reader.list('ik_d1_original_chunks',stream,'job_id',job.id)).filter(row=>row.kind===original.kind&&row.original_key===original.original_key)
    if(wanted.original.status==='retained'){if(!chunks.length||chunkText(chunks,'bytes')!==wanted.original.base64)invalid()}
    else if(chunks.length)invalid()
    originalBytes(original,chunks)
   }
   for(const physical of [...await reader.list('ik_provenance',stream,'job_id',job.id),...await reader.list('ik_d1_history',stream,'job_id',job.id)]){
    const entry=plan.entries[Number(physical.ordinal)],effect=entry?.effects[Number(physical.effect_ordinal)],record=JSON.parse(String(physical.record_json))
    if(!entry||!effect||Number(physical.ordinal)>=Number(job.checkpoint)||record.id!==physical.id||record.jobId!==job.id||record.sourceIdentity!==physical.source_identity||record.sourceIdentity!==entry.identity||record.targetKind!==physical.target_kind||record.targetId!==physical.target_id||record.targetKind!==effect.targetKind||record.targetId!==effect.targetId||record.valueHash!==sha256(canonicalJson(effect.value))||Number(record.reversed)!==physical.reversed)invalid()
   }
  }
 }
}

async function validateReferences(db:D1Database,jobId:string):Promise<void> {
 const references:[table:string,column:string,parent:string,key:string][]=[
  ['ik_door_chunks','upload_id','ik_door_uploads','id'],['ik_door_archive_chunks','archive_id','ik_door_archives','id'],
  ...['ik_door_plan_chunks','ik_door_approval_history','ik_door_apply_failures'].map(table=>[table,'plan_id','ik_door_plans','id'] as [string,string,string,string]),
  ...custodyCatalog.filter(item=>item.columns.includes('job_id')).map(item=>[item.table,'job_id','ik_jobs','id'] as [string,string,string,string]),
  ['ik_d1_entries','owner_job_id','ik_jobs','id'],['ik_door_plans','previous_id','ik_door_plans','id'],
  ['ik_door_namespaces','head_id','ik_door_plans','id'],['ik_door_namespaces','pending_id','ik_door_plans','id'],
 ]
 const predicate=references.map(([table,column,parent,key])=>`EXISTS(SELECT 1 FROM custody c WHERE c.source_table='${table}' AND json_extract(c.body,'$.${column}') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custody p WHERE p.stream=c.stream AND p.source_table='${parent}' AND json_extract(p.body,'$.${key}')=json_extract(c.body,'$.${column}')))`)
 // Composite original references must not borrow bytes from another original.
 predicate.push("EXISTS(SELECT 1 FROM custody c WHERE c.source_table='ik_d1_original_chunks' AND NOT EXISTS(SELECT 1 FROM custody p WHERE p.stream=c.stream AND p.source_table='ik_originals' AND json_extract(p.body,'$.job_id')=json_extract(c.body,'$.job_id') AND json_extract(p.body,'$.kind')=json_extract(c.body,'$.kind') AND json_extract(p.body,'$.original_key')=json_extract(c.body,'$.original_key')))")
 const result=await db.prepare(`WITH custody AS (SELECT json_extract(payload,'$.row.stream') AS stream,json_extract(payload,'$.row.source_table') AS source_table,json_extract(payload,'$.row.source_key') AS source_key,json_extract(payload,'$.row.body') AS body FROM porthole_archive_rows WHERE job_id=? AND json_extract(payload,'$.table')='porthole_migration_custody') SELECT ${predicate.join(' OR ')} OR EXISTS(SELECT 1 FROM custody GROUP BY stream,source_table,source_key HAVING COUNT(*)>1) AS invalid`).bind(jobId).first<{invalid:number}>()
 if(!result||result.invalid)invalid()
}
