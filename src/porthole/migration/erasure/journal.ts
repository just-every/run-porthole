import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {fail} from '../../security/authority'
import {emptyCustody} from '../custody/boundary'
import {sql} from './inventory'

export const journalFormat='porthole.import-erasure.v1'
export const journalColumns=['receipt_id','inventory_digest','erased_at']
export interface ImportErasureFence {receipt_id:string;inventory_digest:string;erased_at:number}
export function validateImportErasureFence(value:unknown):ImportErasureFence {
 const row=value as ImportErasureFence
 if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='erased_at,inventory_digest,receipt_id'||typeof row.receipt_id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.receipt_id)||typeof row.inventory_digest!=='string'||!/^[a-f0-9]{64}$/.test(row.inventory_digest)||!Number.isSafeInteger(row.erased_at)||row.erased_at<0||row.erased_at>Date.now())fail('invalid_import_erasure_journal',422)
 return row
}
export async function readJournal(db:D1Database):Promise<ImportErasureFence[]> {
 const rows=(await db.prepare('SELECT receipt_id,inventory_digest,erased_at FROM porthole_migration_erasure_fences ORDER BY receipt_id LIMIT 101').all<ImportErasureFence>()).results
 if(rows.length>100)fail('import_erasure_journal_requires_archive',409)
 return rows.map(validateImportErasureFence)
}
export const emptyMigration=`NOT EXISTS(SELECT 1 FROM porthole_migration_records) AND (${emptyCustody})`
export function frozenArchiveWithdrawal():D1Sql[] {return ['porthole_archive_chunks','porthole_archive_rows','porthole_archive_jobs'].map(table=>sql(`DELETE FROM ${table}`))}
export async function applyJournal(db:D1Database,predicate:D1Sql,data:Record<string,unknown>) {
 if(Object.keys(data).sort().join(',')!=='confirm,format,records'||data.confirm!=='apply-import-erasure-journal'||data.format!==journalFormat||!Array.isArray(data.records)||!data.records.length||data.records.length>100)fail('invalid_import_erasure_journal',400)
 const entries=data.records.map(validateImportErasureFence)
 if(new Set(entries.map(row=>row.receipt_id)).size!==entries.length)fail('invalid_import_erasure_journal',400)
 const held=await readJournal(db),missing=entries.filter(row=>!held.some(old=>old.receipt_id===row.receipt_id&&old.inventory_digest===row.inventory_digest&&old.erased_at===row.erased_at))
 if(entries.some(row=>held.some(old=>old.receipt_id===row.receipt_id&&(old.inventory_digest!==row.inventory_digest||old.erased_at!==row.erased_at))))fail('import_erasure_journal_conflict',409)
 const checks=[predicate,...missing.length?[sql(emptyMigration)]:[]]
 await db.batch([
  ...checks.map(row=>db.prepare(`SELECT CASE WHEN (${row.sql}) THEN 1 ELSE json('IMPORT_ERASURE_JOURNAL_REFUSED') END`).bind(...row.params??[])),
  ...missing.length?frozenArchiveWithdrawal().map(row=>db.prepare(row.sql)):[],
  ...missing.map(row=>db.prepare('INSERT INTO porthole_migration_erasure_fences(receipt_id,inventory_digest,erased_at) VALUES(?,?,?)').bind(row.receipt_id,row.inventory_digest,row.erased_at)),
  db.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('IMPORT_ERASURE_AUTHORITY_CHANGED') END`).bind(...predicate.params??[]),
 ])
 return {format:journalFormat,applied:missing.length,receiptIds:entries.map(row=>row.receipt_id)}
}
