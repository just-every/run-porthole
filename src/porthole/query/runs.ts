import type {Bindings} from '../../auth.server'
import {compileLogSearch} from '../../../workers/analytics/log-search.mjs'
import {normalizeExploration} from '../explore/normalize'
import {fail} from '../security/authority'
import {input} from '../security/input'
import {nano} from '../ingest/model'
import {privateHeaders} from '../document'
import {queryActor} from './access'
import {executeQuery} from './execute'
interface Run {id:string;actor_ref:string;actor_revision:number;query:string;state:string;cursor:string|null;scanned:number;matched:number;scan_limit:number;deadline:number;revision:number;created_at:number;updated_at:number}
export const runRoot='/api/porthole/v1/query/runs'
const json=(run:Run,extra:Record<string,unknown>={},status=200)=>Response.json({id:run.id,state:run.state,revision:run.revision,query:JSON.parse(run.query),coverage:{state:run.state,scannedCandidates:run.scanned,matchedRecords:run.matched,complete:run.state==='complete'},scanLimit:run.scan_limit,deadline:run.deadline,createdAt:run.created_at,...extra},{status,headers:{...privateHeaders,'x-porthole-entity':run.id,'x-porthole-actor':run.actor_ref,'x-porthole-actor-revision':String(run.actor_revision)}})
export async function runResponse(request:Request,env:Bindings):Promise<Response> {
 const actor=await queryActor(request,env),url=new URL(request.url),parts=url.pathname.slice(runRoot.length).split('/').filter(Boolean),now=Date.now()
 if(url.search||parts.length>2)fail('invalid_query_run',400)
 if(parts.length===0){
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request),query=data.query as Record<string,unknown>,timeout=data.timeoutMs??60000
  if(Object.keys(data).some(key=>!['query','scanLimit','timeoutMs'].includes(key)))fail('invalid_query_run',400)
  const normalized=normalizeExploration(query),scan=Number(data.scanLimit??100)
  if(normalized.metricQuery)fail('metric_run_requires_complete_snapshot',400)
  if(!Number.isSafeInteger(scan)||scan<1||scan>200||!Number.isSafeInteger(timeout)||Number(timeout)<1||Number(timeout)>60000)fail('invalid_query_budget',400)
  if(normalized.logSearch)compileLogSearch(normalized.logSearch,actor.scope)
  for(const [field,key]of [['service','services'],['environment','environments'],['team','teams']]as const){const value=normalized.parameters[field];if(value!==undefined&&!actor.scope[key].includes('*')&&!actor.scope[key].includes(String(value)))fail('scope_forbidden')}
  if(!['logs','metrics','traces','profiles'].includes(String(normalized.parameters.signal)))fail('signal_required',400)
  // A continuation owns its first position and fixed watermark. Caller-supplied
  // cursors cannot skip the start of its declared coverage.
  if(normalized.parameters.cursor!==undefined||normalized.parameters.scanLimit!==undefined)fail('invalid_query_continuation',400)
  const from=nano(normalized.parameters.from??'0'),through=nano(normalized.parameters.through??'18446744073709551615')
  if(from>through)fail('invalid_query_range',400)
  const snapshot=normalized.parameters.snapshot??(await env.DB.prepare("SELECT COALESCE(MAX(completion_sequence),0) AS n FROM porthole_ingest_batches WHERE state='complete'").first<{n:number}>())!.n
  if(!Number.isSafeInteger(Number(snapshot))||Number(snapshot)<0)fail('invalid_query_snapshot',400)
  const id=crypto.randomUUID(),spec={...normalized.parameters,from,through,snapshot:Number(snapshot),limit:200,dialect:normalized.source.dialect,expression:normalized.source.text}
  const row=await env.DB.prepare(`INSERT INTO porthole_query_runs(id,actor_ref,actor_revision,query,state,scan_limit,deadline,created_at,updated_at) SELECT ?,?,?,?,'ready',?,?,?,? WHERE ${actor.fence} RETURNING *`).bind(id,actor.id,actor.revision,JSON.stringify(spec),scan,now+Number(timeout),now,now,...actor.args).first<Run>()
  if(!row)fail('authority_changed',409)
  return json(row,{next:runRoot+'/'+id+'/advance'},201)
 }
 const id=parts[0];if(!/^[a-f0-9-]{36}$/.test(id))fail('invalid_query_run',400)
 let run=await env.DB.prepare(`SELECT * FROM porthole_query_runs WHERE id=? AND actor_ref=? AND actor_revision=? AND ${actor.fence}`).bind(id,actor.id,actor.revision,...actor.args).first<Run>()
 if(!run)fail('query_run_not_found',404)
 if(request.method==='GET'&&parts.length===1)return json(run)
 if(request.method!=='POST'||!['advance','cancel'].includes(parts[1]))fail('method_not_allowed',405)
 const data=await input(request)
 if(Object.keys(data).some(key=>key!=='revision')||Number(data.revision)!==run.revision)fail('query_run_revision_conflict',409)
 if(['complete','canceled','timed_out','interrupted'].includes(run.state))return json(run,{records:[]})
 const update=async(state:string,cursor:string|null,scanned:number,matched:number)=>{
  const result=await env.DB.prepare(`UPDATE porthole_query_runs SET state=?,cursor=?,scanned=scanned+?,matched=matched+?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state IN ('ready','partial') AND ${actor.fence} RETURNING *`).bind(state,cursor,scanned,matched,Date.now(),id,run!.revision,...actor.args).first<Run>()
  if(!result)fail('query_run_changed',409);return result
 }
 if(parts[1]==='cancel'||now>=run.deadline){run=await update(parts[1]==='cancel'?'canceled':'timed_out',run.cursor,0,0);return json(run,{records:[]})}
 const response=await executeQuery(request,env,{...JSON.parse(run.query),scanLimit:run.scan_limit,...(run.cursor?{cursor:run.cursor}:{})})
 if(!response.ok)return response
 const result=await response.json()as {records:unknown[];cursor:string|null;coverage:{scannedCandidates:number};[key:string]:unknown}
 // The final revision mutation refuses a concurrent cancel. A deadline crossed
 // during a provider read releases no records or successful aggregate.
 if(Date.now()>=run.deadline){run=await update('timed_out',run.cursor,0,0);return json(run,{records:[]})}
 run=await update(result.cursor?'partial':'complete',result.cursor,result.coverage.scannedCandidates,result.records.length)
 return json(run,{page:result,records:result.records,next:run.state==='partial'?runRoot+'/'+id+'/advance:null})
}
