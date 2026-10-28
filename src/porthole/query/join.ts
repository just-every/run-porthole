import {reject,type Parameters} from '../explore/model'
import type {JoinPlan} from '../explore/join'

export interface JoinRecord extends Record<string,unknown> {
 id:string;signal:string;service:string;environment:string;team:string
 event_time_ns:string;trace_id:string|null
}
export interface JoinPair {
 id:string;left:JoinRecord;right:JoinRecord
 references:{logId:string;traceRecordId:string;traceId:string}
}
export interface JoinExploration {parameters:Parameters;join:JoinPlan;source:{dialect:string;text:string}}
export type JoinRead=(parameters:Parameters,options?:{source?:{dialect:string;text:string};recordSnapshot?:boolean})=>Promise<Response>
interface ReadPage extends Record<string,unknown> {
 snapshot:number;from:string;through:string;records:JoinRecord[];cursor:string|null
}
const maxCandidates=20,maxRightRows=200,maxPairs=200,rightPageLimit=100
function unavailable(hint:string):never {return reject('join_read_incomplete',hint)}
function ns(value:unknown):bigint {
 if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n)unavailable('A join read did not return a valid nanosecond time boundary; no join result is complete.')
 return BigInt(value)
}
function page(value:unknown):ReadPage {
 if(!value||typeof value!=='object'||Array.isArray(value))unavailable('A join read did not return an object page.')
 const output=value as ReadPage
 if(!Array.isArray(output.records)||!Number.isSafeInteger(output.snapshot)||output.snapshot<0||output.cursor!==null&&(typeof output.cursor!=='string'||!output.cursor))unavailable('A join read requires records, a fixed snapshot and a nonempty cursor or null.')
 if(ns(output.from)>ns(output.through))unavailable('A join read returned an inverted time range.')
 return output
}
function validateRow(row:JoinRecord,signal:string,range:ReadPage):void {
 if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||row.signal!==signal)unavailable('A join read returned an invalid record identity or signal.')
 for(const key of ['service','environment','team'] as const)if(typeof row[key]!=='string'||!row[key])unavailable('Join records require explicit service, environment and team scopes.')
 const time=ns(row.event_time_ns)
 if(time<ns(range.from)||time>ns(range.through))unavailable('A join read returned a record outside its fixed time range.')
 if(row.trace_id!==null&&(typeof row.trace_id!=='string'||!/^[a-f0-9]{32}$/.test(row.trace_id)||/^0+$/.test(row.trace_id)))unavailable('A retained join key is not a valid trace ID.')
}

/** Reads only through the caller's authorized native reader. The caller owns
 * authorization for both signals, retention and export fences, final actor revision and
 * cancellation, deadline and run revision checks before releasing this response.
 * A callback MUST call readTelemetry directly, never executeQuery recursively.
 */
