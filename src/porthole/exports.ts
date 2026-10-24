import { exclusionRoot, exclusionResponse } from './privacy/export-exclusions/http'
import type { Bindings } from '../auth.server'
import { AuthError } from '../modules/operator-auth/index.mjs'
import { authority, fail, scopeWithin, parseScope, allScope, emptyScope, type Authority, type Scope } from './security/authority'
import { input } from './security/input'
import { privateHeaders } from './document'
import { CredentialLimit, verifyCredential } from './credentials/verify'
import { nano, IntakeError, base64 } from './ingest/model'
import { scopeWhere } from './ingest/read'
import { otlpExport } from './signals/formats/otlp'

const root = '/api/porthole/v1/exports'
const signals = ['logs','metrics','traces','profiles']
const columns = 'id,batch_id,ordinal,source_id,signal,team,service,environment,event_time_ns,trace_id,span_id,payload'
// Retained hot records and archive-only records, exactly once by stable ID.
const retained = `WITH retained AS (SELECT ${columns} FROM porthole_telemetry_records UNION ALL SELECT ${columns} FROM porthole_telemetry_archive a WHERE NOT EXISTS(SELECT 1 FROM porthole_telemetry_records h WHERE h.id=a.id)) `
interface Selection { scope: Scope; signals: string[]; from: string; through: string; pageSize: number }
interface Job { id: string; owner_ref: string; owner_revision: number; created_at: number; approved_at: number|null; state: string; selection: string; snapshot: number; estimate: string; credential_ref: string|null }
interface Fence { sql: string; args: unknown[] }
function guard(db: D1Database, fence: Fence) {
 return db.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${fence.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...fence.args)
}
const ownerFence = (actor: Authority): Fence => ({ sql: actor.fence, args: actor.args })
async function owner(request: Request, env: Bindings) {
 const actor = await authority(request, env, { post: request.method === 'POST' })
 if (actor.session.kind !== 'native') fail('native_session_required')
 if (actor.member.role !== 'owner') fail('export_owner_required')
 return actor
}
function selection(data: Record<string, unknown>, actor: Authority): Selection {
 if (Object.keys(data).some(key => !['scope','signals','from','through','pageSize'].includes(key))) fail('invalid_export',400)
 const scope = parseScope(data.scope ?? actor.member.scope)
 if (!scopeWithin(scope,actor.member.scope) || Object.values(scope).some(list => !list.length)) fail('scope_forbidden')
 const chosen = data.signals ?? signals
 if (!Array.isArray(chosen) || !chosen.length || chosen.some(value => !signals.includes(value)) || new Set(chosen).size !== chosen.length) fail('invalid_export_signals',400)
 const from = nano(data.from), through = nano(data.through), pageSize = data.pageSize ?? 50
 if (from > through || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 50) fail('invalid_export_range',400)
 return { scope, signals: chosen, from, through, pageSize: Number(pageSize) }
}
function filter(value: Selection, snapshot: number) {
 const scope = scopeWhere(value.scope)
 return { sql: `${scope.sql} AND r.signal IN (SELECT value FROM json_each(?)) AND r.event_time_ns>=? AND r.event_time_ns<=? AND b.state='complete' AND b.completion_sequence<=? AND NOT EXISTS(SELECT 1 FROM porthole_export_exclusions e WHERE e.record_id=r.id)`, args: [...scope.args,JSON.stringify(value.signals),value.from,value.through,snapshot] }
}
function manifest(job: Job) {
 return { format: 'porthole.signals.v1', id: job.id, state: job.state, selection: JSON.parse(job.selection), snapshot: job.snapshot,
  createdAt: job.created_at, approvedAt: job.approved_at, estimate: JSON.parse(job.estimate),
  limits: { pageRows: JSON.parse(job.selection).pageSize, pagePayloadBytes: 1024*1024, totalRowCap: null },
  formats: ['ndjson','otlp-json'], erasureCoverage: 'Portable record exclusions are checked on every page. This suppresses exports; it does not delete retained telemetry or qualify PORT-035.' }
}
const json = (value: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(value,{status,headers:{...privateHeaders,...headers}})
async function jobFor(env: Bindings, id: string) {
 const job = await env.DB.prepare('SELECT * FROM porthole_signal_exports WHERE id=?').bind(id).first<Job>()
 if (!job) fail('export_not_found',404)
 return job
}
function liveJob(job: Job): Fence {
 return { sql: `EXISTS(SELECT 1 FROM porthole_signal_exports j JOIN porthole_members m ON m.operator_id=j.owner_ref JOIN oa_operators o ON o.id=m.operator_id WHERE j.id=? AND j.state='approved' AND j.owner_revision=m.revision AND m.role='owner' AND o.role='owner' AND o.status='active')`, args: [job.id] }
}
export async function signalExportResponse(request: Request, env: Bindings): Promise<Response|null> {
 const url = new URL(request.url)
 if (url.pathname === exclusionRoot) return exclusionResponse(request,env)
 if (url.pathname !== root && !url.pathname.startsWith(root+'/')) return null
 try {
  const parts = url.pathname.slice(root.length).split('/').filter(Boolean)
  if (!parts.length && request.method === 'POST') {
   if (url.search) fail('invalid_export',400)
   const actor = await owner(request,env), value = selection(await input(request),actor)
   const snapshot = (await env.DB.prepare("SELECT COALESCE(MAX(completion_sequence),0) AS n FROM porthole_ingest_batches WHERE state='complete'").first<{n:number}>())!.n
   const where = filter(value,snapshot)
   const rows = (await env.DB.batch<{signal:string;records:number;payloadBytes:number}>([guard(env.DB,ownerFence(actor)),env.DB.prepare(retained+`SELECT r.signal,COUNT(*) AS records,COALESCE(SUM(length(CAST(r.payload AS BLOB))),0) AS payloadBytes FROM retained r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE ${where.sql} GROUP BY r.signal`).bind(...where.args)]))[1].results
   const estimate = { signals: rows, totalRecords: rows.reduce((sum,row) => sum+Number(row.records),0), payloadBytes: rows.reduce((sum,row) => sum+Number(row.payloadBytes),0), usd: null, costNote: 'USD cost is unavailable without owner infrastructure rates. Payload bytes exclude format overhead and provider scan charges.' }
   const id = crypto.randomUUID()
   await env.DB.batch([guard(env.DB,ownerFence(actor)),env.DB.prepare("INSERT INTO porthole_signal_exports(id,owner_ref,owner_revision,created_at,state,selection,snapshot,estimate) VALUES(?,?,?,?,'preview',?,?,?)").bind(id,actor.member.operatorId,actor.member.revision,Date.now(),JSON.stringify(value),snapshot,JSON.stringify(estimate))])
   return json(manifest(await jobFor(env,id)),201,{'x-porthole-entity':id})
  }
  if (!/^[a-f0-9-]{36}$/.test(parts[0] ?? '') || parts.length > 2) fail('export_not_found',404)
  // Refuse an invalid principal before revealing whether a private job exists.
  let authenticatedOwner: Authority|undefined
  if (parts[1] === 'pages' && request.headers.has('authorization')) await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  else authenticatedOwner = await owner(request,env)
  const job = await jobFor(env,parts[0]), value = JSON.parse(job.selection) as Selection
  if (parts[1] !== 'pages') {
   if (url.search) fail('invalid_export',400)
   const actor = authenticatedOwner!
   if (job.owner_ref !== actor.member.operatorId) fail('export_not_found',404)
   if (parts[1] !== 'cancel' && job.owner_revision !== actor.member.revision) fail('authority_changed',409)
   if (!parts[1] && request.method === 'GET') { await env.DB.batch([guard(env.DB,ownerFence(actor))]); return json(manifest(job)) }
   if (request.method !== 'POST' || !['approve','cancel'].includes(parts[1])) fail('method_not_allowed',405)
   const data = await input(request)
   if (Object.keys(data).some(key => !['confirm','credentialId'].includes(key))) fail('invalid_export',400)
   if (parts[1] === 'cancel') {
    if (data.confirm !== job.id) fail('export_confirmation_required',400)
    await env.DB.batch([guard(env.DB,ownerFence(actor)),env.DB.prepare("UPDATE porthole_signal_exports SET state='cancelled' WHERE id=?").bind(job.id)])
   } else {
    if (data.confirm !== job.id || job.state !== 'preview' || job.owner_revision !== actor.member.revision) fail('export_confirmation_required',409)
    let credential: string|null = null
    if (data.credentialId !== undefined) {
     if (typeof data.credentialId !== 'string') fail('invalid_export',400)
     credential = data.credentialId
     const row = await env.DB.prepare("SELECT scope FROM porthole_credentials WHERE id=? AND custodian_id=? AND class='read' AND status='active' AND expires_at>?").bind(credential,actor.member.operatorId,Date.now()).first<{scope:string}>()
     const scope = row ? JSON.parse(row.scope) : null
     if (!scope || !scope.actions.includes('telemetry.read') || !scopeWithin(value.scope,scope) || !value.signals.every(signal => scope.signals.includes(signal))) fail('credential_scope_forbidden')
    }
    await env.DB.batch([guard(env.DB,ownerFence(actor)),env.DB.prepare("UPDATE porthole_signal_exports SET state='approved',approved_at=?,credential_ref=? WHERE id=? AND state='preview'").bind(Date.now(),credential,job.id)])
   }
   return json(parts[1] === 'cancel' ? {id:job.id,state:'cancelled'} : manifest(await jobFor(env,job.id)),200,{'x-porthole-entity':job.id})
  }
  if (request.method !== 'GET') fail('method_not_allowed',405)
  if ([...url.searchParams.keys()].some(key => !['cursor','format'].includes(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) fail('invalid_export_cursor',400)
  const format = url.searchParams.get('format') ?? 'ndjson'
  if (!['ndjson','otlp-json'].includes(format)) fail('invalid_export_format',400)
  const live = liveJob(job)
  let actor: Authority|undefined, credentialId: string|undefined
  if (request.headers.has('authorization')) {
   const current = await verifyCredential(request,env,{action:'telemetry.read',scope:value.scope,dataScope:allScope,inspectOnly:true})
   if (current.credential.class !== 'read' || current.credential.id !== job.credential_ref || current.credential.custodianId !== job.owner_ref || !value.signals.every(signal => current.credential.scope.signals.includes(signal))) fail('export_credential_forbidden')
   credentialId = current.credential.id
  } else {
   actor = authenticatedOwner!
   if (job.owner_ref !== actor.member.operatorId) fail('export_not_found',404)
   if (job.owner_revision !== actor.member.revision) fail('authority_changed',409)
  }
  if (job.state !== 'approved') fail('export_not_approved',409)
  const where = filter(value,job.snapshot), after: unknown[] = []
  let cursorSql = ''
  if (url.searchParams.has('cursor')) {
   let cursor: unknown
   try { cursor = JSON.parse(atob(url.searchParams.get('cursor')!.replaceAll('-','+').replaceAll('_','/'))) } catch { fail('invalid_export_cursor',400) }
   if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== job.id || typeof cursor[2] !== 'string' || !/^[a-f0-9-]{36}:\d+$/.test(cursor[2])) fail('invalid_export_cursor',400)
   const time = nano(cursor[1]); cursorSql = ' AND (r.event_time_ns>? OR (r.event_time_ns=? AND r.id>?))'; after.push(time,time,cursor[2])
  }
  // Select only candidate IDs and sizes before crossing the D1 boundary.
  // At most one record can cross the byte boundary, so lookahead stays bounded
  // even when every retained payload is close to the intake envelope limit.
  const query = (fence: Fence) => env.DB.prepare(retained+`, candidates AS (
   SELECT r.id,r.event_time_ns,length(CAST(r.payload AS BLOB)) AS bytes FROM retained r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE ${where.sql}${cursorSql} AND ${fence.sql} ORDER BY r.event_time_ns,r.id LIMIT ?
  ), sized AS (SELECT id,SUM(bytes) OVER(ORDER BY event_time_ns,id)-bytes AS previous_bytes FROM candidates)
  SELECT r.*,(SELECT COUNT(*) FROM candidates) AS candidate_count FROM retained r JOIN sized s ON s.id=r.id WHERE s.previous_bytes<1048576 ORDER BY r.event_time_ns,r.id`).bind(...where.args,...after,...fence.args,value.pageSize+1)
  let rows: Record<string,unknown>[]
  const combine = (fence: Fence): Fence => ({sql:`${fence.sql} AND ${live.sql}`,args:[...fence.args,...live.args]})
  if (credentialId) {
   const estimated = (await query(live).all<Record<string,unknown>>()).results
   const scannedBytes = estimated.reduce((sum,row) => sum+new TextEncoder().encode(String(row.payload)).length,0)
   const result = await verifyCredential(request,env,{action:'telemetry.read',scope:value.scope,dataScope:allScope,scannedBytes,writes(fence,scope) {
    if (!value.signals.every(signal => scope.signals.includes(signal))) fail('credential_scope_forbidden')
    return [guard(env.DB,combine(fence)),query(combine(fence))]
   }})
   rows = result.results[1].results as Record<string,unknown>[]
  } else rows = (await env.DB.batch([guard(env.DB,combine(ownerFence(actor!))),query(combine(ownerFence(actor!)))]))[1].results as Record<string,unknown>[]
  // The page is bounded by rows and payload bytes. Never drop the first record;
  // intake already enforces its one MiB envelope limit.
  const selected: Record<string,unknown>[] = []; let bytes = 0
  for (const row of rows) {
   const size = new TextEncoder().encode(String(row.payload)).length
   if (selected.length >= value.pageSize || selected.length && bytes+size > 1024*1024) break
   selected.push(row); bytes += size
  }
  const last = selected.at(-1), next = Number(rows[0]?.candidate_count ?? 0) > selected.length && last ? base64(new TextEncoder().encode(JSON.stringify([job.id,last.event_time_ns,last.id]))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') : null
  const records = selected.map(({candidate_count: _count,...row}): Record<string,unknown> & {payload:Record<string,unknown>} => ({...row,payload:JSON.parse(String(row.payload))}))
  const lines = records.map(row => JSON.stringify(format === 'ndjson' ? row : { id: row.id, signal: row.signal, eventTimeUnixNano: row.event_time_ns, sourceId: row.source_id, batchId: row.batch_id, team: row.team, service: row.service, environment: row.environment, exportRequest: otlpExport(String(row.signal),row.payload) })+'\n')
  const stream = new ReadableStream({start(controller) { for (const line of lines) controller.enqueue(new TextEncoder().encode(line)); controller.close() }})
  return new Response(stream,{headers:{...privateHeaders,'content-type':'application/x-ndjson','content-disposition':'attachment; filename="signals.ndjson"','x-porthole-export':job.id,'x-porthole-records':String(records.length),'x-porthole-next-cursor':next ?? '', 'x-porthole-entity':job.id, ...(credentialId ? {'x-porthole-actor':credentialId} : {})}})
 } catch(error) {
  const known = error instanceof AuthError || error instanceof IntakeError || error instanceof CredentialLimit
  return json({error:known ? error.code : 'export_unavailable'},known ? error.status : 503,error instanceof CredentialLimit ? {'retry-after':String(error.retryAfter)} : {})
 }
}
