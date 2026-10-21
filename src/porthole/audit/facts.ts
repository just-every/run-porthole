import { append, type AuditInput } from './store'
interface Fact {id:string;operation_ref:string;actor_ref:string|null;actor_revision:number|null;action:string;entity_ref:string;revision:number|null;occurred_at:number;recorded_at:number}
/** Projection can restart after any row: the immutable fact id is also the
 * chain event id. A write is durable even if its HTTP outcome is never sent. */
export async function projectFacts(db:D1Database) {
 while(true) {
  const rows=(await db.prepare(`SELECT f.* FROM porthole_audit_facts f LEFT JOIN porthole_audit_entries a ON a.event_id=f.id WHERE a.event_id IS NULL ORDER BY f.ordinal LIMIT 100`).all<Fact>()).results
  if(!rows.length) return
  for(const row of rows) {
   const input:AuditInput={operationRef:row.operation_ref,actorRef:row.actor_ref,actorRevision:row.actor_revision,action:row.action,entityRef:row.entity_ref,revision:row.revision,occurredAt:row.occurred_at,phase:'committed',status:null}
   await append(db,input,{eventId:row.id,recordedAt:row.recorded_at})
  }
 }
}
