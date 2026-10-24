import type {Bindings} from '../../auth.server'
import {attributes} from '../ingest/normalize'
import {canonical} from '../ingest/model'
import type {Point,WidgetRecord} from './widgets'
import {readTelemetry} from '../ingest/read'
import {fail,scopeWithin,type Scope} from '../security/authority'
import {dashboardBody,scopeLabel,timestamp,type DashboardRow,type Panel} from './model'
export interface PanelResult {panel:Panel;value:number|null;state:'empty'|'complete'|'partial'|'stale'|'error';count:number;query:string;error?:string;values:number[];unit?:string;points?:Point[];records?:WidgetRecord[];from?:string;through?:string;comparison?:PanelResult}
export async function dashboardResults(request:Request,env:Bindings,row:DashboardRow):Promise<PanelResult[]> {
 const body=dashboardBody(JSON.parse(row.body)),params=new URL(request.url).searchParams
 const team=scopeLabel(params.get('team')??body.variables.team),environment=scopeLabel(params.get('environment')??body.variables.environment)
 const from=timestamp(params.get('from')??body.range.from),through=timestamp(params.get('through')??body.range.through)
 if(BigInt(from)>BigInt(through))fail('invalid_dashboard_range',400)
 const scope=JSON.parse(row.scope) as Scope
 const results=await Promise.all(body.panels.map(async panel=>{
  if(!scopeWithin({services:[panel.service],teams:[team],environments:[environment]},scope))fail('dashboard_variable_scope_forbidden')
  const query=new URLSearchParams({signal:panel.signal,service:panel.service,team,environment,from,through})
  if(panel.metric)query.set('metric',panel.metric)
  if(panel.widget==='notes')return {panel,value:null,state:'complete' as const,count:0,query:'',values:[],points:[],records:[],from,through}
  const records:WidgetRecord[]=[],values:number[]=[],points:Point[]=[]
  let cursor:string|null=null,snapshot:number|undefined,partial=false,reference=''
  for(let page=0;page<10;page++) {
   const url=new URL('/api/porthole/v1/ingest/records',request.url);url.search=query.toString();url.searchParams.set('limit','200')
   if(cursor)url.searchParams.set('cursor',cursor)
   if(snapshot!==undefined)url.searchParams.set('snapshot',String(snapshot))
   const response=await readTelemetry(new Request(url,{headers:request.headers}),env)
   if(!response.ok)return {panel,value:null,state:'error' as const,count:0,values:[],query:'/app/explore?'+query,error:String((await response.json() as {error:string}).error)}
   const result=await response.json() as {records:WidgetRecord[];snapshot:number;cursor:string|null;queryRef:string}
   records.push(...result.records.filter(row=>panel.signal!=='metrics'||(row.payload as unknown as {metric:{name:string}}).metric.name===panel.metric));snapshot=result.snapshot;cursor=result.cursor;reference=result.queryRef
   if(!cursor)break
   partial=page===9
  }
  for(const row of records) {
   const payload=row.payload as {record:Record<string,unknown>},r=payload.record
   const v=panel.signal==='traces'?Number(BigInt(String(r.endTimeUnixNano))-BigInt(String(r.startTimeUnixNano)))/1e6:panel.signal==='metrics'?Number(r.asDouble??r.asInt):1
   if(!Number.isFinite(v))return {panel,value:null,state:'error' as const,count:records.length,query:'/app/explore?'+query,values:[],error:'unsupported_metric_point_use_scalar_gauge_or_sum'}
   {values.push(v);const resource=(payload as unknown as {resource?:{attributes?:unknown}}).resource;const identity={...attributes(resource?.attributes),...attributes(r.attributes)};points.push({timeNs:String(row.event_time_ns),value:v,series:Object.keys(identity).length?canonical(identity):panel.service})}
  }
  const ranked=[...values].sort((a,b)=>a-b)
  const units=new Set(records.filter(row=>panel.signal==='metrics').map(row=>String((row.payload as unknown as {metric:{unit?:string}}).metric.unit??'')))
  const unit=panel.signal==='metrics'?(units.values().next().value??panel.unit):panel.signal==='traces'?'ms':'records'
  if(units.size>1||panel.signal==='metrics'&&panel.unit&&panel.unit!==unit)return {panel,value:null,state:'error' as const,count:records.length,query:'/app/explore?'+query,values:[],error:'incompatible_metric_units'}
  const value=partial?null:!records.length?null:panel.aggregate==='count'?records.length:panel.aggregate==='p95'?ranked[Math.max(0,Math.ceil(ranked.length*.95)-1)]??null:values.length?values.reduce((total,value)=>total+value/values.length,0):null
  if(value!==null&&!Number.isFinite(value))return {panel,value:null,state:'error' as const,count:records.length,query:'/app/explore?'+query,values:[],error:'numeric_range_too_wide'}
  const stale=records.length>0&&Date.now()-Number(BigInt(String(records.at(-1)!.event_time_ns))/1000000n)>600000
  return {panel,value,state:partial?'partial':!records.length?'empty':stale?'stale':'complete',count:records.length,query:'/app/explore?'+query+'&snapshot='+snapshot,values,unit,reference,points,records,from,through} as PanelResult
 })) as PanelResult[]
 const compared=body.panels.filter(panel=>panel.compareWeek)
 if(compared.length) {
  const week=604800000000000n
  if(BigInt(from)<week)fail('week_comparison_before_unix_epoch',400)
  const previousUrl=new URL(request.url);previousUrl.searchParams.set('from',String(BigInt(from)-week));previousUrl.searchParams.set('through',String(BigInt(through)-week))
  const prior=await dashboardResults(new Request(previousUrl,{headers:request.headers}),env,{...row,body:JSON.stringify({...body,panels:compared.map(panel=>({...panel,compareWeek:false}))})})
  for(const result of results)result.comparison=prior.find(previous=>previous.panel.id===result.panel.id)
 }
 return results
}
