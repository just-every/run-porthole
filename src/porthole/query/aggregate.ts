import {fail} from '../security/authority'
import type {Aggregate} from '../explore/model'
export function aggregateRows(kind:Aggregate,result:Record<string,unknown>) {
 const records=result.records as {payload:{record:Record<string,unknown>;metric?:{unit?:string}}}[],partial=!!result.cursor
 const state=partial?'partial':records.length?'complete':'empty'
 if(kind==='count')return {kind,value:partial?null:records.length,state,unit:'records',count:records.length}
 const values=records.map(row=>kind==='p95'?Number(BigInt(String(row.payload.record.endTimeUnixNano))-BigInt(String(row.payload.record.startTimeUnixNano)))/1e6:Number(row.payload.record.asDouble??row.payload.record.asInt))
 if(values.some(value=>!Number.isFinite(value)))fail('non_numeric_query_values',400)
 const units=new Set(records.map(row=>row.payload.metric?.unit??''))
 if(kind==='average'&&units.size>1)fail('incompatible_metric_units',400)
 const ordered=[...values].sort((a,b)=>a-b),unit=kind==='p95'?'ms':units.values().next().value??''
 return {kind,value:partial||!values.length?null:kind==='p95'?ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]:values.reduce((a,b)=>a+b,0)/values.length,state,unit,count:records.length}
}
