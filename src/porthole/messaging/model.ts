import {canonical} from '../ingest/model'
import {attributes} from '../services/model'
import {metricSeries,measured,reference,resourceIdentity,scopeKey,spanSummary,uniqueSpans,type EvidenceRecord} from '../network/model'
const brokerIdentity=(row:EvidenceRecord)=>{
 const r=resourceIdentity(row)
 return r.brokerContainerId&&r.hostId?canonical([r.brokerContainerId,r.hostId]):null
}
const namespace=(row:EvidenceRecord)=>{const value=attributes(row.payload.resource)['porthole.messaging.rabbitmq.vhost'];return typeof value==='string'&&value.length<=240&&!value.includes('[REDACTED]')?value:null}
export function messagingEvidence(spans:EvidenceRecord[],metrics:EvidenceRecord[],from:string,through:string,complete:boolean) {
 const unique=uniqueSpans(spans),series=metricSeries(metrics),groups=new Map<string,EvidenceRecord[]>()
 for(const row of unique){
  const a=attributes(row.payload.record),system=a['messaging.system'],destination=a['messaging.destination.name']??(a['messaging.destination']||a['messaging.rabbitmq.routing_key'])
  if(typeof system!=='string'||typeof destination!=='string'||![3,4,5].includes(Number(row.payload.record.kind)))continue
  const key=canonical([scopeKey(row),system,destination,brokerIdentity(row),system==='rabbitmq'?namespace(row):null]),group=groups.get(key)??[];group.push(row);groups.set(key,group)
 }
 const seconds=Number(BigInt(through)-BigInt(from)+1n)/1e9
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
  const a=attributes(rows[0].payload.record),system=String(a['messaging.system']),destination=String(a['messaging.destination.name']??(a['messaging.destination']||a['messaging.rabbitmq.routing_key'])),broker=brokerIdentity(rows[0]),scope=scopeKey(rows[0]),virtualHost=system==='rabbitmq'?namespace(rows[0]):null,correlated=!!broker&&(system!=='rabbitmq'||virtualHost!==null)
  const producers=rows.filter(r=>Number(r.payload.record.kind)===4),consumers=rows.filter(r=>Number(r.payload.record.kind)===5)
  const queueRows=correlated?unique.filter(r=>{const a=attributes(r.payload.record);return a['messaging.system']===system&&(a['messaging.destination.name']??(a['messaging.destination']||a['messaging.rabbitmq.routing_key']))===destination&&brokerIdentity(r)===broker&&(system!=='rabbitmq'||namespace(r)===virtualHost)}):rows
  const queueProducers=queueRows.filter(r=>Number(r.payload.record.kind)===4),queueConsumers=queueRows.filter(r=>Number(r.payload.record.kind)===5)
  const visibleQueue={producers:spanSummary(queueProducers),consumers:spanSummary(queueConsumers),producerPerSecond:queueProducers.length?queueProducers.length/seconds:null,consumerPerSecond:queueConsumers.length?queueConsumers.length/seconds:null,contributors:[...new Set(queueRows.map(scopeKey))].sort()}

  // A destination string is insufficient: the metric resource must explicitly
  // declare the same broker container, host and all current scope dimensions.
  const samples=correlated?series.filter(s=>s.resource.scope===scope&&canonical([s.resource.containerId,s.resource.hostId])===broker&&String(s.attributes.topic??s.attributes.queue??s.attributes['rabbitmq.queue.name']??s.attributes['messaging.destination.name']??'')===destination&&(system!=='rabbitmq'||s.attributes['rabbitmq.vhost.name']===virtualHost)&&s.name.startsWith(system+'.')&&/^(kafka\.|rabbitmq\.)/.test(s.name)).map(s=>measured(s,through,complete)):[]
  const links=queueConsumers.flatMap(c=>{
   const raw=c.payload.record,parents=queueProducers.filter(p=>Number(p.payload.record.kind)===4&&p.trace_id===c.trace_id&&p.span_id===raw.parentSpanId)
   const linked=Array.isArray(raw.links)?raw.links:[]
   for(const link of linked){const l=link as {traceId?:string;spanId?:string};parents.push(...queueProducers.filter(p=>Number(p.payload.record.kind)===4&&p.trace_id===l.traceId&&p.span_id===l.spanId))}
   return [...new Map(parents.map(p=>[p.id,p])).values()].map(p=>({producer:reference(p),consumer:reference(c)}))
  })
  const lag=samples.filter(s=>/lag$|rabbitmq\.message\.current$/.test(s.name))
  return {key,scope,system,destination,namespace:virtualHost,brokerIdentity:broker,producers:spanSummary(producers),consumers:spanSummary(consumers),producerPerSecond:producers.length/seconds,consumerPerSecond:consumers.length/seconds,visibleQueue,processingLatency:spanSummary(queueConsumers),metrics:samples,links,gaps:lag.some(s=>s.state==='observed')?[]:[{source:system,state:lag.length?'stale':'unknown',missing:system==='kafka'?'Kafka consumer-group describe and offset read grant':system==='rabbitmq'?'RabbitMQ monitoring user permissions':'Native collector qualification is unavailable for this messaging system',nextAction:correlated?'Check the stock receiver diagnostics and restore the broker read grant.':'Declare the broker container.id, host.id and RabbitMQ virtual host; destination names alone cannot establish correlation.'}],fullTraffic:false}
 })
}
