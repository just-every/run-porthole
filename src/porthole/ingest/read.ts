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
export async function readTelemetry(request: Request, env: Bindings, options: {archive?:boolean} = {}): Promise<Response> {
 try {
  const url = new URL(request.url), params = url.searchParams, archive = !!options.archive
  if ([...params.keys()].some(key => !['signal','service','environment','team','from','through','cursor','limit','snapshot'].includes(key))) fail('invalid_query',400)
  const limit = Number(params.get('limit') ?? 100)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('invalid_query_limit',400)
  const signal = params.get('signal')
  if (!signal || !['logs','traces','metrics'].includes(signal)) fail('signal_required',400)
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
  const where=scopeWhere(scope), clauses=[where.sql,'r.signal=?'], args:unknown[]=[...where.args,signal]
  for (const [column,key] of [['service','services'],['environment','environments'],['team','teams']] as const) {
   const value=params.get(column)
   if (value) {
    if (!scope[key].includes('*') && !scope[key].includes(value)) fail('scope_forbidden')
    clauses.push(`r.${column}=?`);args.push(value)
   }
  }
  const from=params.has('from') ? nano(params.get('from')) : '00000000000000000000', through=params.has('through') ? nano(params.get('through')) : '18446744073709551615'
  if (from > through) fail('invalid_query_range',400)
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
  const queryRef=crypto.randomUUID(),queryScope=JSON.stringify(Object.fromEntries([...params].filter(([key])=>['service','environment','team','cursor','limit'].includes(key))))
  const snapshotInsert=(live:{sql:string;args:unknown[]})=>env.DB.prepare(`INSERT INTO porthole_query_snapshots SELECT ?,?,?,?,?,?,?,? WHERE ${live.sql}`).bind(queryRef,actorRef,queryScope,signal,from,through,snapshot,Date.now(),...live.args)
  let rows: Record<string,unknown>[]
  if (request.headers.has('authorization')) {
   const estimate=(await env.DB.prepare(`${select}1 ORDER BY r.event_time_ns,r.id LIMIT ?`).bind(...args,limit+1).all<Record<string,unknown>>()).results
   const scanned=estimate.reduce((sum,row) => sum+new TextEncoder().encode(String(row.payload)).length,0)
   const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,scannedBytes:scanned,writes(live,latest) {
    if (!latest.signals.includes(signal) || JSON.stringify(scope)!==JSON.stringify(latest)) fail('authority_changed',409)
    return [env.DB.prepare(`${select}${live.sql} ORDER BY r.event_time_ns,r.id LIMIT ?`).bind(...args,...live.args,limit+1),snapshotInsert(live)]
   }})
   rows=auth.results[0].results as Record<string,unknown>[]
  } else rows=(await env.DB.batch<Record<string,unknown>>([env.DB.prepare(`${select}${fence.sql} ORDER BY r.event_time_ns,r.id LIMIT ?`).bind(...args,...fence.args,limit+1),snapshotInsert(fence)]))[0].results
  const more=rows.length>limit;rows=rows.slice(0,limit)
  const last=rows.at(-1),cursor=more && last ? base64(new TextEncoder().encode(JSON.stringify([last.event_time_ns,last.id]))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') : null
  return json({snapshot,from,through,queryRef,records:rows.map(row=>({...row,payload:JSON.parse(String(row.payload))})),cursor,archive},200,{'x-porthole-entity':queryRef,'x-porthole-actor':actorRef,'x-porthole-actor-revision':String(actorRevision)})
 } catch (error) {
  const known=error instanceof AuthError || error instanceof CredentialLimit || error instanceof IntakeError
  return json({error:known ? error.code : 'telemetry_unavailable'},known ? error.status : 503,error instanceof CredentialLimit ? {'retry-after':String(error.retryAfter)} : {})
 }
}
