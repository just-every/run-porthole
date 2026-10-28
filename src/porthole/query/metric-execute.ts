import type {Bindings} from '../../auth.server'
import type {NormalizedExploration} from '../explore/model'
import {reject} from '../explore/model'
import {metricReadRange} from '../explore/datadog-metrics'
import {privateHeaders} from '../document'
import {readTelemetry} from '../ingest/read'
import {fail} from '../security/authority'
import {queryActor} from './access'
import {evaluateMetricSeries,type MetricRecord} from './metric-series'
/** Full bounded input is required. A page or exhausted budget is never a value. */
export async function executeMetricQuery(request:Request,env:Bindings,normalized:NormalizedExploration,options:{exportOnly?:boolean}) {
 const plan=normalized.metricQuery!,parameters=normalized.parameters,actor=await queryActor(request,env)
 if(parameters.cursor!==undefined||parameters.scanLimit!==undefined)reject('metric_query_requires_complete_snapshot','Metric evaluation requires one complete bounded snapshot. Narrow its range instead of supplying a cursor or scanLimit.')
 const range={from:String(parameters.from??''),through:String(parameters.through??'')},readRange=metricReadRange(plan,range)
 for(const selector of plan.selectors)for(const [field,key]of [['service','services'],['environment','environments'],['team','teams']]as const){const value=selector.filters[field];if(value!==undefined&&!actor.scope[key].includes('*')&&!actor.scope[key].includes(value))fail('scope_forbidden')
  if(value!==undefined&&parameters[field]!==undefined&&parameters[field]!==value)reject('conflicting_query_filter','Every metric selector must agree with the explicit native scope.',field)
 }
 const records:MetricRecord[]=[],deadline=Date.now()+10000;let cursor:string|null=null,snapshot=parameters.snapshot,analytical:unknown
 do{
  if(Date.now()>=deadline)reject('metric_query_timeout','The complete input exceeded the evaluation deadline. Narrow the range; no partial value was computed.')
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [key,value]of Object.entries({...parameters,...readRange,limit:200,...(snapshot===undefined?{}:{snapshot}),...(cursor?{cursor}:{})}))url.searchParams.set(key,String(value))
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{...options,recordSnapshot:false})
  if(!response.ok)return response
  const page=await response.json()as {records:MetricRecord[];cursor:string|null;snapshot:number;analytical?:unknown}
  snapshot??=page.snapshot;if(Number(snapshot)!==page.snapshot)fail('query_snapshot_changed',409)
  records.push(...page.records);cursor=page.cursor;analytical=page.analytical
  if(records.length>10000||records.length===10000&&cursor)reject('metric_query_record_limit','The complete metric input exceeds 10000 records. Narrow the range; no partial aggregate was returned.')
 }while(cursor)
 const metricResult=evaluateMetricSeries(records,plan,range),latest=await queryActor(request,env)
 if(latest.id!==actor.id||latest.revision!==actor.revision||JSON.stringify(latest.scope)!==JSON.stringify(actor.scope))fail('authority_changed',409)
 if(Date.now()>=deadline)reject('metric_query_timeout','The complete evaluation exceeded its deadline. Narrow the range; no late result was returned.')
 const queryRef=crypto.randomUUID(),scope=JSON.stringify({...Object.fromEntries(Object.entries(parameters).filter(([key])=>['service','environment','team','limit','trace','metric'].includes(key))),dialect:normalized.source.dialect,expression:normalized.source.text})
 const inserted=await env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,'metrics',?,?,?,? WHERE ${latest.fence}`).bind(queryRef,actor.id,scope,range.from.padStart(20,'0'),range.through.padStart(20,'0'),Number(snapshot),Date.now(),...latest.args).run()
 if(!inserted.meta.changes)fail('authority_changed',409)
 return Response.json({source:normalized.source,parameters,plan,metricResult,snapshot,from:range.from,through:range.through,records:[],cursor:null,coverage:{state:'complete',scannedCandidates:records.length,matchedRecords:metricResult.statistics.matchedRecords},...(analytical?{analytical}:{}),queryRef,replay:'/api/porthole/v1/query/'+queryRef},{headers:{...privateHeaders,'x-porthole-entity':queryRef,'x-porthole-actor':actor.id,'x-porthole-actor-revision':String(actor.revision)}})
}
