import {canonical} from '../ingest/model'
import {reject} from '../explore/model'
import {metricRange,type MetricAggregation,type MetricDimension,type MetricExpression,type MetricQueryPlan,type MetricSelector,type MetricTimeRange} from '../explore/datadog-metrics'

export interface MetricRecord {
 service:string;environment:string;team:string
 event_time_ns?:string;eventTimeNs?:string;payload:Record<string,unknown>
}
export type MetricMissingReason='rate_predecessor_missing'|'counter_decrease'|'operand_missing'|'division_by_zero'|'non_finite_result'
export interface MetricSeriesPoint {timeNs:string;value:number|null;missing?:MetricMissingReason}
export interface MetricSeries {dimensions:Partial<Record<MetricDimension,string>>;unit:string|null;points:MetricSeriesPoint[]}
export interface MetricDiagnostic {code:string;message:string;count?:number}
export interface MetricSeriesResult {
 state:'complete'|'empty';series:MetricSeries[];range:MetricTimeRange
 statistics:{scannedRecords:number;matchedRecords:number;usedRecords:number;series:number;points:number;missingPoints:number;skippedNoValue:number}
 diagnostics:MetricDiagnostic[];sourceParity:'unproved'
}
interface NativeSource {dimensions:MetricSeries['dimensions'];unit:string|null;samples:Map<string,number>;timestamps:Set<string>}
type Evaluated={scalar:number}|{series:MetricSeries[]}
const recordLimit=10000,pointLimit=20000
const comparison=(a:string,b:string)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
function tags(value:unknown):Record<string,unknown> {
 const output:Record<string,unknown>=Object.create(null)
 if(value===undefined)return output
 if(!Array.isArray(value))reject('invalid_metric_attributes','Metric attributes must retain their OTLP typed array.')
 for(const item of value) {
  const attribute=obj(item),typed=obj(attribute.value)
  if(typeof attribute.key!=='string'||Object.hasOwn(output,attribute.key))reject('invalid_metric_attributes','Metric attributes require unique string keys.')
  output[attribute.key]=typed.stringValue??typed.intValue??typed.doubleValue??typed.boolValue??typed
 }
 return output
}
function aggregate(values:number[],method:MetricAggregation):number {
 let value=method==='min'?Infinity:method==='max'?-Infinity:0
 for(const item of values)value=method==='min'?Math.min(value,item):method==='max'?Math.max(value,item):value+item
 if(method==='avg')value/=values.length
 if(!Number.isFinite(value))reject('non_finite_metric_result','Aggregation exceeded the finite numeric range; narrow the query or change the aggregation.')
 return value
}
function numeric(point:Record<string,unknown>):number {
 const hasDouble=Object.hasOwn(point,'asDouble'),hasInt=Object.hasOwn(point,'asInt')
 if(hasDouble===hasInt)reject('invalid_metric_value','Scalar OTLP points require exactly one asDouble or asInt value.')
 let value=hasDouble?point.asDouble:point.asInt
 // OTLP's typed int64 field is a decimal string on the protobuf JSON wire.
 // Decode only that field and only within JavaScript's exact integer range.
 if(hasInt&&typeof value==='string'&&/^-?(?:0|[1-9]\d*)$/.test(value)&&value.length<=20) {
  const integer=BigInt(value)
  if(integer>=BigInt(Number.MIN_SAFE_INTEGER)&&integer<=BigInt(Number.MAX_SAFE_INTEGER))value=Number(integer)
 }
 if(typeof value!=='number'||!Number.isFinite(value)||hasInt&&!Number.isSafeInteger(value))reject('non_numeric_metric_value','Use a finite numeric asDouble or exact safe integer asInt. Only the typed OTLP asInt decimal wire string is decoded; other numeric strings and unsafe integers are refused.')
 return value
}
function timestamp(row:MetricRecord):bigint {
 const value=row.event_time_ns??row.eventTimeNs
 if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n)reject('invalid_metric_timestamp','Selected metric records require an unsigned nanosecond timestamp.')
 return BigInt(value)
}
function rate(points:MetricSeriesPoint[],name:NonNullable<MetricSelector['rate']>):MetricSeriesPoint[] {
 return points.map<MetricSeriesPoint>((point,index)=>{
  const previous=points[index-1]
  if(!previous)return {...point,value:null,missing:'rate_predecessor_missing'}
  const difference=point.value!-previous.value!
  if(name==='monotonic_diff'&&difference<0)return {...point,value:null,missing:'counter_decrease'}
  const seconds=Number(BigInt(point.timeNs)-BigInt(previous.timeNs))/1e9
  const factor=name==='per_minute'?60:name==='per_hour'?3600:1
  const value=name==='diff'||name==='monotonic_diff'?difference:difference/seconds*factor
  return Number.isFinite(value)?{timeNs:point.timeNs,value}:{timeNs:point.timeNs,value:null,missing:'non_finite_result'}
 })
}
function rateUnit(unit:string|null,name:MetricSelector['rate']):string|null {
 if(unit===null||!name||name==='diff'||name==='monotonic_diff')return unit
 return `${unit}/${name==='per_minute'?'min':name==='per_hour'?'h':'s'}`
}
function arithmeticUnit(left:string|null,right:string|null,operator:string,leftScalar:boolean,rightScalar:boolean):string|null {
 if(operator==='+'||operator==='-') {
  if(leftScalar)return right
  if(rightScalar)return left
  if(left!==right)reject('incompatible_metric_units','Addition and subtraction require identical declared units; convert the source units explicitly upstream.')
  return left
 }
 if(left===null||right===null)return null
 if(operator==='*')return left==='1'?right:right==='1'?left:`(${left})*(${right})`
 return right==='1'?left:left===right?'1':`(${left})/(${right})`
}
function applyArithmetic(left:Evaluated,right:Evaluated,operator:'+'|'-'|'*'|'/'):Evaluated {
 const leftScalar='scalar' in left,rightScalar='scalar' in right
 const compute=(a:number|null|undefined,b:number|null|undefined):Pick<MetricSeriesPoint,'value'|'missing'>=>{
  if(a===null||a===undefined||b===null||b===undefined)return {value:null,missing:'operand_missing'}
  if(operator==='/'&&b===0)return {value:null,missing:'division_by_zero'}
  const value=operator==='+'?a+b:operator==='-'?a-b:operator==='*'?a*b:a/b
  return Number.isFinite(value)?{value}:{value:null,missing:'non_finite_result'}
 }
 if(leftScalar&&rightScalar) {
  const output=compute(left.scalar,right.scalar)
  if(output.value===null)reject('invalid_metric_arithmetic','Constant arithmetic must produce a finite value without division by zero.')
  return {scalar:output.value}
 }
 const leftSeries=leftScalar?[]:left.series,rightSeries=rightScalar?[]:right.series
 const leftGroups=new Map(leftSeries.map(item=>[canonical(item.dimensions),item])),rightGroups=new Map(rightSeries.map(item=>[canonical(item.dimensions),item]))
 const keys=new Set([...leftGroups.keys(),...rightGroups.keys()]),series:MetricSeries[]=[]
 for(const key of keys) {
  const a=leftGroups.get(key),b=rightGroups.get(key)
  const unit=arithmeticUnit(leftScalar?'1':a?a.unit:b?.unit??null,rightScalar?'1':b?b.unit:a?.unit??null,operator,leftScalar,rightScalar)
  const aPoints=new Map(a?.points.map(point=>[point.timeNs,point.value])??[]),bPoints=new Map(b?.points.map(point=>[point.timeNs,point.value])??[])
  const times=[...new Set([...aPoints.keys(),...bPoints.keys()])].sort(comparison)
  series.push({dimensions:(a??b)!.dimensions,unit,points:times.map(timeNs=>({timeNs,...compute(leftScalar?left.scalar:aPoints.get(timeNs),rightScalar?right.scalar:bPoints.get(timeNs))}))})
 }
 return {series}
}

