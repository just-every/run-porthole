import {monitorMetric,type MetricSelection} from '../metrics/span-rules/monitor'
import {configuration as analyticalConfiguration,selected as analyticalSelected,query as analyticalQuery} from '../analytical/client'
import type { Scope } from '../security/authority'
import type { HealthBindings } from '../health/model'
import { observeHealth } from '../health/observe'
import { recordComponentReceipt } from '../health/receipts'
import { scopeWhere } from '../ingest/read'

interface Monitor {id:string;revision:number;scope:string;body:string}
interface Previous {revision:number;status:string;last_known_count:number|null;last_known_at:number|null;firing_episode:string|null}
interface Definition {signal:'logs'|'traces'|'metrics';operator:'above'|'below';threshold:number;windowSeconds:number;spanMetric?:MetricSelection}
const ns=(value:number)=>(BigInt(value)*1000000n).toString().padStart(20,'0')

/** Counts actual normalized records in the original event-time window. Unknown
 * retains the previous count and firing episode and never resolves an alert. */
export async function evaluateMonitors(env:HealthBindings) {
 const health=await observeHealth(env), now=Date.now(),analytical=await analyticalConfiguration(env)
 const separate=analyticalSelected(env,analytical)
 const inputs=health.components.filter(row=>['collector','ingest','queue','storage','query'].includes(row.component))
 const monitors=(await env.DB.prepare("SELECT id,revision,scope,body FROM porthole_objects WHERE kind='monitor' AND state='active' ORDER BY id LIMIT 101").all<Monitor>()).results
 const outcomes: Record<string,unknown>[]=[]
 for (const monitor of monitors.slice(0,100)) {
  const definition=JSON.parse(monitor.body) as Definition, scope=JSON.parse(monitor.scope) as Scope
  const where=scopeWhere(scope), from=ns(now-definition.windowSeconds*1000), through=ns(now)
  const previous=await env.DB.prepare('SELECT revision,status,last_known_count,last_known_at,firing_episode FROM porthole_monitor_state WHERE object_id=?').bind(monitor.id).first<Previous>()
  let status:'Healthy'|'Firing'|'Unknown'='Unknown', count:number|null=null, reason='Telemetry component coverage is incomplete.'
  let episode=previous?.revision===monitor.revision?previous.firing_episode:null
  try {
   const collectorScope=scopeWhere(scope,'h')
   const collectors=await env.DB.prepare(`SELECT COUNT(*) AS count,MIN(h.observed_at) AS oldest FROM porthole_health_collectors h JOIN porthole_credentials c ON c.id=h.credential_id JOIN porthole_members m ON m.operator_id=c.custodian_id JOIN oa_operators o ON o.id=m.operator_id
    WHERE h.signal=? AND ${collectorScope.sql} AND c.status='active' AND c.expires_at>? AND o.status='active' AND m.role IN ('owner','admin') AND o.role=m.role`).bind(definition.signal,...collectorScope.args,now).first<{count:number;oldest:number|null}>()
   const lost=await env.DB.prepare(`SELECT COUNT(*) AS count FROM porthole_ingest_events r WHERE r.kind IN ('source_loss','buffer_loss') AND r.signal=? AND (r.range_start_ns IS NULL OR r.range_end_ns IS NULL OR (r.range_start_ns<=? AND r.range_end_ns>=?)) AND ${where.sql}`).bind(definition.signal,through,from,...where.args).first<{count:number}>()
   const uncertain=separate?await analyticalQuery(env,analytical,{signal:definition.signal,scope,from,through,mode:'count',uncertain:true}):await env.DB.prepare(`SELECT COUNT(*) AS count FROM porthole_telemetry_records r WHERE r.signal=? AND json_extract(r.payload,'$.delivery.uncertainTime')=1 AND printf('%020d',CAST(json_extract(r.payload,'$.delivery.receivedTimeUnixNano') AS INTEGER)) BETWEEN ? AND ? AND ${where.sql}`).bind(definition.signal,from,through,...where.args).first<{count:number}>()
   const result=separate?await analyticalQuery(env,analytical,{signal:definition.signal,scope,from,through,mode:'count'}):await env.DB.prepare(`SELECT COUNT(*) AS count FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.state='complete' AND r.signal=? AND r.event_time_ns>=? AND r.event_time_ns<=? AND ${where.sql}`).bind(definition.signal,from,through,...where.args).first<{count:number}>()
   const custom=definition.spanMetric?await monitorMetric(env,definition.spanMetric,scope,from,through):null
   const freshCollector=!!collectors?.count && collectors.oldest!==null && now-collectors.oldest<=health.configuration.freshnessSeconds*1000
   if(custom){
    if(!custom.complete||custom.value===null){reason='Custom metric input is incomplete; no RED aggregate is substituted.'}
    else {count=custom.value;const firing=definition.operator==='above'?count>definition.threshold:count<definition.threshold;status=firing?'Firing':'Healthy';reason=`Observed custom rule ${definition.spanMetric!.id} revision ${definition.spanMetric!.revision} ${definition.spanMetric!.aggregation} = ${count}; accepted input only, upstream ${custom.upstream}.`;episode=firing?(episode??crypto.randomUUID()):null}
   } else if (inputs.some(row=>row.status!=='Healthy') || !freshCollector || lost?.count || uncertain?.count || !result) {
    reason=uncertain?.count?'Source clock uncertainty makes this window incomplete.':lost?.count?'Recorded source or buffer loss makes this window incomplete.':!freshCollector?'No fresh authenticated collector covers this monitor scope.':'Telemetry component coverage is incomplete.'
   } else {
    count=result.count
    const firing=definition.operator==='above'?count>definition.threshold:count<definition.threshold
    status=firing?'Firing':'Healthy';reason=`Observed ${count} ${definition.signal} records in the original event-time window.`
    episode=firing?(episode??crypto.randomUUID()):null
   }
  } catch { reason='Analytical storage/query failed; previous firing state and count are last-known only.' }
  const evaluationId=crypto.randomUUID()
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO porthole_monitor_evaluations(id,object_id,revision,evaluated_at,window_start_ns,window_end_ns,status,observed_count,firing_episode,reason)
    SELECT ?,o.id,o.revision,?,?,?,?,?,CASE WHEN ?='Healthy' THEN NULL ELSE COALESCE((SELECT firing_episode FROM porthole_monitor_state WHERE object_id=o.id AND revision=o.revision),?) END,? FROM porthole_objects o WHERE o.id=? AND o.revision=? AND o.state='active'`).bind(evaluationId,now,from,through,status,count,status,episode,reason,monitor.id,monitor.revision),
   env.DB.prepare(`INSERT INTO porthole_monitor_state(object_id,revision,status,evaluated_at,last_known_count,last_known_at,firing_episode,reason)
    SELECT object_id,revision,status,evaluated_at,observed_count,CASE WHEN observed_count IS NULL THEN NULL ELSE evaluated_at END,firing_episode,reason FROM porthole_monitor_evaluations WHERE id=?
    ON CONFLICT(object_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,evaluated_at=excluded.evaluated_at,
    last_known_count=CASE WHEN excluded.revision!=revision THEN excluded.last_known_count ELSE COALESCE(excluded.last_known_count,last_known_count) END,
    last_known_at=CASE WHEN excluded.revision!=revision THEN excluded.last_known_at ELSE COALESCE(excluded.last_known_at,last_known_at) END,
    firing_episode=excluded.firing_episode,reason=excluded.reason WHERE excluded.evaluated_at>=evaluated_at`).bind(evaluationId),
  ])
  const persisted=await env.DB.prepare('SELECT revision,status,last_known_count,last_known_at,firing_episode FROM porthole_monitor_state WHERE object_id=?').bind(monitor.id).first<Previous>()
  if (persisted?.revision!==monitor.revision) {outcomes.push({monitorId:monitor.id,revision:monitor.revision,status:'Unknown',reason:'Monitor revision changed before the evaluation committed.'});continue}
  outcomes.push({monitorId:monitor.id,revision:monitor.revision,status,observedCount:count,lastKnownCount:persisted?.last_known_count??null,lastKnownAt:persisted?.last_known_at??null,firingEpisode:persisted?.firing_episode??null,reason})
 }
 const complete=monitors.length>0 && monitors.length<=100 && outcomes.every(row=>row.status!=='Unknown')
 await recordComponentReceipt(env.DB,{component:'monitor-evaluation',source:'monitor-worker',status:complete?'Healthy':'Unknown',reason:!monitors.length?'Not configured: no active count monitors.':monitors.length>100?'Monitor evaluation coverage exceeds the bounded 100-monitor pass.':complete?'Active count monitors evaluated against real retained records.':'One or more monitors have incomplete telemetry coverage; firing episodes remain unresolved.',evidence:{evaluatedAt:new Date(now).toISOString(),monitors:outcomes,limit:100}})
 return {evaluated:outcomes.length,complete,monitors:outcomes}
}
