import { canonical, digest, fail, integer, keys, text } from './protocol.mjs'
import { state } from './coverage.mjs'

/** A new control plane authorizes only exact retained sealed batches. Physical
 * rows outside that inventory remain in custody, fenced from all live reads. */
async function preview(db,input) {
 keys(input,['sourceIdentity','previousIdentity','batches','confirmation'])
 text(input.sourceIdentity);text(input.previousIdentity)
 if(input.sourceIdentity===input.previousIdentity)fail('recovery_destination_required',409)
 if(!Array.isArray(input.batches)||input.batches.length>1000)fail('recovery_inventory_limit',413)
 for(const [index,batch]of input.batches.entries()){
  keys(batch,['id','completionSequence','contentDigest','recordCount'])
  text(batch.id,100);text(batch.contentDigest,64);integer(batch.recordCount)
  if(batch.completionSequence!==index+1)fail('recovery_inventory_incomplete',409)
 }
 if(new Set(input.batches.map(row=>row.id)).size!==input.batches.length)fail('recovery_inventory_incomplete',409)
 const inventoryDigest=await digest(canonical(input.batches))
 const recovered=await db.prepare('SELECT * FROM analytics_recoveries WHERE previous_identity=? AND destination_identity=? AND inventory_digest=? ORDER BY recovered_at DESC LIMIT 1').bind(input.previousIdentity,input.sourceIdentity,inventoryDigest).first()
 const current=await state(db)
 if(recovered&&current.source_identity===input.sourceIdentity)return {previousIdentity:recovered.previous_identity,destinationIdentity:recovered.destination_identity,inventoryDigest,retainedBatches:recovered.retained_batches,retainedRecords:recovered.retained_records,fencedBatches:recovered.fenced_batches,fencedRecords:recovered.fenced_records,confirmation:recovered.id,recoveredAt:recovered.recovered_at}

 if(current.stopped)fail('analytics_stopped',503)
 if(current.source_identity!==input.previousIdentity)fail('analytics_source_mismatch',409)
 const inventory=JSON.stringify(input.batches)
 const mismatch=await db.prepare(`SELECT COUNT(*) AS n FROM json_each(?) j LEFT JOIN analytics_batches b ON b.id=json_extract(j.value,'$.id')
 WHERE b.id IS NULL OR b.content_digest!=json_extract(j.value,'$.contentDigest') OR b.record_count!=json_extract(j.value,'$.recordCount')
 OR b.record_count!=(SELECT COUNT(*) FROM analytics_records r WHERE r.batch_id=b.id)`).bind(inventory).first()
 if(mismatch.n)fail('recovery_inventory_mismatch',409)
 const counts=await db.prepare(`SELECT COUNT(*) AS batches,COALESCE(SUM(record_count),0) AS records FROM analytics_batches`).first()
 const active=await db.prepare('SELECT COUNT(*) AS batches,COALESCE(MAX(completion_sequence),0) AS highest FROM analytics_active_batches').first()
 const retainedRecords=input.batches.reduce((sum,row)=>sum+row.recordCount,0)
 const result={previousIdentity:input.previousIdentity,destinationIdentity:input.sourceIdentity,inventoryDigest:await digest(canonical(input.batches)),retainedBatches:input.batches.length,retainedRecords,fencedBatches:counts.batches-input.batches.length,fencedRecords:counts.records-retainedRecords,physicalBatches:counts.batches,activeBatches:active.batches,activeHighest:active.highest}
 return {...result,confirmation:await digest(canonical(result))}
}
export const recoveryPreview=(db,input)=>preview(db,input)
export async function recoveryCommit(db,input) {
 const result=await preview(db,input)
 if(input.confirmation!==result.confirmation)fail('recovery_review_changed',409)
 if(result.recoveredAt)return result
 // All cross-process work is fenced again inside this worker's transaction.
 // Retained content is immutable; row and active counts detect new replication.
 const inventory=JSON.stringify(input.batches),id=result.confirmation
 await db.batch([
  db.prepare(`INSERT INTO analytics_recoveries(id,previous_identity,destination_identity,inventory_digest,retained_batches,retained_records,fenced_batches,fenced_records,recovered_at)
   SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT source_identity FROM analytics_control WHERE singleton=1)=?
   AND (SELECT stopped FROM analytics_control WHERE singleton=1)=0 AND (SELECT COUNT(*) FROM analytics_batches)=?
   AND (SELECT COUNT(*) FROM analytics_active_batches)=? AND (SELECT COALESCE(MAX(completion_sequence),0) FROM analytics_active_batches)=?`).bind(id,result.previousIdentity,result.destinationIdentity,result.inventoryDigest,result.retainedBatches,result.retainedRecords,result.fencedBatches,result.fencedRecords,Date.now(),result.previousIdentity,result.physicalBatches,result.activeBatches,result.activeHighest),
  db.prepare('DELETE FROM analytics_active_batches WHERE EXISTS(SELECT 1 FROM analytics_recoveries WHERE id=?)').bind(id),
  db.prepare(`INSERT INTO analytics_active_batches SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.completionSequence') FROM json_each(?) j WHERE EXISTS(SELECT 1 FROM analytics_recoveries WHERE id=?)`).bind(inventory,id),
  db.prepare('UPDATE analytics_control SET source_identity=? WHERE singleton=1 AND EXISTS(SELECT 1 FROM analytics_recoveries WHERE id=?)').bind(result.destinationIdentity,id),
 ])
 const receipt=await db.prepare('SELECT * FROM analytics_recoveries WHERE id=?').bind(id).first()
 if(!receipt)fail('recovery_review_changed',409)
 return {...result,recoveredAt:receipt.recovered_at}
}
