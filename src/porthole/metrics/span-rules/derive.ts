import type { Bindings } from '../../../auth.server'
import type { Definition } from './model'
import {expression,predicateSql} from './fields'
// All SQL fragments below come from validated definitions. Owner literals stay
// bound parameters. Points and the retained batch transition commit together.
export async function contributions(env:Bindings,batchId:string):Promise<D1PreparedStatement[]> {
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_metric_rules'").first())return []
 const rules=(await env.DB.prepare("SELECT r.* FROM porthole_metric_rules r JOIN porthole_ingest_batches b ON b.id=? WHERE r.state='active' AND b.signal='traces' AND b.sequence>=r.from_sequence AND NOT EXISTS(SELECT 1 FROM porthole_metric_rules newer WHERE newer.state='active' AND newer.id=r.id AND newer.revision>r.revision AND newer.from_sequence<=b.sequence)").bind(batchId).all<{id:string;revision:number;definition:string}>()).results
 return rules.map(rule=>{
  const d=JSON.parse(rule.definition) as Definition,args:unknown[]=[]
  const groups=d.dimensions.map(g=>{const first=expression(g.key,args);args.push(JSON.stringify(g.values));return `CASE WHEN ${first} IN (SELECT value FROM json_each(?)) THEN ${expression(g.key,args)} ELSE '[other]' END`})
  const dims=groups.length?`json_array(${groups.join(',')})`:"'[]'"
  const raw=d.value==='count'?'1':expression(d.value,args,true)
  const predicates:unknown[]=[],where=d.predicate?predicateSql(d.predicate,predicates):'1'
  const maximum=d.kind==='sum'?1000000000:1000000000000
  return env.DB.prepare(`WITH candidates AS (
   SELECT b.id AS batch_id,CAST(j.key AS INTEGER) AS ordinal,${dims} AS dimensions,${raw} AS value,json_extract(j.value,'$.eventTimeNs') AS event_time_ns,json_extract(j.value,'$.traceId') AS trace_id,json_extract(j.value,'$.spanId') AS span_id
   FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.id=? AND b.state='pending' AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.team')=? AND (?='*' OR json_extract(j.value,'$.payload.record.name')=?) AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted')=? AND (?='any' OR json_extract(j.value,'$.payload.record.status.code') IN (2,'STATUS_CODE_ERROR')) AND ${where})
   INSERT INTO porthole_metric_points(rule_id,revision,batch_id,ordinal,dimensions,value,valid,event_time_ns,trace_id,span_id)
   SELECT ?,?,batch_id,ordinal,dimensions,CASE WHEN typeof(value) IN ('integer','real') AND ABS(value)<=?  THEN value ELSE NULL END,1,event_time_ns,trace_id,span_id FROM candidates WHERE 1 ON CONFLICT DO NOTHING`)
   .bind(...args,batchId,d.service,d.environment,d.team,d.spanName,d.spanName,d.inputStage,d.status,...predicates,rule.id,rule.revision,maximum)
 })
}
