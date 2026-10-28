import { eraseJournaledBatches } from '../privacy/erasure/http'
import type { Authority } from '../security/authority'
import { fail } from '../security/authority'
import { genesis } from '../audit/store'
import { byTable, catalog, emptyProduct } from './catalog'
import { chunkInput, chunkRows, initialValidation, manifestInput, validateRow, type Manifest, type Validation } from './format'
import { guard, jobFor, type Job } from './store'
import { validateRelations } from './relations'
import {validateCustody} from '../migration/custody/validate'
import {AuthError} from '../../modules/operator-auth/index.mjs'

async function requireEmpty(db:D1Database) {
 const value=await db.prepare(`SELECT (${emptyProduct}) AS empty`).first<{empty:number}>()
 if(!value?.empty)fail('archive_target_not_empty',409)
}
// An opaque later erasure receipt cannot selectively rewrite an older source
// snapshot. Require every destination checkpoint, or refuse that archive whole.
const importErasureCompatible=`NOT EXISTS(SELECT 1 FROM porthole_migration_erasure_fences d WHERE NOT EXISTS(
 SELECT 1 FROM porthole_archive_rows s WHERE s.job_id=? AND s.table_name='porthole_migration_erasure_fences'
 AND json_extract(s.payload,'$.row.receipt_id')=d.receipt_id
 AND json_extract(s.payload,'$.row.inventory_digest')=d.inventory_digest
 AND json_extract(s.payload,'$.row.erased_at')=d.erased_at))`
