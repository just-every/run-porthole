import type {Bindings} from '../../auth.server'
import type {NormalizedExploration} from '../explore/model'
import {reject} from '../explore/model'
import {metricReadRange} from '../explore/datadog-metrics'
import {fail} from '../security/authority'
import {readTelemetry} from '../ingest/read'
import {privateHeaders} from '../document'
import {queryActor} from './access'
/** This estimates the authorized candidate work, before evaluating predicates.
 * The hard measurement cap makes a larger corpus an explicit lower bound. */
export async function estimateQuery(request:Request,env:Bindings,normalized:NormalizedExploration){
 const actor=await queryActor(request,env),parameters={...normalized.parameters}
 if(normalized.metricQuery){
  for(const selector of normalized.metricQuery.selectors)for(const[field,key]of [['service','services'],['environment','environments'],['team','teams']]as const){const value=selector.filters[field];if(value!==undefined&&!actor.scope[key].includes('*')&&!actor.scope[key].includes(value))fail('scope_forbidden');if(value!==undefined&&parameters[field]!==undefined&&parameters[field]!==value)reject('conflicting_query_filter','Every metric selector must agree with the explicit native scope.',field)}
  Object.assign(parameters,metricReadRange(normalized.metricQuery,{from:String(parameters.from??''),through:String(parameters.through??'')}))
 }
 if(normalized.join&&!actor.signals.includes('traces'))fail('credential_scope_forbidden')
 const url=new URL('/api/porthole/v1/ingest/records',request.url)
 for(const[key,value]of Object.entries(parameters))url.searchParams.set(key,String(value))
 const response=await readTelemetry(new Request(url,{headers:request.headers}),env,{estimateOnly:true,logSearch:normalized.logSearch,source:normalized.source})
 if(!response.ok)return response
 const result=await response.json()as Record<string,unknown>
 return Response.json({source:normalized.source,parameters:normalized.parameters,plan:normalized.metricQuery??normalized.join??normalized.logSearch??{version:1,kind:'record-selection',parameters:normalized.parameters},...result,...(normalized.join?{joinBounds:{leftCandidatesPerPage:20,rightRowsPerLookup:100,totalRightRowsPerPage:200,totalPairsPerPage:200}}:{})},{headers:{...privateHeaders,...Object.fromEntries(response.headers)}})
}
