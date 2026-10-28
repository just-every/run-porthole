import {reject,scopeValue,type Parameters} from './model'

export type MetricAggregation='avg'|'sum'|'min'|'max'
export type MetricDimension='host'|'service'|'environment'|'team'
export type MetricRate='per_second'|'per_minute'|'per_hour'|'derivative'|'diff'|'monotonic_diff'
export interface MetricSelector {
 kind:'selector';metric:string;aggregation:MetricAggregation
 filters:Partial<Record<MetricDimension,string>>;groupBy:MetricDimension[]
 rollup?:{aggregation:MetricAggregation;seconds:number};rate?:MetricRate
}
export type MetricExpression=MetricSelector|{kind:'number';value:number}|{kind:'arithmetic';operator:'+'|'-'|'*'|'/';left:MetricExpression;right:MetricExpression}|{kind:'timeshift';seconds:number;expression:MetricExpression}
export interface MetricQueryPlan {
 version:1;dialect:'datadog-metrics';expression:MetricExpression;selectors:MetricSelector[]
 semantics:{alignment:'exact-timestamp-unless-explicit-rollup';missing:'null-no-interpolation';sourceParity:'unproved'}
}
export interface ParsedMetricQuery {parameters:Parameters;metricQuery:MetricQueryPlan}
export interface MetricTimeRange {from:string;through:string}
const aggregations=new Set(['avg','sum','min','max'])
const rates=new Set(['per_second','per_minute','per_hour','derivative','diff','monotonic_diff'])
const maxSeconds=31*86400
function unsupported(hint:string):never {return reject('unsupported_datadog_metric_expression',hint)}
function dimension(value:string):MetricDimension {
 if(value==='env')return 'environment'
 if(['host','service','environment','team'].includes(value))return value as MetricDimension
 return unsupported('Use only exact service, env, environment, team or host tags and group dimensions.')
}

/** Bounded native dialect, not a Datadog backend emulator. Syntax references:
 * https://docs.datadoghq.com/metrics/
 * https://docs.datadoghq.com/dashboards/functions/{rate,rollup,timeshift}/
 * Automatic rollups, interpolation, modifiers and nested rollups are deliberately
 * absent. The visible plan states exact timestamp alignment without a rollup. */
