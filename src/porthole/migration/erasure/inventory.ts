import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {fail} from '../../security/authority'
import {custodyBoundary} from '../custody/boundary'

export const destination='migration-evidence',installationId='porthole-migration-v1'
export interface Selection {kind:string;id:string;revision:string}
export const sql=(sql:string,...params:unknown[]):D1Sql=>({sql,params})
export function selection(data:Record<string,unknown>):Selection {
 for(const key of ['kind','id','revision'])if(typeof data[key]!=='string'||!data[key]||String(data[key]).length>256||/[\u0000-\u001f\u007f]/.test(String(data[key])))fail('invalid_import_erasure_selection',400)
 return {kind:data.kind as string,id:data.id as string,revision:data.revision as string}
}
export const limitations=[
 'Local imported-target erasure only; this is not general subject erasure.',
 'The selected native record and every source copy in its authenticated import lineage are erased. Unrelated native review edits remain.',
 'Complete affected original artifacts and all opaque upload, plan-snapshot and door-archive bodies for this destination are withdrawn, including bytes of other source records.',
 'All restored inactive import-custody units are withdrawn whole. Their native peer records remain, but their source history is unavailable.',
 'All frozen product archive jobs are invalidated. Downloaded older archives require the later journal and are refused whole; no external archive or source vendor is deleted.',
]
export async function inventory(db:D1Database,target:Selection) {
 const start=await db.prepare('SELECT revision FROM porthole_migration_erasure_state WHERE singleton=1').first<{revision:number}>()
 if(!start||!Number.isSafeInteger(start.revision))fail('import_erasure_inventory_unavailable',503)
 await custodyBoundary(db)
 const scoped=await db.prepare("SELECT NOT EXISTS(SELECT 1 FROM ik_door_scopes WHERE installation_id!=? OR destination!=?) AND NOT EXISTS(SELECT 1 FROM ik_door_plans WHERE installation_id!=?) AND NOT EXISTS(SELECT 1 FROM ik_door_uploads WHERE installation_id!=?) AND NOT EXISTS(SELECT 1 FROM ik_door_archives WHERE installation_id!=?) AS valid").bind(installationId,destination,installationId,installationId,installationId).first<{valid:number}>()
 if(!scoped?.valid)fail('import_erasure_custody_scope_unsupported',409)
 const native=await db.prepare('SELECT body,revision FROM porthole_migration_records WHERE kind=? AND id=?').bind(target.kind,target.id).first<{body:string;revision:string}>()
 if(!native)fail('import_erasure_target_not_found',404)
 if(native.revision!==target.revision)fail('import_erasure_revision_changed',409)
 // A full custody census is reviewed, including zero-effect catch-up copies.
 // The epoch binds the exact contents, not merely these row and byte totals.
 const stores=await db.prepare("SELECT m.name,group_concat(p.name,',') AS columns FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND (m.name GLOB 'ik_*' OR m.name IN ('porthole_migration_custody','porthole_archive_jobs','porthole_archive_rows','porthole_archive_chunks')) AND m.name NOT IN ('ik_d1_assertions','ik_d1_erasure_tally') GROUP BY m.name ORDER BY m.name").all<{name:string;columns:string}>()
 const census=[]
 for(const store of stores.results){
  if(!/^[a-z0-9_]+$/.test(store.name)||store.columns.split(',').some(name=>!/^[_a-z0-9]+$/.test(name)))fail('import_erasure_inventory_unavailable',503)
  const row=await db.prepare(`SELECT COUNT(*) AS rows,COALESCE(SUM(length(CAST(json_array(${store.columns.split(',').map(name=>`CASE WHEN typeof("${name}")='blob' THEN hex("${name}") ELSE "${name}" END`).join(',')}) AS BLOB))),0) AS bytes FROM ${store.name}`).first<{rows:number;bytes:number}>()
  if(row?.rows)census.push({store:store.name,...row})
 }
 const units=(await db.prepare('SELECT stream,COUNT(*) AS rows FROM porthole_migration_custody GROUP BY stream ORDER BY stream').all<{stream:string;rows:number}>()).results
 const epoch=await db.prepare('SELECT revision FROM porthole_migration_erasure_state WHERE singleton=1').first<{revision:number}>()
 if(epoch?.revision!==start.revision)fail('import_erasure_inventory_changed',409)
 const body={target,contentDigest:sha256(native.body),revision:start.revision,custodyReviewed:census,withdrawnInactiveUnits:units,limitations}
 return {...body,digest:sha256(canonicalJson(body)),canApply:true as const}
}

/** Prepend the owner's inventory fence before the kit withdraws door content.
 * Checking it in nativeStatements would run after those withdrawals. Return
 * offsets stay identical to the library's batch contract. */
export function fencedDatabase(db:D1Database,revision:number) {
 return {
  prepare:(query:string)=>db.prepare(query),
  async batch(statements:D1PreparedStatement[]){
   const fence=db.prepare("SELECT CASE WHEN (SELECT revision FROM porthole_migration_erasure_state WHERE singleton=1)=? THEN 1 ELSE json('IMPORT_ERASURE_INVENTORY_CHANGED') END").bind(revision)
   return (await db.batch([fence,...statements])).slice(1)
  },
 }
}
