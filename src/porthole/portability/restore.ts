import type { Authority } from '../security/authority'
import { fail } from '../security/authority'
import { genesis } from '../audit/store'
import { byTable, catalog, emptyProduct } from './catalog'
import { chunkInput, chunkRows, initialValidation, manifestInput, validateRow, type Manifest, type Validation } from './format'
import { guard, jobFor, type Job } from './store'
import { validateRelations } from './relations'

async function requireEmpty(db:D1Database) {
 const value=await db.prepare(`SELECT (${emptyProduct}) AS empty`).first<{empty:number}>()
 if(!value?.empty)fail('archive_target_not_empty',409)
}
export async function startRestore(db:D1Database,actor:Authority,value:unknown):Promise<Job> {
 const manifest=manifestInput(value);await requireEmpty(db)
 const id=crypto.randomUUID()
 await db.batch([guard(db,actor,emptyProduct),db.prepare(`INSERT INTO porthole_archive_jobs(id,direction,owner_ref,created_at,state,manifest,chain_hash,validation) VALUES(?,'restore',?,?,'staging',?,?,?)`).bind(id,actor.member.operatorId,Date.now(),JSON.stringify(manifest),genesis,JSON.stringify(initialValidation()))])
 return jobFor(db,id,actor,'restore')
}
function rowKey(table:string,row:Record<string,unknown>):string {
 if(table==='porthole_archive_audit')return JSON.stringify([row.stream,row.sequence])
 return String(row.id??row.object_id??row.actor_ref??row.singleton)
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
 const statements:D1PreparedStatement[]=[guard(db,actor,`${emptyProduct} AND EXISTS(SELECT 1 FROM porthole_archive_jobs WHERE id=? AND state='staging' AND chain_hash=?)`,[job.id,manifest.rootHash])]
 // The later destination journal is never replaced by an older source journal.
 const journal=byTable.get('porthole_erased_actors')!
 statements.push(db.prepare(`INSERT INTO porthole_erased_actors(${journal.columns.join(',')}) SELECT json_extract(payload,'$.row.actor_ref'),json_extract(payload,'$.row.erased_at') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_erased_actors' ON CONFLICT(actor_ref) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at)`).bind(job.id))
 for(const item of catalog) {
  if(item.table==='porthole_erased_actors')continue
  if(item.table==='porthole_ingest_control') {
   statements.push(db.prepare(`UPDATE porthole_ingest_control SET paused=1,max_pending_bytes=COALESCE((SELECT json_extract(payload,'$.row.max_pending_bytes') FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_ingest_control'),max_pending_bytes),revision=revision+1,changed_at=?`).bind(job.id,Date.now()));continue
  }
  const expressions=item.columns.map(column=>item.table==='porthole_objects'&&column==='state'?"'quarantined'":`json_extract(payload,'$.row.${column}')`)
  statements.push(db.prepare(`INSERT INTO ${item.table}(${item.columns.join(',')}) SELECT ${expressions.join(',')} FROM porthole_archive_rows WHERE job_id=? AND table_name=? ORDER BY ordinal`).bind(job.id,item.table))
 }
 statements.push(db.prepare(`INSERT INTO porthole_archive_quarantine(object_id,source_state,archive_id,restored_at) SELECT json_extract(payload,'$.row.id'),json_extract(payload,'$.row.state'),?,? FROM porthole_archive_rows WHERE job_id=? AND table_name='porthole_objects' AND NOT EXISTS(SELECT 1 FROM porthole_archive_quarantine q WHERE q.object_id=json_extract(payload,'$.row.id'))`).bind(manifest.id,Date.now(),job.id))
 // FK constraints plus this relational guard reject dangling, cross-source and
 // impossible ordinal relationships inside the same rollback boundary.
 statements.push(guard(db,actor,`NOT EXISTS(SELECT 1 FROM porthole_telemetry_records r LEFT JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.id IS NULL OR b.source_id!=r.source_id OR b.signal!=r.signal OR r.ordinal>=b.record_count) AND NOT EXISTS(SELECT 1 FROM porthole_telemetry_archive r LEFT JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.id IS NULL OR b.source_id!=r.source_id OR b.signal!=r.signal OR r.ordinal>=b.record_count)`))
 statements.push(db.prepare("UPDATE porthole_archive_jobs SET state='committed' WHERE id=?").bind(job.id))
 // D1 batch is a single transaction: even a final constraint/authority failure
 // rolls back the journal, configuration, history and all telemetry inserts.
 await db.batch(statements)
 return jobFor(db,job.id,actor)
}
