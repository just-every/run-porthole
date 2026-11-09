import {canonical} from '../ingest/model'
import {attributes} from '../services/model'
import type {TraceRecord} from '../traces/graph'

export interface EvidenceRecord extends TraceRecord {event_time_ns?:string;payload:TraceRecord['payload']&{metric?:Record<string,unknown>;metricKind?:string}}
export const scopeKey=(r:{service:string;environment:string;team:string})=>canonical([r.service,r.environment,r.team])
const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=240&&!v.includes('[REDACTED]')?v:null
export function resourceIdentity(row:EvidenceRecord) {
 const r=attributes(row.payload.resource)
 return {containerId:text(r['container.id']),hostId:text(r['host.id']),brokerContainerId:text(r['porthole.messaging.broker.container.id']),scope:scopeKey(row)}
}
export const reference=(r:EvidenceRecord)=>({recordId:r.id,traceId:r.trace_id??null,spanId:r.span_id??null})
// Conflicting span identities and duplicate exported copies never become extra
// observations. The surrounding read applies scope before calling this code.
export function uniqueSpans(rows:EvidenceRecord[]) {
 const groups=new Map<string,Map<string,EvidenceRecord>>()
 for(const row of rows){const key=row.trace_id+':'+row.span_id,group=groups.get(key)??new Map();group.set(canonical({scope:scopeKey(row),record:row.payload.record,resource:row.payload.resource??{},instrumentation:row.payload.scope??{}}),row);groups.set(key,group)}
 return [...groups.values()].filter(g=>g.size===1).map(g=>[...g.values()][0])
}
export function spanSummary(rows:EvidenceRecord[]) {
 const durations=rows.map(r=>BigInt(String(r.payload.record.endTimeUnixNano))-BigInt(String(r.payload.record.startTimeUnixNano))).sort((a,b)=>a<b?-1:a>b?1:0)
 const errors=rows.filter(r=>(r.payload.record.status as {code?:number}|undefined)?.code===2)
 const timeouts=errors.filter(r=>/timed?\s*out|timeout|ETIMEDOUT/i.test(canonical({attributes:attributes(r.payload.record),status:r.payload.record.status,events:r.payload.record.events})))
 return {state:rows.length?'observed':'unknown',observations:rows.length,failures:errors.length,timeouts:timeouts.length,p95Ns:durations.length?durations[Math.ceil(durations.length*.95)-1].toString():null,evidence:rows.map(reference)}
}
export interface MetricSeries {instrumentation:string;name:string;unit:string;kind:string;temporality:number|null;monotonic:boolean;attributes:Record<string,unknown>;resource:ReturnType<typeof resourceIdentity>;points:{at:string;start:string|null;value:number;reference:ReturnType<typeof reference>}[]}
export function metricSeries(rows:EvidenceRecord[]) {
 const groups=new Map<string,MetricSeries>()
 for(const row of rows){
  const m=row.payload.metric,p=row.payload.record,resource=attributes(row.payload.resource),a={...Object.fromEntries(['rabbitmq.queue.name','rabbitmq.vhost.name'].filter(k=>resource[k]!==undefined).map(k=>[k,resource[k]])),...attributes(p)},r=resourceIdentity(row)
  if(!m||!['gauge','sum'].includes(String(row.payload.metricKind))||Number(p.flags??0)&1)continue
  const value=Number(p.asDouble??p.asInt);if(!Number.isFinite(value)||(p.asInt!==undefined&&!Number.isSafeInteger(value)))continue
  const sum=m.sum as {aggregationTemporality?:number;isMonotonic?:boolean}|undefined
  const entry:MetricSeries={instrumentation:String(row.payload.scope?.name??''),name:String(m.name),unit:String(m.unit??''),kind:String(row.payload.metricKind),temporality:sum?.aggregationTemporality??null,monotonic:sum?.isMonotonic??false,attributes:a,resource:r,points:[]},key=canonical(entry)
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
 // node_exporter exposes these documented cumulative kernel counters as untyped
 // Prometheus values; their declared names carry the counter semantics.
 if(((series.kind==='sum'&&series.monotonic&&series.temporality===2)||/^node_netstat_(Tcp_RetransSegs|TcpExt_TCPTimeouts)$/.test(series.name))&&points.length>=2&&!ambiguous){
  const first=points[0]
  if(points.every((p,i)=>!i||(p.value>=points[i-1].value&&p.start===first.start)))delta=last.value-first.value
 }
 return {name:series.name,unit:series.unit,attributes:series.attributes,resource:series.resource,state:!complete?'partial':ambiguous?'ambiguous':stale?'stale':'observed',firstAtNs:points[0].at,lastAtNs:last.at,value:ambiguous?null:last.value,delta:!complete||ambiguous?null:delta,evidence:points.map(p=>p.reference)}
}
const requirements=[
 ['tcp','namespace access and netstat collector','Authorize the affected container network namespace and restart the stock node exporter.'],
 ['container','Docker socket read access','Restore read access to the owned Docker socket for the stock docker_stats receiver.'],
 ['obi','BPF and PERFMON capabilities and supported kernel','Authorize BPF and PERFMON in the affected namespace; inspect the official OBI kernel diagnostics.'],
] as const
export function dependencyEvidence(rows:EvidenceRecord[],counters:ReturnType<typeof measured>[]) {
 const peerMap=new Map<string,EvidenceRecord[]>()
 for(const r of rows)if(Number(r.payload.record.kind)===2&&typeof r.payload.record.parentSpanId==='string'){const key=r.trace_id+':'+r.payload.record.parentSpanId,peers=peerMap.get(key)??[];peers.push(r);peerMap.set(key,peers)}
 const byId=new Map(rows.map(r=>[r.trace_id+':'+r.span_id,r])),groups=new Map<string,{from:string;to:string|null;source:ReturnType<typeof resourceIdentity>;target:ReturnType<typeof resourceIdentity>|null;dns:EvidenceRecord[];connections:EvidenceRecord[]}>()
 for(const row of rows) {
  const type=String(row.payload.scope?.name??'')
  if(!['@opentelemetry/instrumentation-dns','@opentelemetry/instrumentation-net'].includes(type))continue
  const source=resourceIdentity(row)
  let parent:EvidenceRecord|undefined=row,client:EvidenceRecord|undefined
  const seen=new Set<string>()
  while(parent&&!seen.has(parent.span_id)) {
   seen.add(parent.span_id)
   const ancestor=resourceIdentity(parent)
   if(ancestor.scope!==source.scope||ancestor.containerId!==source.containerId||ancestor.hostId!==source.hostId)break
   if(Number(parent.payload.record.kind)===3&&parent.payload.scope?.name==='@opentelemetry/instrumentation-http'){client=parent;break}
   parent=typeof parent.payload.record.parentSpanId==='string'?byId.get(parent.trace_id+':'+parent.payload.record.parentSpanId):undefined
  }
  const peers=client?peerMap.get(client.trace_id+':'+client.span_id)??[]:[]
  const peer=peers.length===1?peers[0]:undefined,target=peer?resourceIdentity(peer):null
  const resolved=!!source.containerId&&!!source.hostId&&!!target?.containerId&&!!target.hostId
  const group={from:scopeKey(row),to:resolved&&peer?scopeKey(peer):null,source,target:resolved?target:null,dns:[],connections:[]},key=canonical(group)
  const entry=groups.get(key)??group
  if(type==='@opentelemetry/instrumentation-dns')entry.dns.push(row);else entry.connections.push(row)
  groups.set(key,entry)
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([,g])=>({...g,dns:spanSummary(g.dns),connections:spanSummary(g.connections),counterScope:'source network namespace; not an individual edge loss rate',counters:counters.filter(c=>c.resource.containerId===g.source.containerId&&c.resource.hostId===g.source.hostId)}))
}
export function networkEvidence(spans:EvidenceRecord[],metrics:EvidenceRecord[],through:string,complete:boolean) {
 const unique=uniqueSpans(spans),series=metricSeries(metrics)
 return [...new Set(unique.map(scopeKey))].sort().map(key=>{
  const rows=unique.filter(r=>scopeKey(r)===key),identities=rows.map(resourceIdentity).filter(r=>r.containerId&&r.hostId)
  const matched=series.filter(s=>s.resource.scope===key&&s.resource.containerId&&s.resource.hostId&&identities.some(r=>r.containerId===s.resource.containerId&&r.hostId===s.resource.hostId))
  const counters=matched.filter(s=>s.name==='node_netstat_Tcp_RetransSegs'||s.name==='node_netstat_TcpExt_TCPTimeouts'||/^container\.network\..*(dropped|errors)/.test(s.name)).map(s=>measured(s,through,complete))
  const dns=rows.filter(r=>String(r.payload.scope?.name??'')==='@opentelemetry/instrumentation-dns')
  const connections=rows.filter(r=>String(r.payload.scope?.name??'')==='@opentelemetry/instrumentation-net')
  const applicationSpans=rows.filter(r=>/ebpf|obi/i.test(String(r.payload.scope?.name??''))).map(reference)
  // Application spans emitted by eBPF are not flow counters. Only retained
  // stock network-flow metrics supply those observations; raw peer names are
  // withheld because a flow label cannot establish a permitted peer identity.
  const flows=matched.filter(s=>/^(obi|beyla)[.]network[.]flow[.]/.test(s.name)).map(s=>({...measured(s,through,complete),attributes:Object.fromEntries(['network.transport','network.protocol.name','network.io.direction'].filter(k=>s.attributes[k]!==undefined).map(k=>[k,s.attributes[k]])),peer:null,instrumentation:s.instrumentation}))
  const gaps=requirements.flatMap(([source,privilege,nextAction])=>{
   const evidence=source==='tcp'?counters.filter(c=>c.name.startsWith('node_netstat_')):source==='container'?counters.filter(c=>c.name.startsWith('container.network.')):flows
   const fresh=source==='tcp'?['node_netstat_Tcp_RetransSegs','node_netstat_TcpExt_TCPTimeouts'].every(name=>counters.some(c=>c.name===name&&c.state==='observed')):source==='container'?['container.network.io.usage.rx_dropped','container.network.io.usage.tx_dropped'].every(name=>counters.some(c=>c.name===name&&c.state==='observed')):evidence.length&&evidence.every(e=>!('state'in e)||e.state==='observed')
   return fresh?[]:[{source,state:evidence.length?'stale':'unknown',missing:privilege,nextAction,reason:identities.length?'No fresh correlated evidence; collection absence does not identify a denial by itself.':'Explicit container.id and host.id are required; name-only correlation is refused.'}]
  })
  return {key,dependencies:dependencyEvidence(unique,counters).filter(d=>d.from===key),identities:[...new Map(identities.map(r=>[canonical(r),r])).values()],dns:spanSummary(dns),connections:spanSummary(connections),counters,flows,applicationSpans,gaps,fullTraffic:false}
 })
}
