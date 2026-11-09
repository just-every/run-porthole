import type {Bindings} from '../../../auth.server'
import {fail,proofFence,type Authority} from '../../security/authority'
import {configuration,rpc,roles,type Role} from '../../analytical/client'
import {digest} from '../../audit/store'
import {canonical} from '../../ingest/model'

interface Review {confirmation:string;retainedBatches:number;retainedRecords:number;fencedBatches:number;fencedRecords:number;destinationIdentity:string;inventoryDigest:string;recoveredAt?:number}
/** Native owner authority never travels in an archive. The private worker
 * connection authorizes a reviewed projection, not arbitrary source adoption. */
export async function recoverAnalytical(env:Bindings,actor:Authority,data:Record<string,unknown>) {
 if(Object.keys(data).some(key=>!['mode','role','previousIdentity','confirmation'].includes(key)))fail('invalid_recovery',400)
 const role=data.role as Role,mode=data.mode
 if(!roles.includes(role)||!['preview','commit'].includes(String(mode))||typeof data.previousIdentity!=='string'||!data.previousIdentity.length||data.previousIdentity.length>256)fail('invalid_recovery',400)
 if(!Object.values(actor.member.scope).every(values=>values.includes('*')))fail('global_pipeline_authority_required')
 const config=await configuration(env)
 if(config.enabled)fail('recovery_requires_paused_connection',409)
 const batches=(await env.DB.prepare("SELECT b.id,b.completion_sequence,b.source_id,b.signal,b.digest,b.accepted_at,b.completed_at,b.record_count,(SELECT COUNT(*) FROM porthole_telemetry_records r WHERE r.batch_id=b.id) AS record_rows,(SELECT COUNT(*) FROM porthole_telemetry_archive a WHERE a.batch_id=b.id) AS archive_rows FROM porthole_ingest_batches b WHERE state='complete' ORDER BY completion_sequence LIMIT 1001").all<{id:string;completion_sequence:number;source_id:string;signal:string;digest:string;accepted_at:number;completed_at:number;record_count:number;record_rows:number;archive_rows:number}>()).results
 if(batches.length>1000)fail('recovery_inventory_limit',413)
 const inventory=[]
 for(const batch of batches){
  const rows=(await env.DB.prepare('SELECT r.*,a.archived_at FROM porthole_telemetry_records r JOIN porthole_telemetry_archive a ON a.id=r.id WHERE r.batch_id=? ORDER BY r.ordinal').bind(batch.id).all<{id:string;ordinal:number;team:string;service:string;environment:string;event_time_ns:string;trace_id:string|null;span_id:string|null;payload:string;indexed_at:number;archived_at:number;late:number;out_of_order:number}>()).results
  const packet={id:batch.id,completionSequence:batch.completion_sequence,sourceId:batch.source_id,signal:batch.signal,digest:batch.digest,acceptedAt:batch.accepted_at,completedAt:batch.completed_at,records:rows.map(row=>({id:row.id,ordinal:row.ordinal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.event_time_ns,traceId:row.trace_id,spanId:row.span_id,payload:JSON.parse(row.payload),indexedAt:row.indexed_at,archivedAt:row.archived_at,late:row.late,outOfOrder:row.out_of_order}))}
  inventory.push({id:batch.id,completionSequence:batch.completion_sequence,contentDigest:await digest(canonical(packet)),recordCount:rows.length})
 }
 const proof=proofFence(actor),checkpoint=JSON.stringify(batches.map(batch=>({id:batch.id,sequence:batch.completion_sequence,input:batch.record_count,records:batch.record_rows,archive:batch.archive_rows})))
 const custody=`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN porthole_ingest_batches b ON b.id=json_extract(j.value,'$.id') WHERE b.id IS NULL OR b.state!='complete' OR b.completion_sequence!=json_extract(j.value,'$.sequence') OR b.record_count!=json_extract(j.value,'$.input') OR (SELECT COUNT(*) FROM porthole_telemetry_records r WHERE r.batch_id=b.id)!=json_extract(j.value,'$.records') OR (SELECT COUNT(*) FROM porthole_telemetry_archive a WHERE a.batch_id=b.id)!=json_extract(j.value,'$.archive'))`
 const condition=`${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND enabled=0) AND (SELECT COUNT(*) FROM porthole_ingest_batches WHERE state='complete')=? AND ${custody}`
 const args=[...actor.args,...proof.args,config.revision,inventory.length,checkpoint]
 const live=()=>env.DB.prepare(`SELECT 1 AS live WHERE ${condition}`).bind(...args).first()
 if(!await live())fail('recovery_review_changed',409)
 const input={sourceIdentity:config.source_identity,previousIdentity:data.previousIdentity,batches:inventory}
 let review=await rpc<Review>(env,role,'/v1/recovery/preview',input)
 if(mode==='commit'){
  if(data.confirmation!==review.confirmation)fail('recovery_review_changed',409)
  // The same transaction that rechecks the exact local custody marks analytical
  // custody before adoption. Existing erasure doors must stay fenced even while
  // this connection is paused, or a later connect could expose an erased row.
  const marked=await env.DB.prepare(`UPDATE porthole_analytical_configuration SET changed_at=CASE WHEN changed_at=0 THEN ? ELSE changed_at END WHERE singleton=1 AND ${condition} RETURNING revision`).bind(Date.now(),...args).all()
  if(!marked.results.length)fail('recovery_review_changed',409)
  review=await rpc<Review>(env,role,'/v1/recovery/commit',{...input,confirmation:data.confirmation})
 }
 if(!await live())fail('recovery_review_changed',409)
 return {role,...review,health:'Unknown',connection:'Explicit owner connection required',boundary:'Fenced rows remain in analytical custody; they are not restored records and are excluded from live queries.'}
}
