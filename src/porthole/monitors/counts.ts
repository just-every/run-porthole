import type {Bindings} from '../../auth.server'
import {configuration,selected,query,watermark} from '../analytical/client'
import type {Scope} from '../security/authority'
import {scopeWhere} from '../ingest/read'
import {groupKey,ns,type Definition,type Dimension} from './model'
type CountRow={count:number}&Partial<Record<Dimension,string>>
export async function countWindows(env:Bindings,definition:Definition,scope:Scope,now:number) {
 const config=await configuration(env),separate=selected(env,config),snapshot=await watermark(env),where=scopeWhere(scope),through=ns(now)
 const windows=[]
 for(const windowSeconds of [...definition.windows,0]) {
  const from=windowSeconds?ns(now-windowSeconds*1000):'00000000000000000000'
  const columns=definition.groupBy.map(key=>'r.'+key)
  const rows=separate?await query(env,config,{mode:'groups',groupBy:definition.groupBy,signal:definition.signal,scope,from,through,snapshot}):null
  const local=rows?null:await env.DB.prepare(`SELECT ${columns.length?columns.join(',')+',':''}COUNT(*) AS count FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.state='complete' AND b.completion_sequence<=? AND r.signal=? AND r.event_time_ns>=? AND r.event_time_ns<=? AND ${where.sql}${columns.length?' GROUP BY '+columns.join(','):''} LIMIT 101`).bind(snapshot,definition.signal,from,through,...where.args).all<CountRow>()
  const groups=rows?.groups??local!.results
  if(rows&&!rows.complete||groups.length>100)throw Error('monitor_group_budget_exceeded')
  windows.push({windowSeconds,counts:new Map(groups.map(row=>[groupKey(row,definition.groupBy),row.count])),labels:groups.map(row=>Object.fromEntries(definition.groupBy.map(key=>[key,row[key]])) as Partial<Record<Dimension,string>>)})
 }
 const widest=ns(now-Math.max(...definition.windows)*1000)
 const uncertain=separate?await query(env,config,{signal:definition.signal,scope,from:widest,through,mode:'count',uncertain:true,snapshot}):await env.DB.prepare(`SELECT COUNT(*) AS count FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.state='complete' AND b.completion_sequence<=? AND r.signal=? AND json_extract(r.payload,'$.delivery.uncertainTime')=1 AND printf('%020d',CAST(json_extract(r.payload,'$.delivery.receivedTimeUnixNano') AS INTEGER)) BETWEEN ? AND ? AND ${where.sql}`).bind(snapshot,definition.signal,widest,through,...where.args).first<{count:number}>()
 return {windows:windows.filter(window=>window.windowSeconds!==0),seen:new Set([...windows.find(window=>window.windowSeconds===0)!.counts].filter(([,count])=>count>0).map(([key])=>key)),snapshot,uncertain:!!uncertain?.count}
}