/** Synchronous evaluation over a COMPLETE, bounded, already authorized snapshot.
 * Never pass a single cursor page as a complete corpus. Caller must refuse an
 * incomplete read and keep native scope/time/retention/credential fences. Input
 * includes metricReadRange(plan, range), including timeshift history. This is not
 * an authorization boundary; explicit filters on every plan.selector must also
 * be authorized by the query door before storage reads.
 */
export function evaluateMetricSeries(records:readonly MetricRecord[],plan:MetricQueryPlan,range:MetricTimeRange):MetricSeriesResult {
 if(records.length>recordLimit)reject('metric_query_record_limit','The complete metric input exceeds 10000 records; narrow the time range or scope before evaluating.')
 const requested=metricRange(range),matched=new Set<number>(),used=new Set<number>(),noValue=new Set<number>()
 const diagnostics:MetricDiagnostic[]=[
  {code:'bounded_native_semantics',message:'Source parity is unproved. Native evaluation uses exact timestamps unless an explicit Unix-aligned rollup is present; Datadog automatic rollups and interpolation are not emulated.'},
  {code:'missing_data_not_filled',message:'Absent samples and buckets are not zero-filled or interpolated. Arithmetic uses exact timestamp and dimension matching; unmatched operands produce null.'},
 ]
 let unknownUnits=false,partialBuckets=false,hasRate=false
 const decodedIntegers=new Set<number>()
 const select=(selector:MetricSelector,shift:bigint):MetricSeries[]=>{
  const from=requested.from+shift,through=requested.through+shift
  if(from<0n)reject('invalid_metric_query_range','The requested timeshift precedes the Unix epoch.','from')
  const sources=new Map<string,NativeSource>(),units=new Set<string|null>()
  for(let index=0;index<records.length;index++) {
   const row=records[index],payload=row.payload,metric=obj(payload.metric)
   if(metric.name!==selector.metric)continue
   if(Object.entries(selector.filters).some(([key,value])=>key!=='host'&&row[key as 'service'|'environment'|'team']!==value))continue
   const time=timestamp(row);if(time<from||time>through)continue
   const point=obj(payload.record),resource=obj(payload.resource),attributes={...tags(resource.attributes),...tags(point.attributes)}
   const host=attributes['host.name']??attributes.host
   if(selector.filters.host!==undefined&&host!==selector.filters.host)continue
   matched.add(index)
   if(payload.metricKind!=='gauge'&&payload.metricKind!=='sum')reject('unsupported_metric_data','Only ingested OTLP gauge and sum scalar points are supported; histogram, exponential histogram and summary evaluation is unsupported.')
   if(point.flags!==undefined&&(typeof point.flags!=='number'||!Number.isSafeInteger(point.flags)||point.flags<0))reject('invalid_metric_flags','OTLP point flags must retain their numeric type.')
   if(typeof point.flags==='number'&&(point.flags&1)!==0){noValue.add(index);continue}
   const value=numeric(point)
   if(typeof point.asInt==='string')decodedIntegers.add(index)
   if(metric.unit!==undefined&&typeof metric.unit!=='string')reject('invalid_metric_unit','Metric units must retain their declared string type.')
   const unit=typeof metric.unit==='string'&&metric.unit.length?metric.unit:null
   units.add(unit);unknownUnits ||= unit===null
   const dimensions:MetricSeries['dimensions']={}
   for(const key of selector.groupBy) {
    const value=key==='host'?host:row[key]
    if(typeof value!=='string'||!value)reject('missing_metric_dimension',`Selected records lack a string ${key} group tag. Choose a dimension present on every selected source.`)
    dimensions[key]=value
   }
   const identity=canonical({resource:tags(resource.attributes),attributes:tags(point.attributes),scope:payload.scope,service:row.service,environment:row.environment,team:row.team,kind:payload.metricKind})
   let source=sources.get(identity)
   if(!source){source={dimensions,unit,samples:new Map(),timestamps:new Set()};sources.set(identity,source)}
   const originalTime=time.toString()
   if(source.timestamps.has(originalTime))reject('ambiguous_metric_sample','Two selected scalar points have the same source tags and timestamp; reconcile the duplicate source samples before evaluation.')
   source.timestamps.add(originalTime);source.samples.set(originalTime,value);used.add(index)
  }
  if(units.size>1)reject('incompatible_metric_units','All selected points for one metric must have the same declared unit, including missing units; no conversion is implied.')
  const groups=new Map<string,{dimensions:MetricSeries['dimensions'];unit:string|null;points:Map<string,MetricSeriesPoint[]>}>()
  for(const source of sources.values()) {
   const buckets=new Map<string,number[]>()
   for(const [time,value] of source.samples) {
    const width=selector.rollup?BigInt(selector.rollup.seconds)*1000000000n:0n
    const start=width?BigInt(time)/width*width:BigInt(time)
    if(width&&(start<from||start+width-1n>through))partialBuckets=true
    const key=start.toString(),values=buckets.get(key)??[];values.push(value);buckets.set(key,values)
   }
   let points=[...buckets].sort(([a],[b])=>comparison(a,b)).map(([timeNs,values])=>({timeNs,value:aggregate(values,selector.rollup?.aggregation??'avg')})) as MetricSeriesPoint[]
   if(selector.rate){hasRate=true;points=rate(points,selector.rate)}
   const key=canonical(source.dimensions)
   let group=groups.get(key)
   if(!group){group={dimensions:source.dimensions,unit:rateUnit(source.unit,selector.rate),points:new Map()};groups.set(key,group)}
   for(const point of points) {
    const outputTime=(BigInt(point.timeNs)-shift).toString(),values=group.points.get(outputTime)??[]
    values.push({...point,timeNs:outputTime});group.points.set(outputTime,values)
   }
  }
  return [...groups.values()].map(group=>({dimensions:group.dimensions,unit:group.unit,points:[...group.points].sort(([a],[b])=>comparison(a,b)).map(([timeNs,values])=>{
   // A missing contributing source must not silently become a healthy aggregate.
   const missing=values.find(point=>point.value===null)
   return missing?{timeNs,value:null,missing:missing.missing}:{timeNs,value:aggregate(values.map(point=>point.value!),selector.aggregation)}
  })}))
 }
 const evaluate=(node:MetricExpression,shift:bigint):Evaluated=>{
  if(node.kind==='number')return {scalar:node.value}
  if(node.kind==='selector')return {series:select(node,shift)}
  if(node.kind==='timeshift')return evaluate(node.expression,shift+BigInt(node.seconds)*1000000000n)
  return applyArithmetic(evaluate(node.left,shift),evaluate(node.right,shift),node.operator)
 }
 const evaluated=evaluate(plan.expression,0n)
 if('scalar' in evaluated)reject('metric_selection_required','Metric evaluation requires at least one metric selector.')
 const series=evaluated.series.sort((a,b)=>canonical(a.dimensions).localeCompare(canonical(b.dimensions)))
 let points=0,missingPoints=0
 for(const item of series)for(const point of item.points){points++;if(point.value===null)missingPoints++}
 if(points>pointLimit)reject('metric_query_point_limit','The complete result exceeds 20000 points; narrow the range or use a larger explicit rollup interval.')
 if(unknownUnits)diagnostics.push({code:'unit_unspecified',message:'At least one selected metric has no declared unit. Unknown units remain null; no conversion is inferred.'})
 if(partialBuckets)diagnostics.push({code:'partial_rollup_bucket',message:'An edge rollup bucket intersects the requested range only partly. Its Unix-aligned start timestamp is preserved and only in-range samples contribute.'})
 if(hasRate)diagnostics.push({code:'bounded_rate',message:'Rates use adjacent observed samples after time aggregation and before space aggregation. The first sample has no predecessor; no lookback, extrapolation or counter-reset correction is inferred.'})
 if(noValue.size)diagnostics.push({code:'otlp_no_recorded_value',message:'OTLP points carrying the no-recorded-value flag do not contribute a numeric sample.',count:noValue.size})
 if(decodedIntegers.size)diagnostics.push({code:'otlp_int64_wire_decoded',message:'Typed OTLP asInt decimal wire strings were decoded only after checking exact safe-integer bounds. Other numeric strings are never coerced.',count:decodedIntegers.size})
 if(missingPoints)diagnostics.push({code:'missing_output_points',message:'Null points include an explicit missing reason and never become zero.',count:missingPoints})
 return {state:points?'complete':'empty',series,range:{from:requested.from.toString(),through:requested.through.toString()},statistics:{scannedRecords:records.length,matchedRecords:matched.size,usedRecords:used.size,series:series.length,points,missingPoints,skippedNoValue:noValue.size},diagnostics,sourceParity:'unproved'}
}
