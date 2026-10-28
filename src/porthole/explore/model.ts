import {AuthError} from '../../modules/operator-auth/index.mjs'
import type {LogSearchPlan} from '../../../workers/analytics/log-search.mjs'
import type {MetricQueryPlan} from './datadog-metrics'
export type {LogSearchPlan} from '../../../workers/analytics/log-search.mjs'

export type Dialect='visual'|'promql'|'sql'|'lucene'|'datadog'
export type Aggregate='average'|'count'|'p95'
export type Parameters=Record<string,string|number>
export interface NormalizedExploration {parameters:Parameters;source:{dialect:Dialect;text:string};aggregate?:Aggregate;logSearch?:LogSearchPlan;metricQuery?:MetricQueryPlan}
export interface ParsedExpression {parameters:Parameters;aggregate?:Aggregate;logSearch?:LogSearchPlan;metricQuery?:MetricQueryPlan}

export class ExplorationError extends AuthError {
 constructor(code:string,readonly field:string,readonly hint:string) {super(code,400)}
}
export function reject(code:string,hint:string,field='expression'):never {
 throw new ExplorationError(code,field,hint)
}
export function metricName(value:string):string {
 if(!value.trim().length||value.length>120||/[\u0000-\u001f\u007f-\u009f]/u.test(value))reject('invalid_metric_name','Select one printable metric name of at most 120 characters.','metric')
 return value
}
export function scopeValue(value:string):string {
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value))reject('unsupported_query_filter','Scope filters require one exact native scope value.')
 return value
}
export function filter(parameters:Parameters,key:string,value:string):void {
 if(!['service','environment','team','metric'].includes(key))reject('unsupported_query_filter','Only service, environment, team and the selected metric equality are supported.')
 if(Object.hasOwn(parameters,key))reject('duplicate_query_filter','Specify each expression filter exactly once.',key)
 parameters[key]=key==='metric'?metricName(value):scopeValue(value)
}
