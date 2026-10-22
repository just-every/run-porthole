import { fail, proofFence, type Authority } from '../security/authority'
import { historyColumns, type HistoryReference } from './model'

export function historyGuard(db: D1Database, actor: Authority, extra='1', args: unknown[]=[]): D1PreparedStatement {
 const proof=proofFence(actor)
 return db.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${proof.sql} AND ${extra} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...proof.args,...args)
}
export async function liveRead(db: D1Database, actor: Authority): Promise<void> {
 const result=await db.prepare(`SELECT (${actor.fence}) AS live`).bind(...actor.args).first<{live:number}>()
 if(!result?.live)fail('authority_changed',409)
}
export async function historyFor(db: D1Database, id: string): Promise<HistoryReference> {
 const row=await db.prepare(`SELECT ${historyColumns.join(',')} FROM porthole_bucket_history WHERE id=?`).bind(id).first<HistoryReference>()
 if(!row)fail('history_not_found',404)
 return row
}
export async function saveHistory(db: D1Database, actor: Authority, reference: HistoryReference): Promise<void> {
 await db.batch([historyGuard(db,actor),db.prepare(`INSERT INTO porthole_bucket_history(${historyColumns.join(',')}) VALUES(${historyColumns.map(()=>'?').join(',')})`).bind(...historyColumns.map(column=>reference[column as keyof HistoryReference]))])
}
export async function authorizeHistory(db: D1Database, actor: Authority, id: string): Promise<void> {
 await db.batch([historyGuard(db,actor,`EXISTS(SELECT 1 FROM porthole_bucket_history WHERE id=? AND state='quarantined')`,[id]),db.prepare(`UPDATE porthole_bucket_history SET state='active' WHERE id=? AND state='quarantined'`).bind(id)])
}
