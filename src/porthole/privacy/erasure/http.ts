import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { authority, fail, proofFence } from '../../security/authority'
import { input } from '../../security/input'
import { digest } from '../../audit/store'
import { privateHeaders } from '../../document'
import { configuration } from '../../analytical/client'
import { syncErasure } from '../../analytical/erasure'
import { appendJournal,eraseJournaledBatches,invalidateArchives,journalRows,validateEntries } from './journal'
export {eraseJournaledBatches} from './journal'
const root='/api/porthole/v1/subject-erasure'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
const matched=`SELECT b.id,b.digest,b.record_count,b.byte_count,(SELECT json_group_array(CAST(r.key AS INTEGER)) FROM json_each(b.records) r WHERE r.type='object' AND EXISTS(SELECT 1 FROM json_tree(r.value) j WHERE j.type='text' AND j.atom=?)) AS ordinals FROM porthole_ingest_batches b WHERE EXISTS(SELECT 1 FROM json_tree(b.records) j WHERE j.type='text' AND j.atom=?) ORDER BY b.id`
interface Match {id:string;digest:string;record_count:number;byte_count:number;ordinals:string}
export async function subjectErasureResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(![root,root+'/apply',root+'/journal'].includes(url.pathname))return null
 try {
  const post=request.method==='POST',actor=await authority(request,env,{post,stepUp:post})
  if(actor.session.kind!=='native'||actor.member.role!=='owner'||Object.values(actor.member.scope).some(values=>!values.includes('*')))fail('unrestricted_native_owner_required')
  if(url.search)fail('invalid_erasure_request',400)
  if(url.pathname===root+'/journal') {
   if(post) {
    const data=await input(request)
    if(Object.keys(data).sort().join(',')!=='confirm,format,records'||data.confirm!=='apply-erasure-journal'||!['porthole.erased-batches.v1','porthole.erased-batches.v2'].includes(String(data.format)))fail('invalid_erasure_journal',400)
    const entries=validateEntries(data.records,data.format==='porthole.erased-batches.v1'),proof=proofFence(actor)
    await env.DB.batch([
     env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args),
     ...appendJournal(env.DB,entries),
     ...entries.map(row=>env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM porthole_erased_batches WHERE id=? AND content_digest=?) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(row.id,row.content_digest)),
     ...invalidateArchives(env.DB),...eraseJournaledBatches(env.DB),
    ])
    const custody=await syncErasure(env)
    return json({applied:entries.length,batchIds:entries.map(row=>row.id),custody},custody.complete?200:202)
   }
   if(request.method!=='GET')fail('method_not_allowed',405)
   const records=await journalRows(env.DB)
   if(records.length>100)fail('erasure_journal_requires_archive',409)
   return json({format:'porthole.erased-batches.v2',records})
  }
  if(!post)fail('method_not_allowed',405)
  const data=await input(request),apply=url.pathname.endsWith('/apply')
  if(Object.keys(data).some(key=>!(apply?['identifier','digest','confirm']:['identifier']).includes(key))||typeof data.identifier!=='string'||data.identifier.length<3||data.identifier.length>256||/[\u0000-\u001f\u007f]/.test(data.identifier))fail('invalid_erasure_request',400)
  const rows=(await env.DB.prepare(matched+' LIMIT 101').bind(data.identifier,data.identifier).all<Match>()).results
  if(rows.length>100)fail('erasure_selection_too_large',409)
  const config=await configuration(env),fingerprint=await digest(JSON.stringify({rows,configuration:config.revision,source:config.source_identity}))
  const limitations=['Only exact decoded string values in local telemetry envelopes are mapped. The original wire is withdrawn; unrelated normalized records keep their identities.', 'Configured primary and standby analytical custody receive the same permanent record fences. An unreachable copy remains explicitly pending; reads require its journal checkpoint.', 'RUM, customer buckets, legal holds, derived projections, notice receipts and external backup copies remain unqualified. No external deletion is attempted. Downloaded archives need the later journal; late arrivals and alternate representations require a new reviewed request.']
  const batches=rows.map(row=>({id:row.id,records:JSON.parse(row.ordinals).length,remainingRecords:row.record_count-JSON.parse(row.ordinals).length,bytes:row.byte_count})),records=batches.reduce((n,row)=>n+row.records,0)
  if(!apply)return json({digest:fingerprint,batches,records,canApply:true,limitations})
  if(data.confirm!=='erase-exact-batches'||data.digest!==fingerprint)fail('erasure_preview_changed',409)
  const proof=proofFence(actor)
  const current=`SELECT json_group_array(json_object('id',id,'digest',digest,'record_count',record_count,'byte_count',byte_count,'ordinals',ordinals)) FROM (${matched})`
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND (${current})=? AND EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE revision=? AND source_identity=?) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args,data.identifier,data.identifier,JSON.stringify(rows),config.revision,config.source_identity),
   ...appendJournal(env.DB,rows.map(row=>({id:row.id,content_digest:row.digest,erased_at:Date.now(),ordinals:JSON.parse(row.ordinals)}))),
   ...invalidateArchives(env.DB),...eraseJournaledBatches(env.DB),
  ])
  const custody=await syncErasure(env)
  return json({batchIds:rows.map(row=>row.id),erasedBatches:rows.length,erasedRecords:records,digest:fingerprint,limitations,custody},custody.complete?200:202)
 }catch(error){return json({error:error instanceof AuthError?error.code:'subject_erasure_unavailable'},error instanceof AuthError?error.status:503)}
}
