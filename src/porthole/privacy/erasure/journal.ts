import { fail } from '../../security/authority'
export interface ErasedBatch {id:string;content_digest:string;erased_at:number;ordinals:number[]|null}
export const columns='id,content_digest,erased_at,ordinals'
// A whole-envelope fence dominates a selective fence; selective updates only grow.
export const mergeOrdinals=`CASE WHEN porthole_erased_batches.ordinals IS NULL OR excluded.ordinals IS NULL THEN NULL ELSE (SELECT json_group_array(value) FROM (SELECT value FROM json_each(porthole_erased_batches.ordinals) UNION SELECT value FROM json_each(excluded.ordinals) ORDER BY value)) END`
export function appendJournal(db:D1Database,rows:ErasedBatch[]) {
 return rows.map(row=>db.prepare(`INSERT INTO porthole_erased_batches(${columns}) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at),ordinals=${mergeOrdinals} WHERE content_digest=excluded.content_digest`).bind(row.id,row.content_digest,row.erased_at,row.ordinals===null?null:JSON.stringify(row.ordinals)))
}
export async function journalRows(db:D1Database):Promise<ErasedBatch[]> {
 const rows=(await db.prepare(`SELECT ${columns} FROM porthole_erased_batches ORDER BY id`).all<Omit<ErasedBatch,'ordinals'>&{ordinals:string|null}>()).results
 return rows.map(row=>({...row,ordinals:row.ordinals===null?null:JSON.parse(row.ordinals)}))
}
export function validateEntries(value:unknown,legacy=false):ErasedBatch[] {
 if(!Array.isArray(value)||!value.length||value.length>100)fail('invalid_erasure_journal',400)
 return value.map(row=>{
  if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!==(legacy?'content_digest,erased_at,id':'content_digest,erased_at,id,ordinals')||typeof row.id!=='string'||!/^[a-f0-9-]{36}$/.test(row.id)||typeof row.content_digest!=='string'||!/^[a-f0-9]{64}$/.test(row.content_digest)||!Number.isSafeInteger(row.erased_at)||row.erased_at<0||row.erased_at>Date.now())fail('invalid_erasure_journal',400)
  const ordinals=legacy?null:row.ordinals
  if(ordinals!==null&&(!Array.isArray(ordinals)||!ordinals.length||ordinals.length>10000||ordinals.some((n:unknown,index:number)=>!Number.isSafeInteger(n)||Number(n)<0||index>0&&Number(n)<=ordinals[index-1])||new Set(ordinals).size!==ordinals.length))fail('invalid_erasure_journal',400)
  return {...row,ordinals}
 })
}
const batches=`SELECT b.id FROM porthole_ingest_batches b JOIN porthole_erased_batches e ON e.id=b.id OR e.content_digest=b.digest`
const erasedOrdinal=(batch:string,ordinal:string)=>`EXISTS(SELECT 1 FROM porthole_erased_batches e JOIN porthole_ingest_batches erased_source ON erased_source.id=e.id OR erased_source.digest=e.content_digest WHERE erased_source.id=${batch} AND (e.ordinals IS NULL OR EXISTS(SELECT 1 FROM json_each(e.ordinals) o WHERE o.value=${ordinal})))`
export function eraseJournaledBatches(db:D1Database):D1PreparedStatement[] {
 const selected=erasedOrdinal('b.id','CAST(j.key AS INTEGER)')
 return [
  db.prepare(`INSERT INTO porthole_ingest_events(id,source_id,signal,team,service,environment,occurred_at,kind,reason,record_count,batch_ref,range_start_ns,range_end_ns)
   SELECT lower(hex(randomblob(16))),b.source_id,b.signal,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),CAST(unixepoch('subsec')*1000 AS INTEGER),'buffer_loss','owner_erasure',COUNT(*),b.id,MIN(json_extract(j.value,'$.eventTimeNs')),MAX(json_extract(j.value,'$.eventTimeNs'))
   FROM porthole_ingest_batches b,json_each(b.records) j WHERE j.type='object' AND ${selected}
   GROUP BY b.id,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment')`),
  ...['porthole_telemetry_records','porthole_telemetry_archive','porthole_metric_points'].map(table=>db.prepare(`DELETE FROM ${table} WHERE ${erasedOrdinal(table+'.batch_id',table+'.ordinal')}`)),
  // Null holes preserve original record IDs and ordinals. No original wire may
  // survive a partial erasure, because it still contains the removed subject.
  db.prepare(`UPDATE porthole_ingest_batches AS b SET wire_base64='',identity='erased:'||id,records=COALESCE((SELECT CASE WHEN SUM(CASE WHEN j.type='object' AND NOT (${selected}) THEN 1 ELSE 0 END)=0 THEN '[]' ELSE json_group_array(CASE WHEN j.type='object' AND NOT (${selected}) THEN json(j.value) ELSE NULL END) END FROM json_each(b.records) j),'[]') WHERE b.id IN (${batches})`),
  db.prepare(`UPDATE porthole_ingest_batches SET record_count=(SELECT COUNT(*) FROM json_each(records) WHERE type='object'),byte_count=CASE WHEN records='[]' THEN 0 ELSE length(CAST(records AS BLOB)) END WHERE id IN (${batches})`),
  db.prepare("UPDATE porthole_health_receipts SET status='Unknown',expires_at=0,reason='Local telemetry was erased; coverage requires new observation.'"),
  db.prepare("UPDATE porthole_monitor_state SET status='Unknown',reason='Local telemetry was erased; prior evidence is incomplete.'"),
 ]
}
export const invalidateArchives=(db:D1Database)=>['porthole_archive_chunks','porthole_archive_rows','porthole_archive_jobs'].map(table=>db.prepare(`DELETE FROM ${table}`))
