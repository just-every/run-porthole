import { chunkRows, type Chunk, type PortableRow } from './format'

// Rows already belong to the immutable export snapshot or staged restore.
// Caching their full packet again can exceed SQLite's value limit when several
// individually supported intake envelopes share a chunk. Keep its exact header
// and reconstruct the transport from those same rows. Existing full caches are
// still readable; the archive format, digest chain and row boundaries do not change.
export const packetHeader = (chunk: Chunk) => JSON.stringify({ ...chunk, rows: [] })
export async function cachedChunk(db: D1Database, jobId: string, index: number): Promise<Chunk | null> {
 const cached = await db.prepare('SELECT packet FROM porthole_archive_chunks WHERE job_id=? AND chunk_index=?').bind(jobId,index).first<{packet:string}>()
 if (!cached) return null
 const chunk = JSON.parse(cached.packet) as Chunk
 if (chunk.rows.length) return chunk
 const rows = (await db.prepare('SELECT payload FROM porthole_archive_rows WHERE job_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal').bind(jobId,index*chunkRows,(index+1)*chunkRows).all<{payload:string}>()).results
 return { ...chunk, rows: rows.map(row => JSON.parse(row.payload) as PortableRow) }
}
