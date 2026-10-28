import {promql} from './promql'
import {sql} from './sql'
import {lucene} from './lucene'
import {datadogMetrics} from './datadog-metrics'
import {compileLogSearch,LogSearchError} from '../../../workers/analytics/log-search.mjs'
import {metricName,reject,type Dialect,type NormalizedExploration,type Parameters,type ParsedExpression} from './model'
export {ExplorationError} from './model'
export type {Aggregate,Dialect,NormalizedExploration,Parameters,LogSearchPlan} from './model'

const nativeKeys=['signal','service','environment','team','from','through','cursor','limit','snapshot','trace','metric','scanLimit']
const optional=new Set(['metric','from','through','cursor','snapshot','trace','limit','scanLimit'])
export function normalizeExploration(input:Record<string,unknown>):NormalizedExploration {
 if(!input||typeof input!=='object'||Array.isArray(input))reject('invalid_exploration','Supply a query object.','query')
 if(Object.keys(input).some(key=>!nativeKeys.includes(key)&&!['dialect','expression'].includes(key)))reject('unsupported_query_filter','Remove unsupported query fields.','query')
 const dialect=input.dialect===undefined?'visual':input.dialect
 if(typeof dialect!=='string'||!['visual','promql','sql','lucene','datadog'].includes(dialect))reject('unsupported_exploration_dialect','Choose visual, promql, sql, lucene or datadog.','dialect')
 const expression=input.expression===undefined?'':input.expression
 if(typeof expression!=='string'||expression.length>2048||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(expression))reject('invalid_exploration_expression','Expressions must be text of at most 2048 characters with no control characters.')
 const parameters:Parameters={}
 for(const key of nativeKeys) {
  const value=input[key]
  if(value===undefined||value===''&&optional.has(key))continue
  if(typeof value!=='string'&&typeof value!=='number'||typeof value==='number'&&!Number.isFinite(value))reject('invalid_query_filter','Native query fields must contain a string or finite number.',key)
  if(key==='metric'&&typeof value!=='string')reject('invalid_metric_name','Metric names must be text.','metric')
  parameters[key]=value
 }
 if(typeof parameters.metric==='string')metricName(parameters.metric)
 if(dialect==='visual') {
  if(expression.trim())reject('unexpected_visual_expression','Select a text dialect to execute an expression.')
  return {parameters,source:{dialect,text:expression}}
 }
 if(!expression.trim())reject('exploration_expression_required','Enter an expression for the selected dialect.')
 const parsed:ParsedExpression=dialect==='datadog'?datadogMetrics(expression):dialect==='promql'?promql(expression):dialect==='sql'?sql(expression):lucene(expression)
 for(const [key,value] of Object.entries(parsed.parameters)) {
  if(Object.hasOwn(parameters,key)&&parameters[key]!==value)reject('conflicting_query_filter','Native and expression filters must select the same exact value.',key)
  parameters[key]=value
 }
 if(parameters.metric!==undefined&&parameters.signal!=='metrics')reject('conflicting_query_filter','The metric filter applies only to metrics.','metric')
 if(parsed.aggregate==='average'&&!parameters.metric)reject('metric_selection_required','AVG(value) requires one exact metric filter.','metric')
 if(parsed.logSearch) {
  try {compileLogSearch(parsed.logSearch,{services:[String(parameters.service??'*')],environments:[String(parameters.environment??'*')],teams:[String(parameters.team??'*')]})}
  catch(error) {if(error instanceof LogSearchError)reject('conflicting_query_filter','Native and expression scope filters must select compatible values.',error.field);throw error}
 }
 return {parameters,source:{dialect:dialect as Dialect,text:expression},...(parsed.aggregate?{aggregate:parsed.aggregate}:{}),...(parsed.logSearch?{logSearch:parsed.logSearch}:{}),...(parsed.metricQuery?{metricQuery:parsed.metricQuery}:{}),...(parsed.join?{join:parsed.join}:{})}
}
