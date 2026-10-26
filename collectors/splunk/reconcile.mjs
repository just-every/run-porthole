import assert from 'node:assert/strict'

export const signals=['traces','metrics','logs']
const names={traces:['Spans','spans'],metrics:['Metrics','metrics'],logs:['Logs','logRecords']}
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)
function projection(signal,payload){
 const attributes=Object.fromEntries((payload.resource.attributes??[]).map(entry=>[entry.key,entry.value.stringValue]))
 const record=payload.record
 return {signal,service:attributes['service.name'],environment:attributes['deployment.environment.name'],team:attributes['team.name'],event_time_ns:String(signal==='traces'?record.startTimeUnixNano:record.timeUnixNano??record.observedTimeUnixNano).padStart(20,'0'),trace_id:record.traceId??null,span_id:record.spanId??null,payload}
}
export function capturedRecords(packets){
 const records=[]
 for(const {signal,body}of packets){
  const [capital,list]=names[signal]
  for(const resource of JSON.parse(body)['resource'+capital]??[]){
   for(const scope of resource['scope'+capital]??[]){
    const common={resource:resource.resource??{},scope:scope.scope??{},resourceSchemaUrl:resource.schemaUrl??'',scopeSchemaUrl:scope.schemaUrl??''}
    for(const record of scope[list]??[]){
     if(signal!=='metrics'){records.push(projection(signal,{...common,record}));continue}
     const metricKind=['gauge','sum','histogram','exponentialHistogram','summary'].find(kind=>record[kind])
     assert.ok(metricKind,'stock metric has an official data kind')
     const {dataPoints,...metadata}=record[metricKind]
     for(const point of dataPoints??[])records.push(projection(signal,{...common,metric:{...record,[metricKind]:metadata},metricKind,record:point}))
    }
   }
  }
 }
 return records
}
export function comparable(rows){
 return rows.map(row=>{
  const {delivery,...payload}=row.payload
  return canonical(Object.fromEntries(['signal','service','environment','team','event_time_ns','trace_id','span_id'].map(key=>[key,row[key]]).concat([['payload',payload]])))
 }).sort()
}
export function requestCorrelation(rows,traceId){
 const spans=rows.filter(row=>row.signal==='traces'),logs=rows.filter(row=>row.signal==='logs'),metrics=rows.filter(row=>row.signal==='metrics')
 assert.equal(spans.length,1,'one actual instrumented request span')
 assert.equal(logs.length,1,'one actual request log')
 assert.equal(spans[0].trace_id,traceId);assert.equal(logs[0].trace_id,traceId)
 assert.equal(logs[0].span_id,spans[0].span_id,'request log preserves exact span correlation')
 assert.equal(spans[0].payload.record.name,'synthetic-porthole-1622')
 assert.equal(logs[0].payload.record.body.stringValue,'synthetic-porthole-1624')
 assert.ok(metrics.length>0,'stock SDK emitted request metric points')
 for(const row of metrics){
  assert.equal(row.payload.metric.name,'synthetic_porthole_1623')
  assert.equal(Number(row.payload.record.asInt??row.payload.record.asDouble),1,'exact cumulative request count')
 }
}
