import type {Bindings} from '../../auth.server'
import {readTelemetry} from '../ingest/read'
import {fail,scopeWithin,type Scope} from '../security/authority'
import {dashboardBody,scopeLabel,timestamp,type DashboardRow,type Panel} from './model'
export interface PanelResult {panel:Panel;value:number|null;state:'empty'|'complete'|'partial'|'stale'|'error';count:number;query:string;error?:string;values:number[]}
export async function dashboardResults(request:Request,env:Bindings,row:DashboardRow):Promise<PanelResult[]> {
 const body=dashboardBody(JSON.parse(row.body)),params=new URL(request.url).searchParams
 const team=scopeLabel(params.get('team')??body.variables.team),environment=scopeLabel(params.get('environment')??body.variables.environment)
 const from=timestamp(params.get('from')??body.range.from),through=timestamp(params.get('through')??body.range.through)
 if(BigInt(from)>BigInt(through))fail('invalid_dashboard_range',400)
 const scope=JSON.parse(row.scope) as Scope
 return Promise.all(body.panels.map(async panel=>{
  if(!scopeWithin({services:[panel.service],teams:[team],environments:[environment]},scope))fail('dashboard_variable_scope_forbidden')
  const query=new URLSearchParams({signal:panel.signal,service:panel.service,team,environment,from,through})
  const records:Record<string,unknown>[]=[],values:number[]=[]
  let cursor:string|null=null,snapshot:number|undefined,partial=false,reference=''
  for(let page=0;page<10;page++) {
   const url=new URL('/api/porthole/v1/ingest/records',request.url);url.search=query.toString();url.searchParams.set('limit','200')
   if(cursor)url.searchParams.set('cursor',cursor)
   if(snapshot!==undefined)url.searchParams.set('snapshot',String(snapshot))
   const response=await readTelemetry(new Request(url,{headers:request.headers}),env)
   if(!response.ok)return {panel,value:null,state:'error' as const,count:0,values:[],query:'/app/explore?'+query,error:String((await response.json() as {error:string}).error)}
   const result=await response.json() as {records:Record<string,unknown>[];snapshot:number;cursor:string|null;queryRef:string}
   records.push(...result.records.filter(row=>panel.signal!=='metrics'||(row.payload as {metric:{name:string}}).metric.name===panel.metric));snapshot=result.snapshot;cursor=result.cursor;reference=result.queryRef
   if(!cursor)break
   partial=page===9
  }
  for(const row of records) {
   const payload=row.payload as {record:Record<string,unknown>},r=payload.record
   const v=panel.signal==='traces'?Number(BigInt(String(r.endTimeUnixNano))-BigInt(String(r.startTimeUnixNano)))/1e6:panel.signal==='metrics'?Number(r.asDouble??r.asInt):1
   if(Number.isFinite(v))values.push(v)
  }
  values.sort((a,b)=>a-b)
  const value=partial?null:!records.length?null:panel.aggregate==='count'?records.length:panel.aggregate==='p95'?values[Math.max(0,Math.ceil(values.length*.95)-1)]??null:values.length?values.reduce((a,b)=>a+b,0)/values.length:null
  const stale=records.length>0&&Date.now()-Number(BigInt(String(records.at(-1)!.event_time_ns))/1000000n)>600000
  return {panel,value,state:partial?'partial':!records.length?'empty':stale?'stale':'complete',count:records.length,query:'/app/explore?'+query+'&snapshot='+snapshot,values,reference} as PanelResult
 }))
}