export function datadogMetrics(text:string):ParsedMetricQuery {
 if(typeof text!=='string'||!text.trim()||text.length>2048||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text))unsupported('Enter a metric expression of at most 2048 printable characters.')
 let position=0,nodes=0
 const selectors:MetricSelector[]=[]
 const whitespace=()=>{while(/\s/.test(text[position]??'')&&position<text.length)position++}
 const take=(value:string)=>{whitespace();if(text.startsWith(value,position)){position+=value.length;return true}return false}
 const expect=(value:string)=>{if(!take(value))unsupported(`Expected ${value} at character ${position+1}.`)}
 const word=()=>{whitespace();const value=/^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(position))?.[0];if(!value)unsupported(`Expected a name at character ${position+1}.`);position+=value.length;return value}
 const positiveSeconds=()=>{whitespace();const value=/^\d+/.exec(text.slice(position))?.[0];if(!value)unsupported('Use a positive whole number of seconds.');position+=value.length;const seconds=Number(value);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>maxSeconds)unsupported('Intervals and shifts must be between 1 second and 31 days.');return seconds}
 const selector=():MetricSelector=>{
  const aggregation=word();if(!aggregations.has(aggregation))unsupported('Choose avg, sum, min or max before the metric name.')
  expect(':');whitespace()
  const metric=/^[a-zA-Z_][a-zA-Z0-9_.]{0,119}/.exec(text.slice(position))?.[0]
  if(!metric)unsupported('Use a metric name beginning with a letter or underscore, followed by letters, digits, underscores or dots (at most 120 characters).')
  position+=metric.length;expect('{')
  const filters:MetricSelector['filters']={}
  if(take('*'))expect('}')
  else {
   if(take('}'))unsupported('Use {*} for all authorized sources or exact tag:value filters.')
   do {
    const key=dimension(word());expect(':');whitespace()
    const value=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}/.exec(text.slice(position))?.[0]
    if(!value)unsupported('Use exact unquoted tag values; wildcards, negation and boolean scopes are unsupported.')
    position+=value.length
    if(Object.hasOwn(filters,key))unsupported(`Specify ${key} only once.`)
    filters[key]=scopeValue(value)
   }while(take(','))
   expect('}')
  }
  const groupBy:MetricDimension[]=[]
  whitespace()
  if(/^by\b/.test(text.slice(position))) {
   position+=2;expect('{')
   do {const key=dimension(word());if(groupBy.includes(key))unsupported('Specify each group dimension once.');groupBy.push(key)}while(take(','))
   expect('}')
  }
  const output:MetricSelector={kind:'selector',metric,aggregation:aggregation as MetricAggregation,filters,groupBy:groupBy.sort()}
  while(take('.')) {
   const name=word();expect('(')
   if(name==='rollup') {
    if(output.rollup)unsupported('Use one explicit rollup per metric selector; nested rollups are unsupported.')
    const method=word();if(!aggregations.has(method))unsupported('Use rollup(avg|sum|min|max, seconds).')
    expect(',');output.rollup={aggregation:method as MetricAggregation,seconds:positiveSeconds()};expect(')')
   }else if(rates.has(name)) {
    if(output.rate)unsupported('Use at most one rate function per metric selector.')
    output.rate=name as MetricRate;expect(')')
   }else unsupported(`Function ${name} is unsupported. Use an explicit rollup or per_second, per_minute, per_hour, derivative, diff or monotonic_diff.`)
  }
  if(selectors.length>=8)unsupported('Use at most eight metric selectors in one expression.')
  selectors.push(output);return output
 }
 const primary=(depth:number):MetricExpression=>{
  if(depth>16||++nodes>64)unsupported('Reduce this expression to at most 64 terms and 16 nested levels.')
  whitespace()
  if(take('(')){const result=expression(0,depth+1);expect(')');return result}
  const call=/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/.exec(text.slice(position))
  if(call) {
   const name=call[1];word();expect('(')
   if(name==='timeshift') {
    const child=expression(0,depth+1);expect(',');expect('-');const seconds=-positiveSeconds();expect(')')
    return {kind:'timeshift',seconds,expression:child}
   }
   if(!rates.has(name))unsupported(`Function ${name} is unsupported. Use timeshift(expression, -seconds) or a supported rate function around one selector.`)
   const child=expression(0,depth+1);expect(')')
   if(child.kind!=='selector'||child.rate)unsupported('Rate functions require one metric selector with at most one explicit rollup and no other rate function.')
   child.rate=name as MetricRate;return child
  }
  const number=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(position))?.[0]
  if(number){position+=number.length;const value=Number(number);if(!Number.isFinite(value))unsupported('Arithmetic constants must be finite numbers.');return {kind:'number',value}}
  return selector()
 }
 const expression=(minimum:number,depth:number):MetricExpression=>{
  let left=primary(depth)
  while(true) {
   whitespace();const operator=text[position],precedence=operator==='+'||operator==='-'?1:operator==='*'||operator==='/'?2:0
   if(!precedence||precedence<minimum)break
   if(++nodes>64)unsupported('Use at most 64 terms in one expression.')
   position++;const right=expression(precedence+1,depth+1)
   left={kind:'arithmetic',operator:operator as '+'|'-'|'*'|'/',left,right}
  }
  return left
 }
 const parsed=expression(0,0);whitespace()
 if(position!==text.length)unsupported(`Unsupported syntax at character ${position+1}. Use exact tag filters, grouping, explicit rollups, rate functions, arithmetic and timeshift(expression, -seconds).`)
 if(!selectors.length)unsupported('Include at least one metric selector.')
 if(selectors.some(item=>item.groupBy.join(',')!==selectors[0].groupBy.join(',')))unsupported('Arithmetic requires the same group dimensions on every selector; implicit group broadcasting is unsupported.')
 const parameters:Parameters={signal:'metrics'}
 if(selectors.every(item=>item.metric===selectors[0].metric))parameters.metric=selectors[0].metric
 for(const key of ['service','environment','team'] as const) {
  const value=selectors[0].filters[key]
  if(value!==undefined&&selectors.every(item=>item.filters[key]===value))parameters[key]=value
 }
 return {parameters,metricQuery:{version:1,dialect:'datadog-metrics',expression:parsed,selectors,semantics:{alignment:'exact-timestamp-unless-explicit-rollup',missing:'null-no-interpolation',sourceParity:'unproved'}}}
}

export function metricRange(range:MetricTimeRange):{from:bigint;through:bigint} {
 const parse=(value:string)=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n)reject('invalid_metric_query_range','Supply explicit unsigned nanosecond from and through timestamps.','from');return BigInt(value)}
 const from=parse(range.from),through=parse(range.through)
 if(from>through)reject('invalid_metric_query_range','From must be no later than through.','from')
 return {from,through}
}
/** Reader must authorize every selector's explicit scope independently, then
 * read this union window under the unchanged native permission fence and snapshot.
 * Rates deliberately have no unbounded predecessor lookback. */
export function metricReadRange(plan:MetricQueryPlan,range:MetricTimeRange):MetricTimeRange {
 const requested=metricRange(range);let earliest=requested.from,latest=requested.through
 const visit=(node:MetricExpression,shift:bigint)=>{
  if(node.kind==='timeshift')return visit(node.expression,shift+BigInt(node.seconds)*1000000000n)
  if(node.kind==='arithmetic'){visit(node.left,shift);visit(node.right,shift);return}
  if(node.kind==='selector'){earliest=earliest<requested.from+shift?earliest:requested.from+shift;latest=latest>requested.through+shift?latest:requested.through+shift}
 }
 visit(plan.expression,0n)
 if(earliest<0n)reject('invalid_metric_query_range','The requested timeshift precedes the Unix epoch.','from')
 return {from:earliest.toString(),through:latest.toString()}
}
