import type {HealthBindings} from '../health/model'
import type {HealthState} from '../health/model'
import type {ObjectRow} from '../objects/http'
import {scopeWhere} from '../ingest/read'
import {fail,type Scope} from '../security/authority'
import {countWindows} from './counts'
import {monitorDefinition,dimensions,groupKey,ns,type Group,type Evaluation,type Completeness,type Status} from './model'
interface Collector {service:string;environment:string;team:string;observed_at:number;live:number}
export async function evaluateMonitor(env:HealthBindings,monitor:ObjectRow,health:HealthState,now=Date.now()):Promise<Evaluation> {
 const definition=monitorDefinition(JSON.parse(monitor.body)),scope=JSON.parse(monitor.scope) as Scope,where=scopeWhere(scope,'h')
 const last=await env.DB.prepare('SELECT result FROM porthole_monitor_runs WHERE object_id=? AND revision=? ORDER BY evaluated_at DESC,rowid DESC LIMIT 1').bind(monitor.id,monitor.revision).first<{result:string}>()
 const previous=last?JSON.parse(last.result) as Evaluation:null
 const old=await env.DB.prepare('SELECT last_known_count,last_known_at,firing_episode,revision FROM porthole_monitor_state WHERE object_id=?').bind(monitor.id).first<{last_known_count:number|null;last_known_at:number|null;firing_episode:string|null;revision:number}>()
 const collectors=(await env.DB.prepare(`SELECT h.service,h.environment,h.team,h.observed_at,CASE WHEN c.status='active' AND c.expires_at>? AND o.status='active' AND m.role IN ('owner','admin') AND o.role=m.role THEN 1 ELSE 0 END AS live FROM porthole_health_collectors h LEFT JOIN porthole_credentials c ON c.id=h.credential_id LEFT JOIN porthole_members m ON m.operator_id=c.custodian_id LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE h.signal=? AND ${where.sql} LIMIT 101`).bind(now,definition.signal,...where.args).all<Collector>()).results
 let measured:Awaited<ReturnType<typeof countWindows>>|undefined
 let unavailable=false
 try {measured=await countWindows(env,definition,scope,now)}catch{unavailable=true}
 const labels=new Map<string,Group['labels']>()
 const add=(value:Group['labels'])=>{const picked=Object.fromEntries(definition.groupBy.map(key=>[key,value[key]]));labels.set(groupKey(picked,definition.groupBy),picked)}
 for(const row of collectors)add(row)
 for(const window of measured?.windows??[])for(const row of window.labels)add(row)
 for(const row of previous?.groups??[])add(row.labels)
 if(!labels.size) {
  let explicit:Group['labels'][]=[{}]
  for(const key of definition.groupBy){const values=scope[({service:'services',environment:'environments',team:'teams'} as const)[key]];explicit=explicit.flatMap(label=>(values.includes('*')?['*']:values).map(value=>({...label,[key]:value})))}
  for(const row of explicit.slice(0,101))add(row)
 }
 const overflow=labels.size>100||collectors.length>100
 const groups:Group[]=[]
 for(const [key,label]of [...labels].slice(0,100)) {
  const prior=previous?.groups.find(row=>row.key===key),sources=collectors.filter(row=>definition.groupBy.every(dimension=>row[dimension]===label[dimension]))
  const live=sources.length>0&&sources.every(row=>row.live===1&&row.observed_at<=now&&now-row.observed_at<=health.configuration.freshnessSeconds*1000)
  let completeness:Completeness=unavailable?'unavailable':overflow?'incomplete':!sources.length?'absent':!live?'source-loss':measured?.uncertain?'uncertain-time':health.components.some(row=>['ingest','queue','storage','query'].includes(row.component)&&row.status!=='Healthy')?'incomplete':'measured'
  const groupScope={...scope}
  for(const dimension of definition.groupBy)groupScope[({service:'services',environment:'environments',team:'teams'} as const)[dimension]]=[label[dimension]!]
  const lossWhere=scopeWhere(groupScope)
  const loss=await env.DB.prepare(`SELECT 1 AS lost FROM porthole_ingest_events r WHERE r.kind IN ('source_loss','buffer_loss') AND r.signal=? AND (r.range_start_ns IS NULL OR r.range_end_ns IS NULL OR (r.range_start_ns<=? AND r.range_end_ns>=?)) AND ${lossWhere.sql} LIMIT 1`).bind(definition.signal,ns(now),ns(now-Math.max(...definition.windows)*1000),...lossWhere.args).first()
  if(loss&&!unavailable)completeness='source-loss'
  const windows=definition.windows.map(windowSeconds=>({windowSeconds,count:completeness==='measured'?(measured?.windows.find(window=>window.windowSeconds===windowSeconds)?.counts.get(key)??0):null,completeness}))
  const count=windows.find(window=>window.windowSeconds===definition.windowSeconds)!.count
  let status:Status='Unknown',pendingSince:number|null=null,episode=prior?.firingEpisode??(old?.revision===monitor.revision&&!definition.groupBy.length?old.firing_episode:null)??null
  if(completeness==='measured') {
   const breach=windows.every(window=>definition.operator==='above'?window.count!>definition.threshold:window.count!<definition.threshold)
   const recovered=windows.every(window=>definition.operator==='above'?window.count!<=definition.recoveryThreshold:window.count!>=definition.recoveryThreshold)
   if(episode&&!recovered)status='Firing'
   else if(breach){pendingSince=prior?.pendingSince??now;status=now-pendingSince>=definition.pendingSeconds*1000?'Firing':'Pending';if(status==='Firing')episode??=crypto.randomUUID()}
   else {status='Healthy';episode=null}
   if(status==='Healthy')episode=null
  } else if(completeness==='absent'&&definition.noDataPolicy==='alert'){status='NoData';episode??=crypto.randomUUID()}
  // An interrupted pending interval never counts as sustained measured breach.
  const reason=completeness==='measured'?`Observed ${count} ${definition.signal} records; all windows must breach, and all must reach recovery before resolving.`:completeness==='absent'?`No authenticated source has established input coverage. No-data policy: ${definition.noDataPolicy}.`:completeness==='source-loss'?'Recorded source or buffer loss, or stale or revoked source coverage; last-known state cannot resolve.':completeness==='unavailable'?'Analytical storage/query failed; previous firing state and count are last-known only.':completeness==='uncertain-time'?'Source clock uncertainty makes this window incomplete.':'Telemetry component coverage is incomplete.'
  groups.push({key,labels:label,status,count,lastKnownCount:count??prior?.lastKnownCount??null,pendingSince,firingEpisode:episode,completeness,windows,reason})
 }
 const unknown=overflow||groups.some(group=>!['measured','absent'].includes(group.completeness)||group.status==='Unknown'),status:Status=unknown?'Unknown':groups.some(group=>['Firing','NoData'].includes(group.status))?'Firing':groups.some(group=>group.status==='Pending')?'Pending':'Healthy'
 const count=groups.every(group=>group.count!==null)?groups.reduce((sum,group)=>sum+group.count!,0):null
 const result:Evaluation={monitorId:monitor.id,revision:monitor.revision,evaluatedAt:now,status,observedCount:count,lastKnownCount:count??previous?.lastKnownCount??(old?.revision===monitor.revision?old.last_known_count:null)??null,lastKnownAt:count!==null?now:previous?.lastKnownAt??(old?.revision===monitor.revision?old.last_known_at:null)??null,firingEpisode:status==='Healthy'?null:groups.find(group=>group.firingEpisode)?.firingEpisode??previous?.firingEpisode??null,reason:overflow?'Monitor grouping exceeds the bounded 100-group evaluation.':groups.map(group=>group.reason).filter((value,index,all)=>all.indexOf(value)===index).join(' '),groups,snapshot:measured?.snapshot??0}
 const id=crypto.randomUUID(),legacyStatus=status==='Pending'?'Unknown':status
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO porthole_monitor_runs SELECT ?,o.id,o.revision,?,? FROM porthole_objects o WHERE o.id=? AND o.revision=? AND o.state='active'`).bind(id,now,JSON.stringify(result),monitor.id,monitor.revision),
  env.DB.prepare(`INSERT INTO porthole_monitor_evaluations SELECT ?,object_id,revision,?,?,?, ?,?,?,? FROM porthole_monitor_runs WHERE id=?`).bind(id,now,ns(now-Math.max(...definition.windows)*1000),ns(now),legacyStatus,count,result.firingEpisode,result.reason,id),
  env.DB.prepare(`INSERT INTO porthole_monitor_state SELECT object_id,revision,?,evaluated_at,?,?,?,? FROM porthole_monitor_runs WHERE id=? ON CONFLICT(object_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,evaluated_at=excluded.evaluated_at,last_known_count=excluded.last_known_count,last_known_at=excluded.last_known_at,firing_episode=excluded.firing_episode,reason=excluded.reason WHERE excluded.evaluated_at>=evaluated_at`).bind(legacyStatus,result.lastKnownCount,result.lastKnownAt,result.firingEpisode,result.reason,id),
 ])
 if(!await env.DB.prepare('SELECT 1 FROM porthole_monitor_runs WHERE id=?').bind(id).first())fail('revision_or_authority_changed',409)
 return result
}
