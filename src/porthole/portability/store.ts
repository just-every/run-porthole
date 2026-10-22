import type { Authority } from '../security/authority'
import { fail, proofFence } from '../security/authority'
import { digest, genesis } from '../audit/store'
import { projectFacts } from '../audit/facts'
import { catalog, snapshotQuery } from './catalog'
import { chunkRows, format, initialValidation, validateRow, type Chunk, type Manifest, type PortableRow, type Validation } from './format'

export interface Job {id:string;direction:'export'|'restore';owner_ref:string;created_at:number;state:string;manifest:string|null;row_count:number;next_chunk:number;chain_hash:string;validation:string}
export function guard(db:D1Database,actor:Authority,extra='1',args:unknown[]=[]):D1PreparedStatement {
 const proof=proofFence(actor)
 return db.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND ${extra} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args,...args)
}
export async function jobFor(db:D1Database,id:string,actor:Authority,direction?:string):Promise<Job> {
 const row=await db.prepare('SELECT * FROM porthole_archive_jobs WHERE id=? AND owner_ref=?').bind(id,actor.member.operatorId).first<Job>()
 if(!row || direction&&row.direction!==direction)fail('archive_not_found',404)
 return row
}
export async function startExport(db:D1Database,actor:Authority):Promise<Job> {
 await projectFacts(db)
 const id=crypto.randomUUID(),stream=crypto.randomUUID(),now=Date.now()
 const statements:D1PreparedStatement[]=[guard(db,actor), db.prepare(`INSERT INTO porthole_archive_jobs(id,direction,owner_ref,created_at,state,chain_hash) VALUES(?,'export',?,?,'snapshot',?)`).bind(id,actor.member.operatorId,now,genesis)]
 for(const item of catalog) statements.push(db.prepare(`INSERT INTO porthole_archive_rows(job_id,ordinal,payload) SELECT ?,COALESCE((SELECT MAX(ordinal)+1 FROM porthole_archive_rows WHERE job_id=?),0)+ROW_NUMBER() OVER ()-1,payload FROM (${snapshotQuery(item,stream)})`).bind(id,id))
 statements.push(db.prepare('UPDATE porthole_archive_jobs SET row_count=(SELECT COUNT(*) FROM porthole_archive_rows WHERE job_id=?) WHERE id=?').bind(id,id))
 try {await db.batch(statements)} catch(error) {
  const failure=error as {message?:unknown;cause?:{message?:unknown}}
  const message=String(failure?.message??'')+' '+String(failure?.cause?.message??'')
  const categories=['no such column','no such table','UNIQUE constraint','FOREIGN KEY constraint','CHECK constraint','JSON cannot hold BLOB','json_object() labels','syntax error','too many SQL variables','parameter bindings','D1_TYPE_ERROR','SQLITE_AUTH','not authorized','NOT NULL constraint','misuse of window','too many terms','too big','D1_EXEC_ERROR','SQLITE_ERROR']
  console.error('ERROR archive_snapshot',categories.find(value=>message.includes(value))??'database_error')
  for(const item of catalog) {
   try {await db.prepare(`SELECT payload FROM (${snapshotQuery(item,stream)}) LIMIT 1`).first()}
   catch(failure) {
    const detail=failure as {message?:unknown;cause?:{message?:unknown}}
    const text=String(detail?.message??'')+' '+String(detail?.cause?.message??'')
    console.error('ERROR archive_snapshot_table',item.table,categories.find(value=>text.includes(value))??'database_error')
   }
  }
  throw error
 }
 return jobFor(db,id,actor,'export')
}
export async function exportChunk(db:D1Database,actor:Authority,job:Job,index:number):Promise<Chunk|null> {
 const old=await db.prepare('SELECT packet FROM porthole_archive_chunks WHERE job_id=? AND chunk_index=?').bind(job.id,index).first<{packet:string}>()
 if(old){await db.batch([guard(db,actor)]);return JSON.parse(old.packet) as Chunk}
 if(index!==job.next_chunk)fail('archive_cursor_invalid',409)
 const rows=(await db.prepare('SELECT payload FROM porthole_archive_rows WHERE job_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal').bind(job.id,index*chunkRows,(index+1)*chunkRows).all<{payload:string}>()).results.map(value=>JSON.parse(value.payload) as PortableRow)
 if(!rows.length){await finishExport(db,actor,job);return null}
 const state=JSON.parse(job.validation) as Validation
 if(!state.tables)Object.assign(state,initialValidation())
 for(const row of rows)await validateRow(row,state)
 const base={version:1 as const,index,previousHash:job.chain_hash,rows},chunk:Chunk={...base,digest:await digest(JSON.stringify(base))}
 await db.batch([guard(db,actor,`EXISTS(SELECT 1 FROM porthole_archive_jobs WHERE id=? AND next_chunk=? AND chain_hash=?)`,[job.id,index,job.chain_hash]),db.prepare('INSERT INTO porthole_archive_chunks(job_id,chunk_index,digest,packet) VALUES(?,?,?,?)').bind(job.id,index,chunk.digest,JSON.stringify(chunk)),db.prepare('UPDATE porthole_archive_jobs SET next_chunk=next_chunk+1,chain_hash=?,validation=? WHERE id=?').bind(chunk.digest,JSON.stringify(state),job.id)])
 if((index+1)*chunkRows>=job.row_count)await finishExport(db,actor,await jobFor(db,job.id,actor))
 return chunk
}
async function finishExport(db:D1Database,actor:Authority,job:Job):Promise<void> {
 if(job.next_chunk!==Math.ceil(job.row_count/chunkRows))fail('archive_incomplete',409)
 const state=JSON.parse(job.validation) as Validation
 const manifest:Manifest={format,id:job.id,createdAt:job.created_at,rowCount:job.row_count,chunks:job.next_chunk,rootHash:job.chain_hash,tables:state.tables??initialValidation().tables,inactive:true}
 await db.batch([guard(db,actor),db.prepare("UPDATE porthole_archive_jobs SET state='complete',manifest=? WHERE id=?").bind(JSON.stringify(manifest),job.id)])
}
export async function exportManifest(db:D1Database,actor:Authority,job:Job):Promise<Manifest> {
 if(job.state!=='complete') {
  if(job.row_count===0){await finishExport(db,actor,job);job=await jobFor(db,job.id,actor)}
  else fail('archive_incomplete',409)
 }
 await db.batch([guard(db,actor)])
 return JSON.parse(job.manifest!) as Manifest
}
export const jobStatus=(job:Job)=>({id:job.id,direction:job.direction,state:job.state,rowCount:job.row_count,nextChunk:job.next_chunk,chainHash:job.chain_hash,createdAt:job.created_at,chunkRows,totalChunks:job.direction==='restore'?JSON.parse(job.manifest!).chunks:Math.ceil(job.row_count/chunkRows)})
