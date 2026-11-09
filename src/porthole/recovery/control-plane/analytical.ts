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
 const config=await configuration(env)
 if(config.enabled)fail('recovery_requires_paused_connection',409)
 const batches=(await env.DB.prepare("SELECT id,completion_sequence,source_id,signal,digest,accepted_at,completed_at FROM porthole_ingest_batches WHERE state='complete' ORDER BY completion_sequence LIMIT 1001").all<{id:string;completion_sequence:number;source_id:string;signal:string;digest:string;accepted_at:number;completed_at:number}>()).results
 if(batches.length>1000)fail('recovery_inventory_limit',413)
 const inventory=[]
 for(const batch of batches){
  const rows=(await env.DB.prepare('SELECT r.*,a.archived_at FROM porthole_telemetry_records r JOIN porthole_telemetry_archive a ON a.id=r.id WHERE r.batch_id=? ORDER BY r.ordinal').bind(batch.id).all<{id:string;ordinal:number;team:string;service:string;environment:string;event_time_ns:string;trace_id:string|null;span_id:string|null;payload:string;indexed_at:number;archived_at:number;late:number;out_of_order:number}>()).results
  const packet={id:batch.id,completionSequence:batch.completion_sequence,sourceId:batch.source_id,signal:batch.signal,digest:batch.digest,acceptedAt:batch.accepted_at,completedAt:batch.completed_at,records:rows.map(row=>({id:row.id,ordinal:row.ordinal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.event_time_ns,traceId:row.trace_id,spanId:row.span_id,payload:JSON.parse(row.payload),indexedAt:row.indexed_at,archivedAt:row.archived_at,late:row.late,outOfOrder:row.out_of_order}))}
  inventory.push({id:batch.id,completionSequence:batch.completion_sequence,contentDigest:await digest(canonical(packet)),recordCount:rows.length})
 }
 const proof=proofFence(actor)
 const live=()=>env.DB.prepare(`SELECT 1 AS live WHERE ${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND enabled=0) AND (SELECT COUNT(*) FROM porthole_ingest_batches WHERE state='complete')=?`).bind(...actor.args,...proof.args,config.revision,inventory.length).first()
 if(!await live())fail('recovery_review_changed',409)
 const input={sourceIdentity:config.source_identity,previousIdentity:data.previousIdentity,batches:inventory,...(mode==='commit'?{confirmation:data.confirmation}:{})}
 const review=await rpc<Review>(env,role,mode==='commit'?'/v1/recovery/commit':'/v1/recovery/preview',input)
 if(!await live())fail('recovery_review_changed',409)
 return {role,...review,health:'Unknown',connection:'Explicit owner connection required',boundary:'Fenced rows remain in analytical custody; they are not restored records and are excluded from live queries.'}
}
