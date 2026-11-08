import {reject} from '../../explore/model'
import type {RangePlan} from './model'
export type MetricRow={id:string;batch_id:string;event_time_ns:string;service:string;environment:string;team:string;payload:Record<string,unknown>}
type Attributes={key:string;value:Record<string,unknown>}[]
const stable=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(stable(item))])):value??null)
function attributes(value:unknown):Record<string,unknown>{return Object.fromEntries(((value??[]) as Attributes).map(({key,value})=>[key,value]))}
export function evaluateRange(plan:RangePlan,rows:MetricRow[]) {
 const prepared=rows.map(row=>{
  const payload=row.payload,point=payload.record as Record<string,unknown>,metric=payload.metric as {unit?:string},resource=payload.resource as {attributes?:Attributes}
  if(payload.metricKind!=='gauge')reject('unsupported_metric_range_type','Only ordinary OTLP scalar gauges are supported.','metric')
  const missing=(Number(point.flags??0)&1)!==0
  const raw=point.asDouble??point.asInt,value=Number(raw)
  if(!missing&&(raw===undefined||!Number.isFinite(value)||point.asInt!==undefined&&!Number.isSafeInteger(value)))reject('unsupported_metric_range_value','Gauge values must be finite; integer values must be exactly representable.','metric')
  const resourceAttributes=attributes(resource?.attributes),pointAttributes=attributes(point.attributes)
  const labels:Record<string,unknown>={...resourceAttributes,...pointAttributes,service:row.service,environment:row.environment,team:row.team}
  const grouped=Object.fromEntries(plan.groupBy.map(key=>[key,labels[key]??null]))
  return {row,value,missing,unit:metric.unit??'',labels:grouped,group:stable(grouped),producer:stable([resourceAttributes,payload.scope,pointAttributes]),time:BigInt(row.event_time_ns)}
 })
 const groups=new Map<string,{labels:Record<string,unknown>;unit:string;points:{timestamp:string;value:number;contributors:number}[]}>()
 for(let instant=BigInt(plan.start);instant<=BigInt(plan.end);instant+=BigInt(plan.step)*1000000000n){
  const producers=new Map<string,typeof prepared[number]>()
  for(const point of prepared){
   if(point.time>instant||point.time<=instant-BigInt(plan.lookback)*1000000000n)continue
   const key=point.producer,previous=producers.get(key)
   if(!previous||point.time>previous.time)producers.set(key,point)
   else if(point.time===previous.time&&stable([point.value,point.unit,point.missing])!==stable([previous.value,previous.unit,previous.missing]))reject('ambiguous_metric_range','A producer has conflicting values at the same timestamp.','metric')
  }
  const instantGroups=new Map<string,typeof prepared>()
  for(const point of producers.values()){if(point.missing)continue;const values=instantGroups.get(point.group)??[];values.push(point);instantGroups.set(point.group,values)}
  for(const [key,points]of instantGroups){
   const units=new Set(points.map(point=>point.unit)),unit=points[0].unit,existing=groups.get(key)
   // One declared unit covers the entire series, including producer turnover.
   // No guessed conversion or first-point unit may label later values.
   if(units.size!==1||existing&&existing.unit!==unit)reject('incompatible_metric_range_units','This group changes or mixes units. No conversion is applied; select a same-unit range or separate producers with group labels.','metric')
   const values=points.map(point=>point.value),sum=values.reduce((total,value)=>total+value,0)
   const value=plan.aggregation==='sum'?sum:plan.aggregation==='average'?sum/values.length:plan.aggregation==='min'?Math.min(...values):Math.max(...values)
   if(!Number.isFinite(value))reject('unsupported_metric_range_value','The aggregation exceeds finite scalar values.','aggregation')
   const series=existing??{labels:points[0].labels,unit,points:[]};series.points.push({timestamp:instant.toString().padStart(20,'0'),value,contributors:points.length});groups.set(key,series)
  }
 }
 return {version:1,state:'complete',...plan,series:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,series])=>series)}
}
