import {digest,genesis} from '../audit/store'
import {fail} from '../security/authority'
import {chunkRows,type Chunk,type PortableRow} from './format'

const referenceFormat='porthole.frozen-chunk-reference.v1'
// A packet can contain several individually valid D1 rows. Keep a small
// reference when their combined JSON exceeds a safe single-cell cache size.
export function cachedPacket(chunk:Chunk):string {
 const packet=JSON.stringify(chunk)
 return new TextEncoder().encode(packet).byteLength<=1024*1024?packet:JSON.stringify({format:referenceFormat,order:Object.keys(chunk)})
}
export async function storedChunk(db:D1Database,jobId:string,index:number):Promise<Chunk|null> {
 const saved=await db.prepare('SELECT digest,packet FROM porthole_archive_chunks WHERE job_id=? AND chunk_index=?').bind(jobId,index).first<{digest:string;packet:string}>()
 if(!saved)return null
 const cached=JSON.parse(saved.packet) as Chunk & {format?:string;order?:string[]}
 if(cached?.format!==referenceFormat)return cached as Chunk
 const previous=index===0?genesis:(await db.prepare('SELECT digest FROM porthole_archive_chunks WHERE job_id=? AND chunk_index=?').bind(jobId,index-1).first<{digest:string}>())?.digest
 const rows=(await db.prepare('SELECT payload FROM porthole_archive_rows WHERE job_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal').bind(jobId,index*chunkRows,(index+1)*chunkRows).all<{payload:string}>()).results.map(row=>JSON.parse(row.payload) as PortableRow)
 if(!previous||!rows.length||!Array.isArray(cached.order)||[...cached.order].sort().join(',')!=='digest,index,previousHash,rows,version')fail('archive_integrity_failed',409)
 const fields:Record<string,unknown>={version:1,index,previousHash:previous,rows,digest:saved.digest}
 // Preserve the original envelope key order as well as every frozen row:
 // the existing archive digest binds that exact JSON representation.
 const chunk=Object.fromEntries(cached.order.map(key=>[key,fields[key]])) as unknown as Chunk
 const {digest:claimed,...base}=chunk
 if(await digest(JSON.stringify(base))!==claimed)fail('archive_integrity_failed',409)
 return chunk
}
