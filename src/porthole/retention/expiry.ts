import type {Bindings} from '../../auth.server'
import {append} from '../audit/store'
import {appendJournal,eraseJournaledBatches,invalidateArchives,type ErasedBatch} from '../privacy/erasure/journal'
import {syncErasure} from '../analytical/erasure'
const interval=3600000
interface Schedule {policy_id:string;policy_revision:number;owner_ref:string;owner_revision:number;owner_version:number;next_run_at:number;days:number;selection:string}
export const liveSchedule=`EXISTS(SELECT 1 FROM porthole_retention_schedules s JOIN porthole_retention_policies p ON p.id=s.policy_id JOIN porthole_members m ON m.operator_id=s.owner_ref JOIN oa_operators o ON o.id=m.operator_id WHERE s.policy_id=? AND s.policy_revision=? AND s.next_run_at=? AND p.active=1 AND p.revision=s.policy_revision AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=s.owner_revision AND o.version=s.owner_version)`
/** The caller supplies the clock; production passes the scheduler's current
 * instant. Only an exact live owner grant can move a scheduled cutoff. */
export async function expireRetention(env:Bindings,now=Date.now()) {
 const schedules=(await env.DB.prepare(`SELECT s.*,p.days,p.selection FROM porthole_retention_schedules s JOIN porthole_retention_policies p ON p.id=s.policy_id WHERE s.next_run_at<=? ORDER BY s.next_run_at LIMIT 10`).bind(now).all<Schedule>()).results
 const runs=[]
 for(const schedule of schedules) {
  const args=[schedule.policy_id,schedule.policy_revision,schedule.next_run_at]
  if(!await env.DB.prepare(`SELECT 1 WHERE ${liveSchedule}`).bind(...args).first())continue
  const selection=JSON.parse(schedule.selection),cutoff=String(BigInt(now-schedule.days*86400000)*1000000n).padStart(20,'0')
  const predicate=`b.signal=? AND (?='*' OR json_extract(j.value,'$.service')=?) AND (?='*' OR json_extract(j.value,'$.team')=?) AND json_extract(j.value,'$.eventTimeNs')<? AND j.type='object'`
  const selected=[selection.signal,selection.service,selection.service,selection.team,selection.team,cutoff]
  const matches=(await env.DB.prepare(`SELECT b.id,b.digest,json_group_array(CAST(j.key AS INTEGER)) AS ordinals FROM porthole_ingest_batches b,json_each(b.records) j WHERE ${predicate} GROUP BY b.id ORDER BY b.id LIMIT 101`).bind(...selected).all<{id:string;digest:string;ordinals:string}>()).results
  // Drain a large due inventory in bounded passes without postponing the
  // remaining history for another retention interval.
  const pending=matches.length>100
  const journal:ErasedBatch[]=matches.slice(0,100).map(row=>({id:row.id,content_digest:row.digest,ordinals:JSON.parse(row.ordinals),erased_at:now})),id=crypto.randomUUID(),count=journal.reduce((n,row)=>n+row.ordinals!.length,0)
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${liveSchedule} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...args),
   ...appendJournal(env.DB,journal),
   ...(matches.length?[...invalidateArchives(env.DB),...eraseJournaledBatches(env.DB)]:[]),
   env.DB.prepare('INSERT INTO porthole_retention_runs(id,policy_id,policy_revision,started_at,cutoff_ns,erased_records) VALUES(?,?,?,?,?,?)').bind(id,schedule.policy_id,schedule.policy_revision,now,cutoff,count),
   env.DB.prepare('UPDATE porthole_retention_schedules SET next_run_at=? WHERE policy_id=?').bind(pending?schedule.next_run_at:now+interval,schedule.policy_id),
  ])
  await append(env.DB,{operationRef:id,actorRef:schedule.owner_ref,actorRevision:schedule.owner_revision,action:'retention.expire',entityRef:schedule.policy_id,revision:schedule.policy_revision,phase:'committed',status:200,occurredAt:now})
  runs.push({id,erasedRecords:count,pending})
 }
 return {runs,custody:await syncErasure(env)}
}
