import { components, iso, type Component, type HealthBindings, type HealthComponent, type HealthState, type ReceiptRow } from './model'
import { healthConfiguration, healthReceipts, recordComponentReceipt } from './receipts'

const max = (values: (number | null)[]) => values.reduce<number | null>((a,b) => b === null ? a : a === null ? b : Math.max(a,b),null)
const latest = (rows: ReceiptRow[], component: Component) => rows.filter(row => row.component === component).sort((a,b) => b.observed_at-a.observed_at)[0]
export function transportState(env: HealthBindings) {
 if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1') return 'Development mail is suppressed.'
 return env.MAIL_PROVIDER==='resend' && env.MAIL_API_KEY && env.MAIL_FROM ? 'Installation Resend transport configured independently of analytical storage; acceptance is not mailbox delivery.' : 'Configure installation MAIL_PROVIDER=resend, MAIL_API_KEY and MAIL_FROM.'
}

/** Uses only the authenticated control-plane store. Every backend read can fail
 * independently; durable earlier evidence stays visible with Unknown status. */
export async function observeHealth(env: HealthBindings): Promise<HealthState> {
 const config = await healthConfiguration(env.DB), now = Date.now(), checkedAt = new Date(now).toISOString()
 const control = await env.DB.prepare('SELECT paused FROM porthole_ingest_control WHERE singleton=1').first<{paused:number}>().catch(()=>null)
 const fresh = (value: number | null) => value !== null && value <= now && now-value <= config.freshness_ms
 const observe = async (component: Component, action: () => Promise<{status:'Healthy'|'Unknown';reason:string;lastAcceptedAt?:number|null;lastQueryableAt?:number|null;evidence?:Record<string,unknown>}>) => {
  try { await recordComponentReceipt(env.DB,{component,source:'control-observer',...await action(),freshnessMs:config.freshness_ms}) }
  catch { await recordComponentReceipt(env.DB,{component,source:'control-observer',status:'Unknown',reason:'Component observation failed; earlier evidence is last-known only.',freshnessMs:config.freshness_ms}) }
 }
 await Promise.all([
  observe('control-plane', async () => {
   const row = await env.DB.prepare('SELECT 1 AS ready').first<{ready:number}>()
   return {status:row?.ready===1?'Healthy':'Unknown',reason:row?.ready===1?'Authenticated request and control-plane database answered.':'Control-plane database unavailable.'}
  }),
  observe('collector', async () => {
   const rows = (await env.DB.prepare(`SELECT h.collector_id,h.signal,h.team,h.service,h.environment,h.observed_at,
    CASE WHEN c.status='active' AND c.expires_at>? AND o.status='active' AND m.role IN ('owner','admin') AND o.role=m.role THEN 1 ELSE 0 END AS live
    FROM porthole_health_collectors h JOIN porthole_credentials c ON c.id=h.credential_id
    JOIN porthole_members m ON m.operator_id=c.custodian_id JOIN oa_operators o ON o.id=m.operator_id
    ORDER BY h.observed_at DESC LIMIT 101`).bind(now).all<{collector_id:string;signal:string;team:string;service:string;environment:string;observed_at:number;live:number}>()).results
   const healthy = rows.length>0 && rows.length<=100 && rows.every(row => row.live===1 && fresh(row.observed_at))
   return {status:healthy?'Healthy':'Unknown',reason:!rows.length?'Not configured: no authenticated collector heartbeat.':healthy?'All registered collector heartbeats are fresh.':'Collector heartbeat stale, revoked, or coverage exceeds the inspected 100 collectors.',evidence:{collectors:rows.slice(0,100).map(row => ({id:row.collector_id,signal:row.signal,team:row.team,service:row.service,environment:row.environment,lastHeartbeatAt:iso(row.observed_at),status:row.live&&fresh(row.observed_at)?'Healthy':'Unknown'}))}}
  }),
  observe('ingest', async () => {
   const row = await env.DB.prepare('SELECT MAX(accepted_at) AS accepted FROM porthole_ingest_batches').first<{accepted:number|null}>()
   return {status:fresh(row?.accepted??null)?'Healthy':'Unknown',reason:row?.accepted==null?'Not configured: no accepted telemetry envelope.':fresh(row.accepted)?'Recent envelope durably accepted.':'Accepted telemetry is stale; intake coverage is incomplete.',lastAcceptedAt:row?.accepted}
  }),
  observe('storage', async () => {
   const row = await env.DB.prepare('SELECT MAX(indexed_at) AS queryable,(SELECT MAX(archived_at) FROM porthole_telemetry_archive) AS archived FROM porthole_telemetry_records').first<{queryable:number|null;archived:number|null}>()
   const recent = fresh(row?.queryable??null)
   return {status:recent?'Healthy':'Unknown',reason:recent?'Indexed storage answered with recent real records.':'Storage has no fresh indexed records; retained evidence is last-known only.',lastQueryableAt:row?.queryable,evidence:{lastArchivedAt:iso(row?.archived)}}
  }),
  observe('query', async () => {
   const rows = (await env.DB.prepare('SELECT signal,team,service,environment,event_time_ns,indexed_at FROM porthole_telemetry_records ORDER BY indexed_at DESC,id DESC LIMIT 5').all<{signal:string;team:string;service:string;environment:string;event_time_ns:string;indexed_at:number}>()).results
   const queryable = max(rows.map(row => row.indexed_at))
   return {status:fresh(queryable)?'Healthy':'Unknown',reason:fresh(queryable)?'Real indexed telemetry query answered with fresh records.':'No fresh queryable telemetry; last-known data does not establish current health.',lastQueryableAt:queryable,evidence:{lastKnown:rows.map(row => ({signal:row.signal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.event_time_ns,indexedAt:iso(row.indexed_at)}))}}
  }),
 ])
 const receipts = await healthReceipts(env.DB), evaluatedAt=Date.now()
 const rows: HealthComponent[] = []
 for (const component of components) {
  const row = latest(receipts,component)
  let status = row?.status??'Unknown', reason = row?.reason??'Not configured: no independent fresh product receipt.'
  if (component!=='control-plane' && control?.paused) {status='Unknown';reason='Collection is paused; retained data is last-known only.'}
  if (row && (row.expires_at<evaluatedAt || row.observed_at+config.freshness_ms<evaluatedAt || row.observed_at>evaluatedAt)) { status='Unknown';reason='Component receipt is stale; earlier evidence is last-known only.' }
  let evidence: Record<string,unknown> = row ? JSON.parse(row.evidence) as Record<string,unknown> : {}
  if (component === 'queue') {
   try {
    const queue = await env.DB.prepare(`SELECT COUNT(*) AS pending,MIN(accepted_at) AS oldest,COALESCE(SUM(byte_count),0) AS bytes,(SELECT paused FROM porthole_ingest_control WHERE singleton=1) AS paused FROM porthole_ingest_batches WHERE state='pending'`).first<{pending:number;oldest:number|null;bytes:number;paused:number}>()
    evidence = {...evidence,pendingBatches:queue?.pending??null,pendingBytes:queue?.bytes??null,oldestAcceptedAt:iso(queue?.oldest),paused:queue?.paused===1}
    if (queue?.paused || queue?.oldest && !fresh(queue.oldest)) {status='Unknown';reason=queue?.paused?'Durable ingest drain is paused.':'Pending ingest exceeds the freshness window.'}
   } catch {status='Unknown';reason='Durable ingest queue could not be read.'}
  }
  if (component === 'delivery' && (!config.notices_enabled || env.AUTH_LOCAL==='true' || env.RER_DEMO==='1' || env.MAIL_PROVIDER!=='resend' || !env.MAIL_API_KEY || !env.MAIL_FROM)) {status='Unknown';reason=config.notices_enabled?transportState(env):'Independent failure notices are disabled until the owner explicitly configures them.'}
  rows.push({component,status,reason,checkedAt,observedAt:iso(row?.observed_at),lastAcceptedAt:iso(max(receipts.filter(r=>r.component===component).map(r=>r.last_accepted_at))),lastQueryableAt:iso(max(receipts.filter(r=>r.component===component).map(r=>r.last_queryable_at))),evidence})
 }
 return {version:2,status:rows.every(row=>row.status==='Healthy')?'Healthy':'Unknown',checkedAt,lastAcceptedAt:iso(max(receipts.map(row=>row.last_accepted_at))),lastQueryableAt:iso(max(receipts.map(row=>row.last_queryable_at))),components:rows,configuration:{revision:config.revision,freshnessSeconds:config.freshness_ms/1000,noticesEnabled:config.notices_enabled===1,recipient:config.recipient,transport:transportState(env)}}
}
