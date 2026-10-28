import type {Bindings} from '../../auth.server'
import {queryResponse} from '../query/http'
import {aggregateRows} from '../query/aggregate'
import {normalizeExploration} from '../explore/normalize'
import {fail} from '../security/authority'
import {queryInput,type QueryCell,type Snapshot} from './model'
import type {WidgetRecord,Point} from '../dashboards/widgets'

export interface QueryResult {state:'complete'|'unavailable';reason?:string;count:number|null;records:WidgetRecord[];points:Point[];unit:string;aggregate?:ReturnType<typeof aggregateRows>}
async function read(request:Request,env:Bindings,query:Record<string,string>,watermark?:number) {
 const records:WidgetRecord[]=[],refs:string[]=[]
 let cursor:string|null=null,snapshot=watermark
 for(let page=0;page<10;page++) {
  const data={...query,limit:200,...(cursor?{cursor}:{}),...(snapshot!==undefined?{snapshot}:{})}
  const headers=new Headers(request.headers);headers.set('content-type','application/json');headers.set('origin',new URL(request.url).origin)
  const response=await queryResponse(new Request(new URL('/api/porthole/v1/query',request.url),{method:'POST',headers,body:JSON.stringify(data)}),env)
  if(!response?.ok)fail('notebook_query_unavailable',response?.status??503)
  const result=await response.json() as {records:WidgetRecord[];snapshot:number;cursor:string|null;queryRef:string}
  records.push(...result.records);refs.push(result.queryRef);snapshot=result.snapshot;cursor=result.cursor
  if(!cursor)return {records,refs,watermark:snapshot!}
 }
 fail('notebook_query_exceeds_2000_records',422)
}
export async function capture(request:Request,env:Bindings,raw:unknown):Promise<{query:Record<string,string>;snapshot:Snapshot}> {
 const query=queryInput(raw),result=await read(request,env,query)
 return {query,snapshot:{watermark:result.watermark,recordIds:result.records.map(row=>row.id),queryRefs:result.refs,capturedAt:Date.now()}}
}
export async function resolveCell(request:Request,env:Bindings,cell:QueryCell,quarantined=false):Promise<QueryResult> {
 const unavailable=(reason:string):QueryResult=>({state:'unavailable',reason,count:null,records:[],points:[],unit:''})
 if(quarantined)return unavailable('Restored context is inactive. A new authorized query is required; sharing and mentions never replay.')
 try {
  const {records}=await read(request,env,cell.query,cell.snapshot.watermark)
  if(JSON.stringify(records.map(row=>row.id))!==JSON.stringify(cell.snapshot.recordIds))return unavailable('Referenced input is missing, erased or outside current authority. Historical results are unavailable.')
  const kind=normalizeExploration(cell.query).aggregate
  if(kind) {
   const aggregate=aggregateRows(kind,{records,cursor:null})
   if(aggregate.value!==null&&!Number.isFinite(aggregate.value))return unavailable('Aggregate numeric range is unavailable; no misleading chart is shown.')
   return {state:'complete',count:records.length,records,points:aggregate.value===null?[]:[{timeNs:cell.query.through,value:aggregate.value,series:kind}],unit:aggregate.unit,aggregate}
  }
  const points=records.map(row=>{
   const r=row.payload.record,signal=cell.query.signal
   const value=signal==='traces'?Number(BigInt(String(r.endTimeUnixNano))-BigInt(String(r.startTimeUnixNano)))/1e6:signal==='metrics'?Number(r.asDouble??r.asInt):1
   if(!Number.isFinite(value))fail('unsupported_notebook_chart_value',422)
   return {timeNs:row.event_time_ns,value,series:cell.query.service}
  })
  const units=new Set(records.filter(()=>cell.query.signal==='metrics').map(row=>String((row.payload as unknown as {metric:{unit?:string}}).metric.unit??'')))
  if(units.size>1)return unavailable('Metric units are incompatible; no combined chart is shown.')
  return {state:'complete',count:records.length,records,points,unit:cell.query.signal==='traces'?'ms':cell.query.signal==='metrics'?[...units][0]??'':'records'}
 }catch {return unavailable('Current authorized telemetry read is unavailable. No detached result copy is retained.')}
}
