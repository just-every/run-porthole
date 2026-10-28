import {configuration as analyticalConfiguration,selected as analyticalSelected} from '../analytical/client'
import {readAnalytical} from '../analytical/read'
import {compileLogSearch,LogSearchError,type LogSearchPlan} from '../../../workers/analytics/log-search.mjs'
import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { CredentialLimit, verifyCredential } from '../credentials/verify'
import { privateHeaders } from '../document'
import { allScope, authority, emptyScope, fail, type Scope } from '../security/authority'
import { base64, IntakeError, nano } from './model'

export function scopeWhere(scope: Scope, alias = 'r') {
 const args: unknown[] = [], parts: string[] = []
 for (const [column,key] of [['service','services'],['environment','environments'],['team','teams']] as const) {
  parts.push(`EXISTS(SELECT 1 FROM json_each(?) grant_scope WHERE grant_scope.value='*' OR grant_scope.value=${alias}.${column})`)
  args.push(JSON.stringify(scope[key]))
 }
 return { sql:parts.join(' AND '),args }
}
const json = (value:unknown,status=200,headers:Record<string,string>={}) => Response.json(value,{status,headers:{...privateHeaders,...headers}})
export async function readTelemetry(request: Request, env: Bindings, options: {archive?:boolean;exportOnly?:boolean;estimateOnly?:boolean;recordSnapshot?:boolean;logSearch?:LogSearchPlan;source?:{dialect:string;text:string}} = {}): Promise<Response> {
 try {
  const url = new URL(request.url), params = url.searchParams, archive = !!options.archive
  if ([...params.keys()].some(key => !['signal','service','environment','team','from','through','cursor','limit','snapshot','trace','metric','scanLimit'].includes(key))) fail('invalid_query',400)
  const limit = Number(params.get('limit') ?? 100)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > (params.has('trace')?2000:200)) fail('invalid_query_limit',400)
  const scanLimit=params.has('scanLimit')?Number(params.get('scanLimit')):null
  if(scanLimit!==null&&(!Number.isSafeInteger(scanLimit)||scanLimit<1||scanLimit>limit))fail('invalid_scan_limit',400)
  const signal = params.get('signal')
  if (!signal || !['logs','traces','metrics','profiles'].includes(signal)) fail('signal_required',400)
  let scope: Scope, fence: {sql:string;args:unknown[]},actorRef:string,actorRevision:number
  if (request.headers.has('authorization')) {
   const auth = await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
   if (!auth.credential.scope.signals.includes(signal)) fail('credential_scope_forbidden')
   scope=auth.credential.scope;actorRef=auth.credential.id;actorRevision=auth.credential.revision
   // Final verification below reserves exact selected payload bytes and reads
   // inside its live transaction; this first check never releases contents.
   fence={sql:'1',args:[]}
  } else {
   const actor=await authority(request,env)
   if (!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role)) fail('telemetry_forbidden')
   scope=actor.member.scope;actorRef=actor.member.operatorId;actorRevision=actor.member.revision; fence={sql:actor.fence,args:actor.args}
  }
  if(options.logSearch && signal!=='logs') fail('invalid_log_search_signal',400)
  const logSearch=options.logSearch?compileLogSearch(options.logSearch,scope):null
  const where=scopeWhere(scope), clauses=[where.sql,'r.signal=?'], args:unknown[]=[...where.args,signal]
  for (const [column,key] of [['service','services'],['environment','environments'],['team','teams']] as const) {
   const value=params.get(column)
   if (value) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value))fail('invalid_query_scope',400)
    if (!scope[key].includes('*') && !scope[key].includes(value)) fail('scope_forbidden')
    clauses.push(`r.${column}=?`);args.push(value)
   }
  }
  const from=params.has('from') ? nano(params.get('from')) : '00000000000000000000', through=params.has('through') ? nano(params.get('through')) : '18446744073709551615'
  if (from > through) fail('invalid_query_range',400)
  const trace=params.get('trace')
  if(trace!==null) {
   if(signal!=='traces'||!/^[a-f0-9]{32}$/.test(trace)||/^0+$/.test(trace))fail('invalid_trace_id',400)
   clauses.push('r.trace_id=?');args.push(trace)
  }
  const metric=params.get('metric')
  if(metric!==null) {
   if(signal!=='metrics'||!metric.trim().length||metric.length>120||/[\u0000-\u001f\u007f-\u009f]/u.test(metric)||params.getAll('metric').length!==1)fail('invalid_metric_name',400)
   clauses.push("json_extract(r.payload,'$.metric.name')=?");args.push(metric)
  }
  if(logSearch&&scanLimit===null&&!options.estimateOnly){clauses.push(logSearch.sql);args.push(...logSearch.args)}
  if(options.exportOnly)clauses.push('NOT EXISTS(SELECT 1 FROM porthole_export_exclusions e WHERE e.record_id=r.id)')
  clauses.push('r.event_time_ns>=?','r.event_time_ns<=?');args.push(from,through)
  const snapshot = params.has('snapshot') ? Number(params.get('snapshot')) : (await env.DB.prepare("SELECT COALESCE(MAX(completion_sequence),0) AS snapshot FROM porthole_ingest_batches WHERE state='complete'").first<{snapshot:number}>())!.snapshot
  if (!Number.isSafeInteger(snapshot) || snapshot < 0) fail('invalid_query_snapshot',400)
  // Complete envelopes are immutable. A sequence watermark survives archive
  // restore and cannot admit a later batch that shares a millisecond timestamp.
  clauses.push("b.completion_sequence<=? AND b.state='complete'");args.push(snapshot)
  if (params.has('cursor')) {
   let cursor: unknown
   try { cursor=JSON.parse(atob(params.get('cursor')!.replaceAll('-','+').replaceAll('_','/'))) } catch { fail('invalid_query_cursor',400) }
   if (!Array.isArray(cursor) || cursor.length!==2 || typeof cursor[1]!=='string' || cursor[1].length>100) fail('invalid_query_cursor',400)
   const time=nano(cursor[0]);clauses.push('(r.event_time_ns>? OR (r.event_time_ns=? AND r.id>?))');args.push(time,time,cursor[1])
  }
  const table=archive ? 'porthole_telemetry_archive' : 'porthole_telemetry_records'
  const select=`SELECT r.* FROM ${table} r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE ${clauses.join(' AND ')} AND `
  const queryRef=crypto.randomUUID(),queryScope=JSON.stringify({...Object.fromEntries([...params].filter(([key])=>['service','environment','team','cursor','limit','trace','metric','scanLimit'].includes(key))),...(options.source?{dialect:options.source.dialect,expression:options.source.text}:{})})
  const analytical=await analyticalConfiguration(env)
  if(analyticalSelected(env,analytical))return await readAnalytical(request,env,analytical,{scope,actorRef,actorRevision,fence,snapshot,queryRef,queryScope,from,through,signal,limit,archive,logSearch:options.logSearch,scanLimit,exportOnly:options.exportOnly,recordSnapshot:options.recordSnapshot,estimateOnly:options.estimateOnly})
  const statement=(live:{sql:string;args:unknown[]})=>scanLimit===null
   ?env.DB.prepare(`${select}${live.sql} ORDER BY r.event_time_ns,r.id LIMIT ?`).bind(...args,...live.args,limit+1)
   :env.DB.prepare(`WITH candidates AS MATERIALIZED (${select}${live.sql} ORDER BY r.event_time_ns,r.id LIMIT ?) SELECT r.*,CASE WHEN ${logSearch?.sql??'1'} THEN 1 ELSE 0 END AS query_match FROM candidates r ORDER BY r.event_time_ns,r.id`).bind(...args,...live.args,scanLimit,...(logSearch?.args??[]))
  const snapshotInsert=(live:{sql:string;args:unknown[]})=>options.recordSnapshot===false?env.DB.prepare('SELECT 1'):env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,?,?,?,?,? WHERE ${live.sql}`).bind(queryRef,actorRef,queryScope,signal,from,through,snapshot,Date.now(),...live.args)
  if(options.estimateOnly){
   const estimate=(live:{sql:string;args:unknown[]})=>env.DB.prepare(`SELECT COUNT(*) AS candidateRecords,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS payloadBytes FROM (${select}${live.sql} ORDER BY r.event_time_ns,r.id LIMIT 10001)`).bind(...args,...live.args)
   let result:D1Result[]
   if(request.headers.has('authorization')){
    const measured=await estimate({sql:'1',args:[]}).first<{payloadBytes:number}>()
    const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,scannedBytes:measured!.payloadBytes,writes(live,latest){if(JSON.stringify(scope)!==JSON.stringify(latest))fail('authority_changed',409);return [estimate(live),snapshotInsert(live)]}});result=auth.results
   }else result=await env.DB.batch([estimate(fence),snapshotInsert(fence)])
   const measured=result[0].results[0]as {candidateRecords:number;payloadBytes:number}
   return json({snapshot,from,through,queryRef,records:[],cursor:null,estimate:{...measured,exact:measured.candidateRecords<=10000,basis:'authorized-candidates-before-log-predicate',measurementCap:10001},coverage:{state:'estimate',complete:false}},200,{'x-porthole-entity':queryRef,'x-porthole-actor':actorRef,'x-porthole-actor-revision':String(actorRevision)})
  }
  let rows: Record<string,unknown>[]
  if (request.headers.has('authorization')) {
   const estimate=(await statement({sql:'1',args:[]}).all<Record<string,unknown>>()).results
   const scanned=estimate.reduce((sum,row) => sum+new TextEncoder().encode(String(row.payload)).length,0)
   const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,scannedBytes:scanned,writes(live,latest) {
    if (!latest.signals.includes(signal) || JSON.stringify(scope)!==JSON.stringify(latest)) fail('authority_changed',409)
    return [statement(live),snapshotInsert(live)]
   }})
   rows=auth.results[0].results as Record<string,unknown>[]
  } else rows=(await env.DB.batch<Record<string,unknown>>([statement(fence),snapshotInsert(fence)]))[0].results
  const scanned=rows.length,bytes=rows.reduce((sum,row)=>sum+new TextEncoder().encode(String(row.payload)).length,0)
  const more=scanLimit===null?rows.length>limit:rows.length===scanLimit
  if(scanLimit===null)rows=rows.slice(0,limit)
  const last=rows.at(-1),cursor=more && last ? base64(new TextEncoder().encode(JSON.stringify([last.event_time_ns,last.id]))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') : null
  if(scanLimit!==null)rows=rows.filter(row=>row.query_match===1)
  return json({snapshot,from,through,queryRef,records:rows.map(({query_match,...row})=>({...row,payload:JSON.parse(String(row.payload))})),cursor,archive,...(scanLimit===null?{}:{coverage:{state:cursor?'partial':'complete',reason:cursor?'scan_limit':null,scannedCandidates:scanned,scannedPayloadBytes:bytes,matchedRecords:rows.length}})},200,{'x-porthole-entity':queryRef,'x-porthole-actor':actorRef,'x-porthole-actor-revision':String(actorRevision)})
 } catch (error) {
  const known=error instanceof AuthError || error instanceof CredentialLimit || error instanceof IntakeError || error instanceof LogSearchError
  return json({error:known ? error.code : 'telemetry_unavailable',...(error instanceof LogSearchError?{field:error.field,hint:error.hint}:{})},known ? error.status : 503,error instanceof CredentialLimit ? {'retry-after':String(error.retryAfter)} : {})
 }
}
