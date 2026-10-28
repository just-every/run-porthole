import type {Bindings} from '../../auth.server'
import {normalizeExploration} from '../explore/normalize'
import {fail} from '../security/authority'
import {privateHeaders} from '../document'
import {readTelemetry} from '../ingest/read'
import {aggregateRows} from './aggregate'
import {executeMetricQuery} from './metric-execute'
import {executeJoinQuery,type JoinRead} from './join'
import {queryActor} from './access'
export const queryKeys=['dialect','expression','signal','service','environment','team','from','through','cursor','limit','snapshot','trace','metric','scanLimit']
export async function executeQuery(request:Request,env:Bindings,data:Record<string,unknown>,options:{exportOnly?:boolean}={}) {
 const started=performance.now()
 const normalized=normalizeExploration(data),url=new URL('/api/porthole/v1/ingest/records',request.url)
 if(normalized.metricQuery)return executeMetricQuery(request,env,normalized,options)
 if(normalized.join){
  const actor=await queryActor(request,env)
  const read:JoinRead=(parameters,extra={})=>{
   const url=new URL('/api/porthole/v1/ingest/records',request.url)
   for(const[key,value]of Object.entries(parameters))url.searchParams.set(key,String(value))
   return readTelemetry(new Request(url,{headers:request.headers}),env,{...options,...extra})
  }
  const response=await executeJoinQuery({...normalized,join:normalized.join},read)
  if(!response.ok)return response
  const latest=await queryActor(request,env)
  if(latest.id!==actor.id||latest.revision!==actor.revision||JSON.stringify(latest.scope)!==JSON.stringify(actor.scope)||!await env.DB.prepare(`SELECT 1 AS live WHERE ${latest.fence}`).bind(...latest.args).first())fail('authority_changed',409)
  const result=await response.json()as Record<string,unknown>
  return Response.json({...result,queryRef:result.queryRef,replay:'/api/porthole/v1/query/'+result.queryRef},{headers:response.headers})
 }
 for(const [key,value]of Object.entries(normalized.parameters)){
  if(!queryKeys.includes(key)||!['string','number'].includes(typeof value))fail('invalid_query',400)
  url.searchParams.set(key,String(value))
 }
 const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{...options,logSearch:normalized.logSearch,source:normalized.source})
 if(!response.ok)return response
 const rows=await response.json() as Record<string,unknown>,reference=String(rows.queryRef)
 if(normalized.parameters.cursor!==undefined)rows.resumed=true
 const result={source:normalized.source,parameters:normalized.parameters,plan:normalized.logSearch??{version:1,kind:'record-selection',parameters:normalized.parameters},...rows,statistics:{elapsedMs:performance.now()-started,returnedRecords:(rows.records as unknown[]).length,...(rows.coverage?{coverage:rows.coverage}:{})},...(normalized.aggregate?{aggregate:aggregateRows(normalized.aggregate,rows)}:{}),queryRef:reference,replay:`/api/porthole/v1/query/${reference}`}
 return Response.json(result,{headers:{...privateHeaders,...Object.fromEntries([...response.headers].filter(([key])=>key.startsWith('x-porthole-'))),'x-porthole-entity':reference}})
}
export async function snapshotInput(env:Bindings,id:string,actorRef?:string) {
 const previous=await env.DB.prepare('SELECT * FROM porthole_query_snapshots WHERE id=?'+(actorRef?' AND actor_ref=?':'')).bind(id,...(actorRef?[actorRef]:[])).first<{scope:string;signal:string;from_ns:string;through_ns:string;through_batch:number}>()
 if(!previous)fail('query_not_found',404)
 return {...JSON.parse(previous.scope),signal:previous.signal,snapshot:previous.through_batch,...(previous.from_ns?{from:previous.from_ns}:{}),...(previous.through_ns?{through:previous.through_ns}:{})} as Record<string,unknown>
}
