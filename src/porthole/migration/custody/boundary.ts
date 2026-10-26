import {fail} from '../../security/authority'
import {custodyCatalog,omittedCustodyTables} from './catalog'
import {sourceBytes} from './documents'
import type {Row} from './rows'

/** The owner-session door currently creates version-three, nonstream jobs.
 * Other kit layouts retain custody in domains this edition has not qualified;
 * refusing is preferable to exporting only their visible native effects. */
export async function custodyBoundary(db:D1Database):Promise<string> {
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'ik_*' ORDER BY name").all<{name:string}>()).results
 const supported=new Set(custodyCatalog.map(item=>item.table))
 const unsupported=tables.filter(({name})=>!supported.has(name)&&!omittedCustodyTables.has(name))
 if(unsupported.some(({name})=>!/^ik_[a-z0-9_]+$/.test(name)))fail('migration_custody_domain_unsupported',409)
 const clauses=unsupported.map(({name})=>`NOT EXISTS(SELECT 1 FROM ${name})`)
 clauses.push("NOT EXISTS(SELECT 1 FROM ik_door_settings WHERE enabled!=0)","NOT EXISTS(SELECT 1 FROM ik_door_grants)","NOT EXISTS(SELECT 1 FROM ik_door_approvals WHERE reviewer!='operator')","NOT EXISTS(SELECT 1 FROM ik_jobs WHERE destination!='migration-evidence' OR principal_id!='role:owner')","NOT EXISTS(SELECT 1 FROM ik_original_sets WHERE version!=3)","NOT EXISTS(SELECT 1 FROM ik_originals WHERE bytes IS NOT NULL)","NOT EXISTS(SELECT 1 FROM ik_d1_original_chunks WHERE typeof(bytes)!='text')")
 const boundary=clauses.join(' AND ')
 if(!(await db.prepare(`SELECT (${boundary}) AS valid`).first<{valid:number}>())?.valid)fail('migration_custody_domain_unsupported',409)
 return boundary
}
// A later destination import erasure journal cannot be ignored while restoring
// old source snapshots. Opaque receipts require whole-archive refusal.
function conjunction(clauses:string[]):string {
 if(clauses.length===1)return clauses[0]
 const middle=Math.floor(clauses.length/2)
 return `(${conjunction(clauses.slice(0,middle))} AND ${conjunction(clauses.slice(middle))})`
}
// Balanced predicates keep the complete emptiness fence within D1's expression
// depth limit; no domain is dropped to make an old archive fit.
export const emptyCustody=conjunction(["NOT EXISTS(SELECT 1 FROM porthole_migration_custody)",...custodyCatalog.filter(item=>item.table!=='ik_door_approval_history').map(item=>`NOT EXISTS(SELECT 1 FROM ${item.table})`),"NOT EXISTS(SELECT 1 FROM ik_door_approvals)"])


/** Never copy credential-bearing upload bytes into an archive even temporarily.
 * The frozen snapshot is checked again so a concurrent upload cannot bypass it. */
export async function preflightSourceBytes(db:D1Database):Promise<void> {
 for(const [table,child,key]of [['ik_door_uploads','ik_door_chunks','upload_id'],['ik_door_archives','ik_door_archive_chunks','archive_id']]){
  for(let offset=0;;offset+=24){
   const page=(await db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT 24 OFFSET ?`).bind(offset).all<Row>()).results
   for(const header of page){
    const chunks=(await db.prepare(`SELECT ordinal,sha256,size,base64 FROM ${child} WHERE ${key}=? ORDER BY ordinal`).bind(header.id).all<Row>()).results
    if(chunks.length)sourceBytes(header,chunks)
   }
   if(page.length<24)break
  }
 }
}
