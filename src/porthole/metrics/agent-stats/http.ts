import type { Bindings } from '../../../auth.server'
import { privateHeaders } from '../../document'
import { readTelemetry } from '../../ingest/read'
import { agentStatsMetric } from './normalize'

/** Reuse the metered telemetry read door, its live custody fence and pagination.
 * Buckets remain deltas; callers must follow cursor before combining a range. */
export async function agentStatsResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!=='/api/porthole/v1/agent-stats')return null
 if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:privateHeaders})
 if([...url.searchParams.keys()].some(key=>!['service','environment','team','from','through','cursor','limit','snapshot'].includes(key)))return Response.json({error:'invalid_query'},{status:400,headers:privateHeaders})
 url.pathname='/api/porthole/v1/ingest/records'
 url.searchParams.set('signal','metrics');url.searchParams.set('metric',agentStatsMetric)
 const response=await readTelemetry(new Request(url,request),env)
 if(!response.ok)return response
 const body=await response.json() as {records:Record<string,unknown>[];cursor:string|null;[key:string]:unknown}
 const {records,...page}=body
 const selected=records.filter(row=>{
  const payload=row.payload as {metricKind?:string;agentStats?:{protocol?:string}}
  return payload.metricKind==='agentStats'&&payload.agentStats?.protocol==='datadog.StatsPayload/v0.2/json'
 })
 return Response.json({...page,temporality:'delta',counts:'exact decimal strings supplied by the source',coverage:{status:'source-asserted',independentlyVerified:false,traceSamplingApplied:false,pageEndsRange:body.cursor===null},stats:selected.map(row=>{
  const payload=row.payload as {record:Record<string,unknown>;agentStats:Record<string,unknown>}
  return {id:row.id,batchId:row.batch_id,sourceId:row.source_id,service:row.service,environment:row.environment,team:row.team,eventTimeNs:row.event_time_ns,group:payload.record,provenance:payload.agentStats}
 })},{headers:response.headers})
}
