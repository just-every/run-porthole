import {canonical} from '../ingest/model'
import {attributes} from '../services/model'
import {metricSeries,measured,reference,scopeKey,spanSummary,uniqueSpans,type EvidenceRecord} from '../network/model'
const brokerIdentity=(row:EvidenceRecord)=>{
 const r=attributes(row.payload.resource)
 return typeof r['porthole.messaging.broker.container.id']==='string'&&typeof r['host.id']==='string'?canonical([r['porthole.messaging.broker.container.id'],r['host.id']]):null
}
export function messagingEvidence(spans:EvidenceRecord[],metrics:EvidenceRecord[],from:string,through:string,complete:boolean) {
 const unique=uniqueSpans(spans),series=metricSeries(metrics),groups=new Map<string,EvidenceRecord[]>()
 for(const row of unique){
  const a=attributes(row.payload.record),system=a['messaging.system'],destination=a['messaging.destination.name']??(a['messaging.destination']||a['messaging.rabbitmq.routing_key'])
  if(typeof system!=='string'||typeof destination!=='string'||![3,4,5].includes(Number(row.payload.record.kind)))continue
  const key=canonical([scopeKey(row),system,destination,brokerIdentity(row)]),group=groups.get(key)??[];group.push(row);groups.set(key,group)
 }
 const seconds=Number(BigInt(through)-BigInt(from)+1n)/1e9
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
  const a=attributes(rows[0].payload.record),system=String(a['messaging.system']),destination=String(a['messaging.destination.name']??(a['messaging.destination']||a['messaging.rabbitmq.routing_key'])),broker=brokerIdentity(rows[0]),scope=scopeKey(rows[0])
  const producers=rows.filter(r=>Number(r.payload.record.kind)===4),consumers=rows.filter(r=>Number(r.payload.record.kind)===5)
  // A destination string is insufficient: the metric resource must explicitly
  // declare the same broker container, host and all current scope dimensions.
  const samples=broker?series.filter(s=>s.resource.scope===scope&&canonical([s.resource.brokerContainerId??s.resource.containerId,s.resource.hostId])===broker&&String(s.attributes.topic??s.attributes.queue??s.attributes['rabbitmq.queue.name']??s.attributes['messaging.destination.name']??'')===destination&&/^(kafka\.|rabbitmq\.)/.test(s.name)).map(s=>measured(s,through,complete)):[]
  const links=consumers.flatMap(c=>{
   const raw=c.payload.record,parents=unique.filter(p=>Number(p.payload.record.kind)===4&&p.trace_id===c.trace_id&&p.span_id===raw.parentSpanId)
   const linked=Array.isArray(raw.links)?raw.links:[]
   for(const link of linked){const l=link as {traceId?:string;spanId?:string};parents.push(...unique.filter(p=>Number(p.payload.record.kind)===4&&p.trace_id===l.traceId&&p.span_id===l.spanId))}
   return [...new Map(parents.map(p=>[p.id,p])).values()].map(p=>({producer:reference(p),consumer:reference(c)}))
  })
  const lag=samples.filter(s=>/lag$|rabbitmq\.message\.current$/.test(s.name))
  return {key,scope,system,destination,brokerIdentity:broker,producers:spanSummary(producers),consumers:spanSummary(consumers),producerPerSecond:producers.length/seconds,consumerPerSecond:consumers.length/seconds,processingLatency:spanSummary(consumers),metrics:samples,links,gaps:lag.some(s=>s.state==='observed')?[]:[{source:system,state:lag.length?'stale':'unknown',missing:system==='kafka'?'Kafka consumer-group describe and offset read grant':'RabbitMQ monitoring user permissions',nextAction:broker?'Check the stock receiver diagnostics and restore the broker read grant.':'Declare the broker container.id and host.id; destination names alone cannot establish correlation.'}],fullTraffic:false}
 })
}