export async function executeJoinQuery(normalized:JoinExploration,read:JoinRead):Promise<Response> {
 const parameters=normalized.parameters,plan=normalized.join,deadline=Date.now()+10000
 const checkDeadline=()=>{if(Date.now()>=deadline)reject('join_query_timeout','The bounded join exceeded its 10-second deadline. Narrow its scope or time range; no late result was returned.')}
 if(plan.version!==1||plan.left!=='logs'||plan.right!=='traces'||plan.key!=='trace_id'||plan.semantics!=='retained-same-scope-and-time')reject('unsupported_join_plan','Use the documented retained log-to-trace correlation plan.')
 if(parameters.signal!=='logs'||parameters.metric!==undefined||parameters.trace!==undefined)reject('conflicting_query_filter','A log-to-trace join starts with logs and does not accept native metric or trace filters.')
 const scan=Number(parameters.scanLimit??Math.min(Number(parameters.limit??maxCandidates),maxCandidates))
 if(!Number.isSafeInteger(scan)||scan<1||scan>maxCandidates)reject('join_candidate_limit','Choose a scanLimit between 1 and 20 log candidates per page.','scanLimit')
 const leftResponse=await read({...parameters,signal:'logs',limit:maxCandidates,scanLimit:scan},{source:normalized.source})
 checkDeadline()
 if(!leftResponse.ok)return leftResponse
 const left=page(await leftResponse.json())
 if(parameters.snapshot!==undefined&&Number(parameters.snapshot)!==left.snapshot||parameters.from!==undefined&&ns(String(parameters.from))!==ns(left.from)||parameters.through!==undefined&&ns(String(parameters.through))!==ns(left.through))unavailable('The log read changed the requested snapshot or time range.')
 const reportedLeftCoverage=left.coverage as {state?:unknown}|undefined
 if(reportedLeftCoverage?.state!==undefined&&reportedLeftCoverage.state!=='complete'&&reportedLeftCoverage.state!=='partial'||reportedLeftCoverage?.state==='partial'&&!left.cursor)unavailable('The log page is incomplete without a resumable continuation; no complete join was returned.')
 if(left.records.length>scan)unavailable('The left read exceeded the bounded log candidate page.')
 const pairs:JoinPair[]=[],unknown:{logId:string;traceId:string|null;availability:'Unknown';reason:string}[]=[]
 const cached=new Map<string,JoinRecord[]>(),leftIds=new Set<string>()
 let rightRows=0,rightReads=0,withoutTraceId=0
 for(const log of left.records) {
  validateRow(log,'logs',left)
  if(leftIds.has(log.id))unavailable('The left read returned duplicate log identities.')
  leftIds.add(log.id)
  for(const key of ['service','environment','team'] as const)if(parameters[key]!==undefined&&parameters[key]!==log[key])unavailable('The left read returned a record outside the selected native scope.')
  if(log.trace_id===null) {
   withoutTraceId++;unknown.push({logId:log.id,traceId:null,availability:'Unknown',reason:'The retained log has no trace ID; no trace lookup was made.'});continue
  }
  const key=JSON.stringify([log.service,log.environment,log.team,log.trace_id])
  let traces=cached.get(key)
  if(!traces) {
   checkDeadline()
   const limit=Math.min(rightPageLimit,maxRightRows-rightRows)
   if(limit<1)reject('join_right_row_limit','The join exhausted its 200 retained trace row budget before all keys were checked. Narrow its log scope or time range.')
   const response=await read({signal:'traces',trace:log.trace_id,service:log.service,environment:log.environment,team:log.team,from:left.from,through:left.through,snapshot:left.snapshot,limit},{recordSnapshot:false})
   checkDeadline()
   if(!response.ok)return response
   const right=page(await response.json());rightReads++
   if(right.snapshot!==left.snapshot||ns(right.from)!==ns(left.from)||ns(right.through)!==ns(left.through))unavailable('The trace read changed the left snapshot or time range; no cross-window pairing was released.')
   const coverage=right.coverage as {state?:unknown}|undefined
   if(right.cursor!==null||coverage?.state!==undefined&&coverage.state!=='complete')unavailable('A trace lookup is incomplete. Narrow the time range so every trace lookup fits one bounded page; no partial join was returned.')
   if(right.records.length>limit||rightRows+right.records.length>maxRightRows)reject('join_right_row_limit','The join exceeds 200 retained trace rows across its bounded page. Narrow the log scope or time range.')
   rightRows+=right.records.length;const ids=new Set<string>()
   for(const trace of right.records) {
    validateRow(trace,'traces',right)
    if(trace.trace_id!==log.trace_id||trace.service!==log.service||trace.environment!==log.environment||trace.team!==log.team)unavailable('A trace lookup returned a different correlation key or native scope.')
    if(ids.has(trace.id))unavailable('A trace lookup returned duplicate trace record identities.')
    ids.add(trace.id)
   }
   traces=right.records;cached.set(key,traces)
  }
  if(!traces.length)unknown.push({logId:log.id,traceId:log.trace_id,availability:'Unknown',reason:'No retained trace row is available in the identical scope, time range and snapshot. Sampling, retention and health cannot be inferred.'})
  for(const trace of traces) {
   if(pairs.length>=maxPairs)reject('join_pair_limit','The join exceeds 200 pairs in one log candidate page. Narrow its scope or time range.')
   pairs.push({id:JSON.stringify([log.id,trace.id]),left:log,right:trace,references:{logId:log.id,traceRecordId:trace.id,traceId:log.trace_id}})
  }
 }
 const leftCoverage=left.coverage as {scannedCandidates?:unknown;scannedPayloadBytes?:unknown}|undefined
 checkDeadline()
 return Response.json({...left,source:normalized.source,parameters,plan,records:pairs,joinResult:{kind:'inner',pairs:pairs.length,availability:unknown,coverage:'retained-only',healthInference:'none'},coverage:{state:left.cursor?'partial':'complete',reason:left.cursor?'log_candidate_page':null,scannedCandidates:leftCoverage?.scannedCandidates??left.records.length,matchedRecords:pairs.length,...(leftCoverage?.scannedPayloadBytes===undefined?{}:{scannedPayloadBytes:leftCoverage.scannedPayloadBytes}),leftRecords:left.records.length,rightReads,rightRows,logsWithoutTraceId:withoutTraceId,retainedOnly:true,missingRightAvailability:'Unknown'},diagnostics:[{code:'retained_correlation_only',message:'INNER correlation includes retained same-scope rows at one snapshot and time range. A missing trace remains Unknown and is never evidence of a healthy service or complete sampling.'}]},{headers:leftResponse.headers})
}
