import {canonical} from '../ingest/model'
import {attributes} from '../services/model'
import type {TraceRecord} from '../traces/graph'

export interface EvidenceRecord extends TraceRecord {event_time_ns?:string;payload:TraceRecord['payload']&{metric?:Record<string,unknown>;metricKind?:string}}
export const scopeKey=(r:{service:string;environment:string;team:string})=>canonical([r.service,r.environment,r.team])
const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=240?v:null
export function resourceIdentity(row:EvidenceRecord) {
 const r=attributes(row.payload.resource)
 return {containerId:text(r['container.id']),hostId:text(r['host.id']),brokerContainerId:text(r['porthole.messaging.broker.container.id']),scope:scopeKey(row)}
}
export const reference=(r:EvidenceRecord)=>({recordId:r.id,traceId:r.trace_id??null,spanId:r.span_id??null})
// Conflicting span identities and duplicate exported copies never become extra
// observations. The surrounding read applies scope before calling this code.
export function uniqueSpans(rows:EvidenceRecord[]) {
 const groups=new Map<string,Map<string,EvidenceRecord>>()
 for(const row of rows){const key=row.trace_id+':'+row.span_id,group=groups.get(key)??new Map();group.set(canonical({scope:scopeKey(row),payload:row.payload}),row);groups.set(key,group)}
 return [...groups.values()].filter(g=>g.size===1).map(g=>[...g.values()][0])
}
export function spanSummary(rows:EvidenceRecord[]) {
 const durations=rows.map(r=>BigInt(String(r.payload.record.endTimeUnixNano))-BigInt(String(r.payload.record.startTimeUnixNano))).sort((a,b)=>a<b?-1:a>b?1:0)
 const errors=rows.filter(r=>(r.payload.record.status as {code?:number}|undefined)?.code===2)
 const timeouts=errors.filter(r=>/timed?\s*out|timeout|ETIMEDOUT/i.test(canonical({attributes:attributes(r.payload.record),status:r.payload.record.status,events:r.payload.record.events})))
 return {observations:rows.length,failures:errors.length,timeouts:timeouts.length,p95Ns:durations.length?durations[Math.ceil(durations.length*.95)-1].toString():null,evidence:rows.map(reference)}
}
export interface MetricSeries {name:string;unit:string;kind:string;temporality:number|null;monotonic:boolean;attributes:Record<string,unknown>;resource:ReturnType<typeof resourceIdentity>;points:{at:string;start:string|null;value:number;reference:ReturnType<typeof reference>}[]}
export function metricSeries(rows:EvidenceRecord[]) {
 const groups=new Map<string,MetricSeries>()
 for(const row of rows){
  const m=row.payload.metric,p=row.payload.record,a=attributes(p),r=resourceIdentity(row)
  if(!m||!['gauge','sum'].includes(String(row.payload.metricKind))||Number(p.flags??0)&1)continue
  const value=Number(p.asDouble??p.asInt);if(!Number.isFinite(value))continue
  const sum=m.sum as {aggregationTemporality?:number;isMonotonic?:boolean}|undefined
  const entry:MetricSeries={name:String(m.name),unit:String(m.unit??''),kind:String(row.payload.metricKind),temporality:sum?.aggregationTemporality??null,monotonic:sum?.isMonotonic??false,attributes:a,resource:r,points:[]},key=canonical(entry)
  const series=groups.get(key)??entry
  const at=String(p.timeUnixNano),start=p.startTimeUnixNano?String(p.startTimeUnixNano):null
  if(!series.points.some(v=>v.at===at&&v.start===start&&v.value===value))series.points.push({at,start,value,reference:reference(row)})
  groups.set(key,series)
 }
 return [...groups.values()].map(s=>({...s,points:s.points.sort((a,b)=>BigInt(a.at)<BigInt(b.at)?-1:BigInt(a.at)>BigInt(b.at)?1:0)}))
}
export function measured(series:MetricSeries,through:string,complete:boolean) {
 const points=series.points,last=points.at(-1)!,ambiguous=points.some((p,i)=>i>0&&p.at===points[i-1].at&&p.value!==points[i-1].value)
 const stale=BigInt(through)-BigInt(last.at)>15000000000n
 let delta:number|null=null
 // Never subtract across a reset, a changed start time or an ambiguous sample.
 if(series.kind==='sum'&&series.monotonic&&series.temporality===2&&points.length>=2&&!ambiguous){
  const first=points[0]
  if(points.every((p,i)=>!i||(p.value>=points[i-1].value&&p.start===first.start)))delta=last.value-first.value
 }
 return {name:series.name,unit:series.unit,attributes:series.attributes,resource:series.resource,state:!complete?'partial':ambiguous?'ambiguous':stale?'stale':'observed',lastAtNs:last.at,value:ambiguous?null:last.value,delta:!complete||ambiguous?null:delta,evidence:points.map(p=>p.reference)}
}
const requirements=[
 ['tcp','namespace access and netstat collector','Authorize the affected container network namespace and restart the stock node exporter.'],
 ['container','Docker socket read access','Restore read access to the owned Docker socket for the stock docker_stats receiver.'],
 ['obi','BPF and PERFMON capabilities and supported kernel','Authorize BPF and PERFMON in the affected namespace; inspect the official OBI kernel diagnostics.'],
] as const
export function networkEvidence(spans:EvidenceRecord[],metrics:EvidenceRecord[],through:string,complete:boolean) {
 const unique=uniqueSpans(spans),series=metricSeries(metrics)
 return [...new Set(unique.map(scopeKey))].sort().map(key=>{
  const rows=unique.filter(r=>scopeKey(r)===key),identities=rows.map(resourceIdentity).filter(r=>r.containerId&&r.hostId)
  const matched=series.filter(s=>s.resource.scope===key&&s.resource.containerId&&s.resource.hostId&&identities.some(r=>r.containerId===s.resource.containerId&&r.hostId===s.resource.hostId))
  const counters=matched.filter(s=>s.name==='node_netstat_Tcp_RetransSegs'||s.name==='node_netstat_TcpExt_TCPTimeouts'||/^container\.network\..*(dropped|errors)/.test(s.name)).map(s=>measured(s,through,complete))
  const dns=rows.filter(r=>String(r.payload.scope?.name??'')==='@opentelemetry/instrumentation-dns')
  const connections=rows.filter(r=>String(r.payload.scope?.name??'')==='@opentelemetry/instrumentation-net')
  const flows=rows.filter(r=>/ebpf|obi/i.test(String(r.payload.scope?.name??'')))
  const gaps=requirements.flatMap(([source,privilege,nextAction])=>{
   const evidence=source==='tcp'?counters.filter(c=>c.name.startsWith('node_netstat_')):source==='container'?counters.filter(c=>c.name.startsWith('container.network.')):flows
   const fresh=evidence.length&&evidence.every(e=>!('state'in e)||e.state==='observed')
   return fresh?[]:[{source,state:evidence.length?'stale':'unknown',missing:privilege,nextAction,reason:identities.length?'No fresh correlated evidence; collection absence does not identify a denial by itself.':'Explicit container.id and host.id are required; name-only correlation is refused.'}]
  })
  return {key,identities:[...new Map(identities.map(r=>[canonical(r),r])).values()],dns:spanSummary(dns),connections:spanSummary(connections),counters,flows:flows.map(reference),gaps,fullTraffic:false}
 })
}
