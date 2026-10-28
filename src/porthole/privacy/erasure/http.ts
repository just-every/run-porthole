import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { authority, fail, proofFence } from '../../security/authority'
import { input } from '../../security/input'
import { digest } from '../../audit/store'
import { privateHeaders } from '../../document'

const root = '/api/porthole/v1/subject-erasure'
const json = (value: unknown, status = 200) => Response.json(value,{status,headers:privateHeaders})
// Exact decoded string values only. A batch is the indivisible original-wire
// custody unit; preview includes its other records before any owner approval.
const mixed = `SELECT 1 FROM porthole_ingest_batches b,json_each(b.records) r WHERE b.id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM json_tree(r.value) j WHERE j.type='text' AND j.atom=?) LIMIT 1`
const matched = `SELECT b.id,b.digest,b.record_count,b.byte_count FROM porthole_ingest_batches b WHERE EXISTS(SELECT 1 FROM json_tree(b.records) j WHERE j.type='text' AND j.atom=?) ORDER BY b.id`
const erased = 'SELECT id FROM porthole_ingest_batches WHERE id IN (SELECT id FROM porthole_erased_batches) OR digest IN (SELECT content_digest FROM porthole_erased_batches)'
export function eraseJournaledBatches(db: D1Database): D1PreparedStatement[] {
 return [
  // Preserve a scoped missing-evidence window after removing the original
  // bytes, so a later drain or evaluation cannot turn erasure into recovery.
  db.prepare(`INSERT INTO porthole_ingest_events(id,source_id,signal,team,service,environment,occurred_at,kind,reason,record_count,batch_ref,range_start_ns,range_end_ns)
   SELECT lower(hex(randomblob(16))),b.source_id,b.signal,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment'),CAST(unixepoch('subsec')*1000 AS INTEGER),'buffer_loss','owner_erasure',COUNT(*),b.id,MIN(json_extract(j.value,'$.eventTimeNs')),MAX(json_extract(j.value,'$.eventTimeNs'))
   FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.id IN (${erased})
   AND NOT EXISTS(SELECT 1 FROM porthole_ingest_events e WHERE e.batch_ref=b.id AND e.reason='owner_erasure' AND e.team=json_extract(j.value,'$.team') AND e.service=json_extract(j.value,'$.service') AND e.environment=json_extract(j.value,'$.environment'))
   GROUP BY b.id,json_extract(j.value,'$.team'),json_extract(j.value,'$.service'),json_extract(j.value,'$.environment')`),
  db.prepare(`DELETE FROM porthole_telemetry_records WHERE batch_id IN (${erased})`),
  db.prepare(`DELETE FROM porthole_telemetry_archive WHERE batch_id IN (${erased})`),
  db.prepare(`UPDATE porthole_ingest_batches SET identity='erased:'||id,wire_base64='',records='[]',record_count=0,byte_count=0 WHERE id IN (${erased})`),
  db.prepare("UPDATE porthole_health_receipts SET status='Unknown',expires_at=0,reason='Local telemetry was erased; coverage requires new observation.'"),
  db.prepare("DELETE FROM porthole_monitor_runs"),
  db.prepare("UPDATE porthole_monitor_state SET status='Unknown',reason='Local telemetry was erased; prior evidence is incomplete.'"),
 ]
}
export async function subjectErasureResponse(request: Request, env: Bindings): Promise<Response|null> {
 const url = new URL(request.url)
 if(url.pathname!==root && url.pathname!==root+'/apply' && url.pathname!==root+'/journal')return null
 try {
  const post=request.method==='POST',actor=await authority(request,env,{post,stepUp:post})
  if(actor.session.kind!=='native'||actor.member.role!=='owner'||Object.values(actor.member.scope).some(values=>!values.includes('*')))fail('unrestricted_native_owner_required')
  if(url.search)fail('invalid_erasure_request',400)
  if(url.pathname===root+'/journal') {
   if(post) {
    const data=await input(request),entries=data.records
    if(Object.keys(data).sort().join(',')!=='confirm,format,records'||data.confirm!=='apply-erasure-journal'||data.format!=='porthole.erased-batches.v1'||!Array.isArray(entries)||!entries.length||entries.length>100||entries.some(row=>!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='content_digest,erased_at,id'||typeof row.id!=='string'||!/^[a-f0-9-]{36}$/.test(row.id)||typeof row.content_digest!=='string'||!/^[a-f0-9]{64}$/.test(row.content_digest)||!Number.isSafeInteger(row.erased_at)||row.erased_at<0||row.erased_at>Date.now()))fail('invalid_erasure_journal',400)
    const proof=proofFence(actor)
    await env.DB.batch([
     env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND NOT EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE changed_at!=0) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args),
     ...entries.map(row=>env.DB.prepare('INSERT INTO porthole_erased_batches(id,content_digest,erased_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at) WHERE content_digest=excluded.content_digest').bind(row.id,row.content_digest,row.erased_at)),
     ...entries.map(row=>env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM porthole_erased_batches WHERE id=? AND content_digest=?) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(row.id,row.content_digest)),
     env.DB.prepare('DELETE FROM porthole_archive_chunks'),env.DB.prepare('DELETE FROM porthole_archive_rows'),env.DB.prepare('DELETE FROM porthole_archive_jobs'),
     ...eraseJournaledBatches(env.DB),
    ])
    return json({applied:entries.length,batchIds:entries.map(row=>row.id)})
   }
   if(request.method!=='GET')fail('method_not_allowed',405)
   const rows=(await env.DB.prepare(`SELECT id,content_digest,erased_at FROM porthole_erased_batches WHERE ${actor.fence} ORDER BY id LIMIT 101`).bind(...actor.args).all()).results
   // No silently truncated portable journal.
   if(rows.length>100)fail('erasure_journal_requires_archive',409)
   return json({format:'porthole.erased-batches.v1',records:rows})
  }
  if(!post)fail('method_not_allowed',405)
  const data=await input(request),apply=url.pathname.endsWith('/apply')
  if(Object.keys(data).some(key=>!(apply?['identifier','digest','confirm']:['identifier']).includes(key))||typeof data.identifier!=='string'||data.identifier.length<3||data.identifier.length>256||/[\u0000-\u001f\u007f]/.test(data.identifier))fail('invalid_erasure_request',400)
  const rows=(await env.DB.prepare(matched+' LIMIT 101').bind(data.identifier).all<{id:string;digest:string;record_count:number;byte_count:number}>()).results
  if(rows.length>100)fail('erasure_selection_too_large',409)
  const fingerprint=await digest(JSON.stringify(rows))
  const mixedBatch=await env.DB.prepare(mixed).bind(JSON.stringify(rows.map(row=>row.id)),data.identifier).first()
  const limitations=['Only exact decoded string values in local telemetry envelopes are mapped. Mixed-subject batches are refused; unrelated records must never be erased.', 'RUM, external analytical replicas, customer buckets, legal holds, derived projections, notice receipts and external backup copies are not qualified by this operation. No external deletion is attempted.', 'Existing product archive jobs are invalidated. Downloaded archives need the later journal; late arrivals and alternate representations require a new reviewed request.']
  if(!apply)return json({digest:fingerprint,batches:rows.map(row=>({id:row.id,records:row.record_count,bytes:row.byte_count})),records:rows.reduce((n,row)=>n+row.record_count,0),canApply:!mixedBatch,limitations})
  if(mixedBatch)fail('mixed_subject_batch_requires_record_erasure',409)
  if(data.confirm!=='erase-exact-batches'||data.digest!==fingerprint)fail('erasure_preview_changed',409)
  if(!rows.length)return json({batchIds:[],erasedBatches:0,erasedRecords:0,digest:fingerprint,limitations})
  // Never imply that replicated copies have been erased by local deletion.
  const analytical=await env.DB.prepare('SELECT changed_at FROM porthole_analytical_configuration WHERE singleton=1').first<{changed_at:number}>()
  if(analytical?.changed_at)fail('analytical_erasure_not_supported',409)
  const proof=proofFence(actor)
  const current=`SELECT json_group_array(json_object('id',id,'digest',digest,'record_count',record_count,'byte_count',byte_count)) FROM (${matched})`
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND (${current})=? AND NOT EXISTS(${mixed.replace(' LIMIT 1','')}) AND NOT EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE changed_at!=0) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args,data.identifier,JSON.stringify(rows),JSON.stringify(rows.map(row=>row.id)),data.identifier),
   ...rows.map(row=>env.DB.prepare('INSERT INTO porthole_erased_batches(id,content_digest,erased_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(row.id,row.digest,Date.now())),
   // Invalidate frozen portable snapshots before deleting the original wire.
   env.DB.prepare('DELETE FROM porthole_archive_chunks'),env.DB.prepare('DELETE FROM porthole_archive_rows'),env.DB.prepare('DELETE FROM porthole_archive_jobs'),
   ...eraseJournaledBatches(env.DB),
  ])
  return json({batchIds:rows.map(row=>row.id),erasedBatches:rows.length,erasedRecords:rows.reduce((n,row)=>n+row.record_count,0),digest:fingerprint,limitations})
 }catch(error) {
  return json({error:error instanceof AuthError?error.code:'subject_erasure_unavailable'},error instanceof AuthError?error.status:503)
 }
}
