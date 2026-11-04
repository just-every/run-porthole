import {reject} from '../../explore/model'
import type {Plan,Evaluation} from './plan'
interface Row {id:string;service:string;environment:string;team:string;event_time_ns:string;payload:Record<string,unknown>}
interface Sample {time:bigint;value:number|null}
interface Series {labels:Record<string,string>;samples:Sample[];unit:string;kind:'gauge'|'counter'}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
function attributes(value:unknown):Record<string,unknown> {
 if(!Array.isArray(value))return object(value)
 return Object.fromEntries(value.map(entry=>{const item=object(entry),v=object(item.value);return [String(item.key),v.stringValue??v.intValue??v.doubleValue??v.boolValue]}))
}
const ordered=(value:Record<string,string>)=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))
function decode(row:Row,plan:Plan) {
 const payload=row.payload,metric=object(payload.metric),record=object(payload.record)
 const resource=attributes(object(payload.resource).attributes),point=attributes(record.attributes)
 const labels:Record<string,string>=Object.create(null)
 for(const [key,value] of Object.entries({...resource,...point}))if(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
  if(!['string','number','boolean'].includes(typeof value))reject('unsupported_promql_label','Only scalar labels can be evaluated.')
  if(String(value)!=='')labels[key]=String(value)
 }
 Object.assign(labels,{__name__:String(metric.name),service:row.service,environment:row.environment,team:row.team})
 if(Object.entries(plan.matchers).some(([key,value])=>(labels[key]??'')!==value))return null
 let kind:Series['kind']
 if(payload.metricKind==='gauge')kind='gauge'
 else if(payload.metricKind==='sum') {
  if(object(metric.sum).isMonotonic!==true||![2,'AGGREGATION_TEMPORALITY_CUMULATIVE'].includes(object(metric.sum).aggregationTemporality as number|string))reject('unsupported_promql_temporality','Only monotonic cumulative sums can be evaluated.')
  kind='counter'
 }
 else reject('unsupported_promql_metric_type','Evaluation supports scalar gauges and monotonic cumulative counters only.')
 const missing=record.stale===true||(Number(record.flags??0)&1)!==0
 const raw=record.asDouble??record.asInt??record.value,value=missing?null:Number(raw)
 if(value!==null&&(!['number','string'].includes(typeof raw)||typeof raw==='string'&&!/^[+-]?\d+$/.test(raw)||!Number.isFinite(value)||raw===undefined||raw===null||typeof raw==='string'&&/^[+-]?\d+$/.test(raw)&&!Number.isSafeInteger(value)))reject('non_numeric_promql_sample','Selected samples must contain finite, safely represented scalar values.')
 if(kind==='counter'&&value!==null&&value<0)reject('unsupported_promql_counter','Cumulative counter values must be nonnegative.')
 if(typeof metric.unit!=='string'&&metric.unit!==undefined)reject('incompatible_metric_units','Metric units must be declared as text.')
 return {labels:ordered(labels),unit:metric.unit as string??'',kind,sample:{time:BigInt(row.event_time_ns),value}}
}
function extrapolated(samples:Sample[],at:bigint,seconds:number,rate:boolean):number|null {
 const start=at-BigInt(seconds*1000)*1000000n
 const points=samples.filter(sample=>sample.time>start&&sample.time<=at&&sample.value!==null)
 if(points.length<2)return null
 const first=points[0],last=points.at(-1)!,elapsed=Number(last.time-first.time)/1e9
 if(elapsed<=0)return null
 let delta=last.value!-first.value!,previous=first.value!
 for(const point of points.slice(1)){if(point.value!<previous)delta+=previous;previous=point.value!}
 const average=elapsed/(points.length-1),threshold=average*1.1
 let toStart=Number(first.time-start)/1e9,toEnd=Number(at-last.time)/1e9
 if(toStart>=threshold)toStart=average/2
 // Counters cannot extrapolate below zero. Prometheus applies this after
 // clipping a distant start to half the average sample interval.
 if(delta>0&&first.value!>=0)toStart=Math.min(toStart,elapsed*(first.value!/delta))
 if(toEnd>=threshold)toEnd=average/2
 return delta*(elapsed+toStart+toEnd)/elapsed/(rate?seconds:1)
}
export function evaluate(rows:Row[],plan:Plan,settings:Evaluation) {
 const series=new Map<string,Series>()
 for(const row of rows) {
  const decoded=decode(row,plan);if(!decoded)continue
  const key=JSON.stringify(decoded.labels),previous=series.get(key)
  if(previous&&(previous.unit!==decoded.unit||previous.kind!==decoded.kind))reject('incompatible_metric_units','A series must keep its unit and scalar type across the selected range.')
  if(!previous){if(series.size>=1000)reject('promql_series_budget_exceeded','Select at most 1000 series.');series.set(key,{...decoded,samples:[decoded.sample]})}
  else previous.samples.push(decoded.sample)
 }
 for(const value of series.values()) {
  value.samples.sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0)
  value.samples=value.samples.filter((sample,index,list)=>{
   if(index&&list[index-1].time===sample.time) {
    if(list[index-1].value!==sample.value)reject('conflicting_promql_samples','A series contains conflicting samples at the same timestamp.')
    return false
   }
   return true
  })
  if(plan.operation!=='select'&&value.kind!=='counter')reject('unsupported_promql_temporality','Rate and increase require a monotonic cumulative counter.')
 }
 const output=new Map<string,{metric:Record<string,string>;values:[string,number][];unit:string;kind:string}>()
 const step=BigInt(settings.stepSeconds*1000)*1000000n,lookback=BigInt(settings.lookbackSeconds*1000)*1000000n
 let cells=0
 for(let at=BigInt(settings.start);at<=BigInt(settings.end);at+=step) {
  const groups=new Map<string,{metric:Record<string,string>;value:number;unit:string;kind:string}>()
  for(const item of series.values()) {
   let value:number|null
   if(plan.operation==='select') {
    const sample=item.samples.findLast(point=>point.time<=at)
    value=sample&&sample.time>at-lookback?sample.value:null
   }else value=extrapolated(item.samples,at,plan.windowSeconds,plan.operation==='rate')
   if(value===null)continue
   const labels={...item.labels}
   if(plan.operation!=='select')delete labels.__name__
   const metric=plan.groupBy===undefined?labels:ordered(Object.fromEntries(plan.groupBy.filter(key=>labels[key]!==undefined).map(key=>[key,labels[key]])))
   const key=JSON.stringify(metric),prior=groups.get(key),unit=item.unit+(plan.operation==='rate'?'/s':'')
   if(prior&&(prior.unit!==unit||prior.kind!==item.kind))reject('incompatible_metric_units','A sum group cannot combine incompatible units or scalar types.')
   if(prior)prior.value+=value;else groups.set(key,{metric,value,unit,kind:item.kind})
  }
  for(const [key,group] of groups) {
   if(!Number.isFinite(group.value))reject('non_finite_promql_result','Evaluation produced a non-finite value.')
   if(++cells>10000)reject('promql_result_budget_exceeded','Select at most 10000 output samples.')
   let result=output.get(key)
   if(!result){result={metric:group.metric,unit:group.unit,kind:group.kind,values:[]};output.set(key,result)}
   result.values.push([at.toString(),group.value])
  }
 }
 return {state:'complete' as const,resultType:settings.instant?'vector':'matrix',timestampUnit:'unix-nanoseconds',result:[...output.values()].sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric))).map(({metric,values,unit})=>({metric,unit,...(settings.instant?{value:values[0]}:{values})})),missing:'absent',resolution:'retained samples; no downsampling',scannedSamples:rows.length}
}
export type {Row}
