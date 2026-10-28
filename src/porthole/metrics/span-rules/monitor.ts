import type {Bindings} from '../../../auth.server'
import {fail,scopeWithin,type Scope} from '../../security/authority'
import {scope,type Definition} from './model'

export interface MetricSelection {id:string;revision:number;aggregation:'count'|'sum'|'min'|'max'|'p50'|'p95'|'p99'}
export function metricSelection(value:unknown):MetricSelection {
 const d=value as MetricSelection
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).sort().join(',')!=='aggregation,id,revision'||typeof d.id!=='string'||!/^[a-f0-9-]{36}$/.test(d.id)||!Number.isSafeInteger(d.revision)||d.revision<1||!['count','sum','min','max','p50','p95','p99'].includes(d.aggregation))fail('invalid_metric_selection',400)
 return {...d}
}
export async function metricForScope(env:Bindings,selection:MetricSelection,held:Scope) {
 const rule=await env.DB.prepare("SELECT definition,from_sequence FROM porthole_metric_rules WHERE id=? AND revision=? AND state='active'").bind(selection.id,selection.revision).first<{definition:string;from_sequence:number}>()
 if(!rule)fail('metric_rule_unavailable',409)
 const d=JSON.parse(rule.definition) as Definition
 if(!scopeWithin(scope(d),held))fail('metric_scope_forbidden')
 return {d,fromSequence:rule.from_sequence}
}
/** A monitor consumes its pinned custom rule, never unrelated RED counts. */
export async function monitorMetric(env:Bindings,selection:MetricSelection,held:Scope,from:string,through:string) {
 const {d,fromSequence}=await metricForScope(env,selection,held)
 const results=await env.DB.batch([
  env.DB.prepare(`WITH ranked AS (SELECT value,dimensions,ROW_NUMBER() OVER(ORDER BY value,batch_id,ordinal) AS position,COUNT(*) OVER() AS n FROM porthole_metric_points WHERE rule_id=? AND revision=? AND event_time_ns>=? AND event_time_ns<?)
   SELECT COUNT(*) AS count,COUNT(value) AS valid,SUM(value) AS sum,MIN(value) AS min,MAX(value) AS max,SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(dimensions) WHERE value='[other]') THEN 1 ELSE 0 END) AS unknown_dimensions,
   MAX(CASE WHEN position=CAST((n*50+99)/100 AS INTEGER) THEN value END) AS p50,MAX(CASE WHEN position=CAST((n*95+99)/100 AS INTEGER) THEN value END) AS p95,MAX(CASE WHEN position=CAST((n*99+99)/100 AS INTEGER) THEN value END) AS p99 FROM ranked`).bind(selection.id,selection.revision,from,through),
  env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_events WHERE signal='traces' AND service=? AND environment=? AND team=? AND kind IN ('source_loss','buffer_loss','rejected') AND (range_start_ns IS NULL OR range_start_ns<? AND range_end_ns>=?)").bind(d.service,d.environment,d.team,through,from),
  env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.signal='traces' AND b.state='pending' AND b.sequence>=? AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.team')=? AND json_extract(j.value,'$.eventTimeNs')>=? AND json_extract(j.value,'$.eventTimeNs')<? AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted')=?").bind(fromSequence,d.service,d.environment,d.team,from,through,d.inputStage),
 ])
 const row=results[0].results[0] as {count:number;valid:number;unknown_dimensions:number;[key:string]:number|null}
 const complete=d.upstream==='complete'&&row.count>0&&row.count===row.valid&&!row.unknown_dimensions&&!Number((results[1].results[0] as {n:number}).n)&&!Number((results[2].results[0] as {n:number}).n)
 return {complete,value:complete?row[selection.aggregation]:null,selection,inputStage:d.inputStage,upstream:d.upstream,independentlyVerified:false}
}
