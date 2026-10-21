import { append } from './store'
/** Native transfer jobs retain the event timestamp/actor in the transaction
 * that changes their durable state. Only this explicit projection enters audit. */
export async function projectNativeTransfers(db:D1Database) {
 const rows=(await db.prepare(`SELECT j.id,j.kind,json_extract(e.value,'$.id') AS event_id,json_extract(e.value,'$.phase') AS phase,json_extract(e.value,'$.occurredAt') AS occurred_at,json_extract(e.value,'$.actorRef') AS actor_ref,json_extract(e.value,'$.actorRevision') AS actor_revision
 FROM rer_portability_jobs j,json_each(j.metadata,'$.portholeAuditTrail') e
 LEFT JOIN porthole_audit_entries a ON a.event_id=json_extract(e.value,'$.id')
 WHERE a.event_id IS NULL ORDER BY json_extract(e.value,'$.occurredAt'),j.id,e.key`).all<{id:string;kind:string;event_id:string;phase:string;occurred_at:number;actor_ref:string|null;actor_revision:number|null}>()).results
 for(const row of rows) {
  if(!['import','export'].includes(row.kind) || !['building','staging','applying','complete','aborted'].includes(row.phase))throw Error('invalid_native_transfer_audit')
  await append(db,{operationRef:row.id,action:`installation.${row.kind}.${row.phase}`,actorRef:row.actor_ref,actorRevision:row.actor_revision,entityRef:row.id,revision:null,phase:row.phase==='complete'?'succeeded':row.phase==='aborted'?'failed':row.phase==='applying'?'committed':'attempted',status:null,occurredAt:row.occurred_at},{eventId:row.event_id,recordedAt:row.occurred_at})
 }
}
