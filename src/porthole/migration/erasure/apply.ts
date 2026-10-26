import type {Bindings} from '../../../auth.server'
import type {D1Database as KitDatabase,D1ImportContext,D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {retireD1ImportCustody} from '../../../modules/import-kit/src/d1/index.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {fail} from '../../security/authority'
import {migrationTargets} from '../evidence/targets'
import {destination,fencedDatabase,inventory,selection,sql} from './inventory'
import {frozenArchiveWithdrawal} from './journal'

export async function applyErasure(env:Bindings,predicate:D1Sql,data:Record<string,unknown>) {
 if(Object.keys(data).sort().join(',')!=='confirm,digest,id,kind,revision'||data.confirm!=='erase-exact-import-target'||typeof data.digest!=='string'||!/^[a-f0-9]{64}$/.test(data.digest))fail('import_erasure_exact_approval_required',400)
 const target=selection(data),selectionDigest=sha256(canonicalJson(target))
 const prior=await env.DB.prepare('SELECT f.receipt_id,f.inventory_digest,f.erased_at,r.selection_digest FROM porthole_migration_erasure_replays r JOIN porthole_migration_erasure_fences f ON f.receipt_id=r.receipt_id WHERE r.inventory_digest=?').bind(data.digest).first<{receipt_id:string;inventory_digest:string;erased_at:number;selection_digest:string}>()
 if(prior){
  if(prior.selection_digest!==selectionDigest)fail('import_erasure_selection_changed',409)
  await env.DB.batch([env.DB.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('IMPORT_ERASURE_AUTHORITY_CHANGED') END`).bind(...predicate.params??[])])
  return {receiptId:prior.receipt_id,inventoryDigest:prior.inventory_digest,erasedAt:prior.erased_at,replayed:true,qualification:'partial-imported-target-only'}
 }
 const review=await inventory(env.DB,target)
 if(data.digest!==review.digest)fail('import_erasure_inventory_changed',409)
 const receiptId=crypto.randomUUID(),erasedAt=Date.now()
 const checkpoint=[
  ...frozenArchiveWithdrawal(),
  sql('DELETE FROM porthole_migration_custody'),
  sql('INSERT INTO porthole_migration_erasure_fences(receipt_id,inventory_digest,erased_at) VALUES(?,?,?)',receiptId,review.digest,erasedAt),
  sql('INSERT INTO porthole_migration_erasure_replays(inventory_digest,selection_digest,receipt_id) VALUES(?,?,?)',review.digest,selectionDigest,receiptId),
 ]
 const context:D1ImportContext={destination,namespace:'native-import-erasure',mappingVersion:'native-import-erasure-v1',
  originalErasurePolicy:'withdraw-affected-artifacts',
  storage:{database:fencedDatabase(env.DB,review.revision) as unknown as KitDatabase,targets:migrationTargets},
  authorization:{principalId:'role:owner',predicate:()=>predicate},
 }
 const result=await retireD1ImportCustody({target:{kind:target.kind,id:target.id}},migrationTargets.remove(destination,target.kind,target.id),context,checkpoint)
 return {receiptId,inventoryDigest:review.digest,erasedAt,erasedRecords:result.recordsErased,withdrawnInactiveUnits:review.withdrawnInactiveUnits.length,qualification:'partial-imported-target-only',limitations:review.limitations}
}