export async function startRestore(db:D1Database,actor:Authority,value:unknown):Promise<Job> {
 const manifest=manifestInput(value);await requireEmpty(db)
 if(!manifest.tables.porthole_migration_erasure_fences&&await db.prepare('SELECT 1 FROM porthole_migration_erasure_fences LIMIT 1').first())fail('archive_predates_import_erasure',409)
 const id=crypto.randomUUID()
 await db.batch([guard(db,actor,emptyProduct),db.prepare(`INSERT INTO porthole_archive_jobs(id,direction,owner_ref,created_at,state,manifest,chain_hash,validation) VALUES(?,'restore',?,?,'staging',?,?,?)`).bind(id,actor.member.operatorId,Date.now(),JSON.stringify(manifest),genesis,JSON.stringify(initialValidation()))])
 return jobFor(db,id,actor,'restore')
}
function rowKey(table:string,row:Record<string,unknown>):string {
 if(table==='porthole_migration_erasure_fences')return String(row.receipt_id)
 if(table==='porthole_migration_custody')return JSON.stringify([row.stream,row.source_table,row.source_key])
 if(table==='porthole_migration_records')return JSON.stringify([row.kind,row.id])
 if(table==='porthole_metric_points')return JSON.stringify([row.rule_id,row.revision,row.batch_id,row.ordinal])
 if(['porthole_metric_rules','porthole_slo_versions','porthole_dashboard_versions','porthole_notebook_versions'].includes(table))return JSON.stringify([row.id,row.revision])
 if(table==='porthole_archive_health_history')return JSON.stringify([row.stream,row.table_name,row.row_key])
 if(table==='porthole_archive_audit')return JSON.stringify([row.stream,row.sequence])
 return String(row.record_id??row.id??row.object_id??row.actor_ref??row.singleton)
}
export async function stageChunk(db:D1Database,actor:Authority,job:Job,value:unknown):Promise<Job> {
 const manifest=JSON.parse(job.manifest!) as Manifest
 // A lost HTTP response can replay the exact already-committed chunk.
 if(value&&typeof value==='object'&&'index' in value&&Number.isSafeInteger(value.index)&&(value.index as number)<job.next_chunk) {
  const old=await db.prepare('SELECT packet FROM porthole_archive_chunks WHERE job_id=? AND chunk_index=?').bind(job.id,value.index).first<{packet:string}>()
  if(!old||old.packet!==JSON.stringify(value))fail('archive_chunk_conflict',409)
  await db.batch([guard(db,actor)]);return job
 }
 if(job.state!=='staging'||job.next_chunk>=manifest.chunks)fail('archive_cursor_invalid',409)
 const chunk=await chunkInput(value,job.next_chunk,job.chain_hash,Math.min(chunkRows,manifest.rowCount-job.row_count))
 const validation=JSON.parse(job.validation) as Validation
 for(const row of chunk.rows)await validateRow(row,validation)
 for(const [table,count] of Object.entries(validation.tables))if(count>manifest.tables[table])fail('archive_semantics_invalid',422)
 const inserts=chunk.rows.map((payload,index)=>db.prepare('INSERT INTO porthole_archive_rows(job_id,ordinal,payload,table_name,row_key) VALUES(?,?,?,?,?)').bind(job.id,job.row_count+index,JSON.stringify(payload),payload.table,rowKey(payload.table,payload.row)))
 await db.batch([guard(db,actor,`EXISTS(SELECT 1 FROM porthole_archive_jobs WHERE id=? AND state='staging' AND next_chunk=?)`,[job.id,job.next_chunk]),...inserts,db.prepare('INSERT INTO porthole_archive_chunks(job_id,chunk_index,digest,packet) VALUES(?,?,?,?)').bind(job.id,chunk.index,chunk.digest,JSON.stringify(chunk)),db.prepare('UPDATE porthole_archive_jobs SET next_chunk=next_chunk+1,row_count=row_count+?,chain_hash=?,validation=? WHERE id=?').bind(chunk.rows.length,chunk.digest,JSON.stringify(validation),job.id)])
 return jobFor(db,job.id,actor)
}
export async function commitRestore(db:D1Database,actor:Authority,job:Job,confirmation:unknown):Promise<Job> {
 const manifest=JSON.parse(job.manifest!) as Manifest
 if(confirmation!==manifest.rootHash)fail('archive_confirmation_required',400)
 if(job.state==='committed')return job
 if(job.next_chunk!==manifest.chunks||job.row_count!==manifest.rowCount||job.chain_hash!==manifest.rootHash)fail('archive_incomplete',409)
 const validation=JSON.parse(job.validation) as Validation
 for(const [table,count] of Object.entries(manifest.tables))if(validation.tables[table]!==count)fail('archive_semantics_invalid',422)
 await requireEmpty(db)
 await validateRelations(db,job.id)
 try{
  await validateCustody(db,job.id)
  if(!(await db.prepare(`SELECT (${importErasureCompatible}) AS compatible`).bind(job.id).first<{compatible:number}>())?.compatible)fail('archive_predates_import_erasure',409)
 }catch(error){
  if(error instanceof AuthError&&['archive_predates_import_erasure','migration_custody_unreviewed_after_erasure'].includes(error.code)){
   // Refused erased source input is withdrawn, never retained as a new frozen
   // copy. Only this owner's explicitly submitted staging job is affected.
   await db.batch([guard(db,actor,"EXISTS(SELECT 1 FROM porthole_archive_jobs WHERE id=? AND owner_ref=? AND state='staging')",[job.id,actor.member.operatorId]),
    db.prepare('DELETE FROM porthole_archive_chunks WHERE job_id=?').bind(job.id),db.prepare('DELETE FROM porthole_archive_rows WHERE job_id=?').bind(job.id),db.prepare('DELETE FROM porthole_archive_jobs WHERE id=?').bind(job.id)])
  }
  throw error
 }
 const statements:D1PreparedStatement[]=[guard(db,actor,`${emptyProduct} AND (${importErasureCompatible}) AND EXISTS(SELECT 1 FROM porthole_archive_jobs WHERE id=? AND state='staging' AND chain_hash=?)`,[job.id,job.id,manifest.rootHash])]
 statements.push(db.prepare(`INSERT INTO porthole_migration_erasure_fences(receipt_id,inventory_digest,erased_at)
 SELECT json_extract(payload,'$.row.receipt_id'),json_extract(payload,'$.row.inventory_digest'),json_extract(payload,'$.row.erased_at')
 FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_migration_erasure_fences' ON CONFLICT(receipt_id) DO NOTHING`).bind(job.id))
 // The later destination journal is never replaced by an older source journal.
 const journal=byTable.get('porthole_erased_actors')!
 statements.push(db.prepare(`INSERT INTO porthole_erased_actors(${journal.columns.join(',')}) SELECT json_extract(payload,'$.row.actor_ref'),json_extract(payload,'$.row.erased_at') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_erased_actors' ON CONFLICT(actor_ref) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at)`).bind(job.id))
 statements.push(db.prepare(`INSERT INTO porthole_export_exclusions(record_id,excluded_at) SELECT json_extract(payload,'$.row.record_id'),json_extract(payload,'$.row.excluded_at') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_export_exclusions' ON CONFLICT(record_id) DO UPDATE SET excluded_at=MAX(excluded_at,excluded.excluded_at)`).bind(job.id))
 statements.push(db.prepare(`INSERT INTO porthole_erased_batches(id,content_digest,erased_at) SELECT json_extract(payload,'$.row.id'),json_extract(payload,'$.row.content_digest'),json_extract(payload,'$.row.erased_at') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_erased_batches' ON CONFLICT(id) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at)`).bind(job.id))
 for(const item of catalog) {
  if(item.table==='porthole_migration_erasure_fences')continue
  if(item.table==='porthole_erased_batches')continue
  if(item.table==='porthole_export_exclusions')continue
  if(item.table==='porthole_erased_actors')continue
  if(item.table==='porthole_baggage_policy') {
   statements.push(db.prepare(`UPDATE porthole_baggage_policy SET enabled=0,allowed_keys=COALESCE((SELECT json_extract(payload,'$.row.allowed_keys') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_baggage_policy'),'[]'),attribute_keys=COALESCE((SELECT json_extract(payload,'$.row.attribute_keys') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_baggage_policy'),'[]'),revision=revision+1,changed_at=?`).bind(job.id,job.id,Date.now()));continue
  }
  if(item.table==='porthole_ingest_control') {
   statements.push(db.prepare(`UPDATE porthole_ingest_control SET paused=1,max_pending_bytes=COALESCE((SELECT json_extract(payload,'$.row.max_pending_bytes') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_ingest_control'),max_pending_bytes),revision=revision+1,changed_at=?`).bind(job.id,Date.now()));continue
  }
  const expressions=item.columns.map(column=>item.table==='porthole_retention_policies'&&column==='active'?'0':['porthole_notebooks','porthole_metric_rules','porthole_slo_versions','porthole_objects','porthole_bucket_history','porthole_dashboards','porthole_dashboard_publications'].includes(item.table)&&column==='state'?"'quarantined'":`json_extract(payload,'$.row.${column}')`)
  statements.push(db.prepare(`INSERT INTO ${item.table}(${item.columns.join(',')}) SELECT ${expressions.join(',')} FROM porthole_archive_rows WHERE job_id=? AND table_name=? ORDER BY ordinal`).bind(job.id,item.table))
 }
 statements.push(db.prepare(`INSERT INTO porthole_archive_quarantine(object_id,source_state,archive_id,restored_at) SELECT json_extract(payload,'$.row.id'),json_extract(payload,'$.row.state'),?,? FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_objects' AND NOT EXISTS(SELECT 1 FROM porthole_archive_quarantine q WHERE q.object_id=json_extract(payload,'$.row.id'))`).bind(manifest.id,Date.now(),job.id))
 // FK constraints plus this relational guard reject dangling, cross-source and
 // impossible ordinal relationships inside the same rollback boundary.
 statements.push(guard(db,actor,`NOT EXISTS(SELECT 1 FROM porthole_telemetry_records r LEFT JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.id IS NULL OR b.source_id!=r.source_id OR b.signal!=r.signal OR r.ordinal>=b.record_count) AND NOT EXISTS(SELECT 1 FROM porthole_telemetry_archive r LEFT JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.id IS NULL OR b.source_id!=r.source_id OR b.signal!=r.signal OR r.ordinal>=b.record_count)`))
 statements.push(...eraseJournaledBatches(db))
 statements.push(db.prepare('DELETE FROM porthole_archive_chunks WHERE job_id=?').bind(job.id),db.prepare('DELETE FROM porthole_archive_rows WHERE job_id=?').bind(job.id))
 statements.push(db.prepare("UPDATE porthole_archive_jobs SET state='committed' WHERE id=?").bind(job.id))
 // D1 batch is a single transaction: even a final constraint or authority failure
 // rolls back the journal, configuration, history and all telemetry inserts.
 await db.batch(statements)
 return jobFor(db,job.id,actor)
}
