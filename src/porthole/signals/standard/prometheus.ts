import { RE2JS } from 're2js'
import { fail } from '../../security/authority'
import { canonical } from '../../ingest/model'
import { attributes } from '../../ingest/normalize'
import { fields, bytes, Proto } from '../../ingest/wire'
import { concat, integer, message, text, float, scalar, string, typed } from './protobuf'
import type { StandardRow } from './read'

interface Matcher {type:number;name:string;value:string;regex?:RE2JS}
export interface ReadQuery {start:bigint;end:bigint;matchers:Matcher[]}
export function readRequest(input:Uint8Array):ReadQuery[] {
 const queries:ReadQuery[]=[],types:number[]=[]
 for(const f of fields(input)) {
  if(f.number===2){if(f.wire===2){const r=new Proto(bytes(f));while(r.position<r.bytes.length)types.push(Number(r.varint()))}else types.push(Number(scalar(f)));continue}
  if(f.number!==1)fail('unsupported_remote_read_field',415)
  let start=0n,end=0n;const matchers:Matcher[]=[]
  for(const part of fields(bytes(typed(f,2)))){
   if(part.number===1)start=BigInt.asIntN(64,scalar(part))
   else if(part.number===2)end=BigInt.asIntN(64,scalar(part))
   else if(part.number===4){typed(part,2)} // ReadHints are advisory; Porthole returns raw samples only.
   else if(part.number===3){
    let type=0,name='',value=''
    for(const p of fields(bytes(typed(part,2)))){if(p.number===1)type=Number(scalar(p));else if(p.number===2)name=string(p);else if(p.number===3)value=string(p);else fail('invalid_label_matcher',400)}
    if(![0,1,2,3].includes(type)||!name||name.length>120||value.length>1024)fail('invalid_label_matcher',400)
    let regex:RE2JS|undefined
    if(type>=2)try{regex=RE2JS.compile(value,RE2JS.DOTALL)}catch{fail('invalid_label_regex',400)}
    matchers.push({type,name,value,regex})
   }else fail('unsupported_remote_read_query',415)
  }
  if(start<0n||end<start||end>18446744073709n||matchers.length>30)fail('invalid_remote_read_range',400)
  queries.push({start,end,matchers})
 }
 if(!queries.length||queries.length>8)fail('remote_read_query_limit',400)
 // An absent preference means SAMPLES. Streamed chunks are never negotiated.
 if(types.length&&!types.includes(0))fail('unsupported_remote_read_response_type',415)
 return queries
}
interface Sample {timestamp:bigint;value:number;bits?:string}
interface Point extends Sample {labels:Record<string,string>}
const unitNames:Record<string,string>={d:'days',h:'hours',min:'minutes',s:'seconds',ms:'milliseconds',us:'microseconds',ns:'nanoseconds',By:'bytes',KiBy:'kibibytes',MiBy:'mebibytes',GiBy:'gibibytes',TiBy:'tebibytes',kBy:'kilobytes',MBy:'megabytes',GBy:'gigabytes',TBy:'terabytes',m:'meters',V:'volts',A:'amperes',J:'joules',W:'watts',g:'grams',Cel:'celsius',Hz:'hertz','%':'percent','1':'ratio'}
const normalize=(name:string,metric=false)=>{let n=name.replace(metric?/[^a-zA-Z0-9_:]/g:/[^a-zA-Z0-9_]/g,'_').replace(/_+/g,'_');if(/^\d/.test(n))n='_'+n;return n}
function labels(values:Record<string,unknown>) {
 const result:Record<string,string>=Object.create(null)
 for(const key of Object.keys(values).sort()){
  const name=normalize(key);if(!name)fail('unmappable_metric_label',422)
  const raw=values[key],value=typeof raw==='object'?JSON.stringify(raw):String(raw)
  result[name]=Object.hasOwn(result,name)?result[name]+';'+value:value
 }
 return result
}
function number(value:unknown):number {
 const n=Number(value)
 if(value===undefined||value===null||!['number','string'].includes(typeof value)||typeof value==='string'&&!/^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|NaN|[+-]?Infinity)$/.test(value))fail('unmappable_metric_value',422)
 return n
}
function metricName(name:string,unit:string,counter:boolean) {
 let n=normalize(name,true),u=unit.replace(/\{[^}]*\}/g,'')
 if(counter)n=n.replace(/_total$/,'')
 const parts=u.split('/');u=parts.map((part,i)=>unitNames[part]??normalize(part)).join('_per_')
 if(u&&!(counter&&unit==='1')&&!n.endsWith('_'+u))n+='_'+u
 if(counter)n+='_total'
 if(!n)fail('unmappable_metric_name',422)
 return n
}
export function metricPoints(row:StandardRow):Point[] {
 const p=row.payload,record=p.record as Record<string,unknown>,metric=p.metric as Record<string,unknown>
 if(p.protocol==='prometheus.WriteRequest'){
  const value=Number(record.value),bits=typeof record.valueBits==='string'?record.valueBits:undefined
  if(!bits&&!Number.isFinite(value))fail('legacy_remote_sample_bits_unavailable',422)
  return [{labels:{...(p.resource as {attributes:Record<string,string>}).attributes},timestamp:BigInt(String(record.timestamp)),value,bits}]
 }
 if(p.protocol)fail('unmappable_metric_protocol',422)
 const kind=String(p.metricKind),container=metric[kind] as Record<string,unknown>
 if(!['gauge','sum','histogram','summary'].includes(kind))fail('unmappable_metric_type',422)
 if(['sum','histogram'].includes(kind)&&![2,'AGGREGATION_TEMPORALITY_CUMULATIVE'].includes(container.aggregationTemporality as number))fail('unmappable_metric_temporality',422)
 const counter=kind==='sum'&&container.isMonotonic===true,name=metricName(String(metric.name),String(metric.unit??''),counter)
 const resource=attributes((p.resource as Record<string,unknown>)?.attributes),base=labels(attributes(record.attributes))
 // This declared receiver profile disables scope-info series and scope labels,
 // as does the pinned Prometheus OTLP receiver. Resource identity still binds
 // every sample; remaining resource attributes form target_info.
 const job=resource['service.name']?String(resource['service.namespace']?resource['service.namespace']+'/'+resource['service.name']:resource['service.name']):undefined
 if(job)base.job=job
 if(resource['service.instance.id'])base.instance=String(resource['service.instance.id'])
 const timestamp=BigInt(String(record.timeUnixNano??'0'))/1000000n,out:Point[]=[]
 const stale=(Number(record.flags??0)&1)!==0
 const add=(n:string,value:unknown,extra:Record<string,string>={})=>out.push({labels:{...base,...extra,__name__:n},timestamp,value:stale?NaN:number(value),...(stale?{bits:'020000000000f07f'}:{})})
 if(kind==='gauge'||kind==='sum')add(name,record.asDouble??record.asInt)
 else if(kind==='histogram'){
  const bounds=(record.explicitBounds??[]) as number[],counts=(record.bucketCounts??[]) as unknown[]
  if(counts.length!==bounds.length+1||bounds.some((v,i)=>!Number.isFinite(v)||i>0&&v<=bounds[i-1])||counts.some(v=>!Number.isSafeInteger(Number(v))||Number(v)<0))fail('unmappable_histogram',422)
  let cumulative=0
  for(let i=0;i<counts.length;i++){cumulative+=number(counts[i]);add(name+'_bucket',cumulative,{le:i===bounds.length?'+Inf':String(bounds[i])})}
  if(cumulative!==number(record.count))fail('unmappable_histogram_count',422)
  add(name+'_count',record.count)
  if(record.sum!==undefined){if(bounds.some(v=>v<0)||Number(record.sum)<0)fail('unmappable_negative_histogram_sum',422);add(name+'_sum',record.sum)}
 }else{
  add(name+'_count',record.count)
  if(Number(record.sum)<0)fail('unmappable_negative_summary_sum',422)
  add(name+'_sum',record.sum)
  for(const quantile of (record.quantileValues??[]) as {quantile:number;value:number}[]){if(quantile.quantile<0||quantile.quantile>1)fail('unmappable_summary_quantile',422);add(name,quantile.value,{quantile:String(quantile.quantile)})}
 }
 if(job||resource['service.instance.id']){
  const extra=Object.fromEntries(Object.entries(resource).filter(([key])=>!['service.name','service.namespace','service.instance.id'].includes(key)))
  out.push({labels:{...labels(extra),...(job?{job}:{}),...(base.instance?{instance:base.instance}:{}),__name__:'target_info'},timestamp,value:1})
 }
 return out
}
const matches=(labels:Record<string,string>,matchers:Matcher[])=>matchers.every(m=>{const value=labels[m.name]??'',equal=m.regex?m.regex.matcher(value).matches():value===m.value;return m.type===1||m.type===3?!equal:equal})
export function readResponse(queries:ReadQuery[],rows:StandardRow[]) {
 const points=rows.flatMap(metricPoints)
 let sampleCount=0
 const response=concat(queries.map(query=>{
  const series=new Map<string,{labels:Record<string,string>;samples:Map<string,Sample>}>()
  for(const p of points){
   if(p.timestamp<query.start||p.timestamp>query.end||!matches(p.labels,query.matchers))continue
   const key=canonical(p.labels);let group=series.get(key)
   if(!group){group={labels:p.labels,samples:new Map()};series.set(key,group)}
   const time=p.timestamp.toString(),old=group.samples.get(time)
   if(old&&(old.bits??String(old.value))!==(p.bits??String(p.value)))fail('conflicting_standard_samples',409)
   group.samples.set(time,p)
   if(++sampleCount>20000)fail('standard_read_budget_exceeded',422)
  }
  return message(1,concat([...series.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,group])=>message(1,concat([
   ...Object.entries(group.labels).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>message(1,concat([text(1,name),text(2,value)]))),
   ...[...group.samples.values()].sort((a,b)=>a.timestamp<b.timestamp?-1:a.timestamp>b.timestamp?1:0).map(p=>message(2,concat([float(1,p.value,p.bits),integer(2,p.timestamp)]))),
  ])))))
 }))
 if(response.length>1024*1024)fail('standard_read_budget_exceeded',422)
 return response
}
