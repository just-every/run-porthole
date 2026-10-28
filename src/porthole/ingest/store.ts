import { current, processed, storedFormat, storedLogWire } from '../pipelines/intake'
import { sanitize } from '../pipelines/redact'
import { sha256 } from './model'
import type { Bindings } from '../../auth.server'
import { secretHash, type CredentialScope } from '../credentials/policy'
import { CredentialLimit, verifyCredential } from '../credentials/verify'
import { allScope, emptyScope } from '../security/authority'
import { authorizeRecords } from './normalize'
import { base64, canonical, IntakeError, type Signal, type TelemetryRecord } from './model'

interface Envelope { id: string; digest: string; identity: string; signal: Signal; protocol: string; wire: Uint8Array; records: TelemetryRecord[] }
interface Fence { sql: string; args: unknown[] }
const groups = (records: TelemetryRecord[], scope: CredentialScope) => {
 const grouped = new Map<string,{team:string;service:string;environment:string;count:number|null}>()
 for (const row of records) {
  const key = canonical([row.team,row.service,row.environment]), previous = grouped.get(key)
  if (previous) previous.count!++
  else grouped.set(key,{team:row.team,service:row.service,environment:row.environment,count:1})
 }
 if (!records.length) grouped.set('',{ team: scope.teams.length === 1 ? scope.teams[0] : '', service: scope.services.length === 1 ? scope.services[0] : '', environment: scope.environments.length === 1 ? scope.environments[0] : '', count:null })
 return [...grouped.values()]
}
function eventStatements(env: Bindings, hash: string, signal: string, records: TelemetryRecord[], scope: CredentialScope, kind: string, reason: string, batch: string | null, fence: Fence, condition = '1', args: unknown[] = []) {
 return groups(records,scope).map(raw => sanitize(raw)).map(group => env.DB.prepare(`INSERT INTO porthole_ingest_events(id,source_id,signal,team,service,environment,occurred_at,kind,reason,record_count,batch_ref)
 SELECT ?,c.id,?,?,?,?,?,?,?,?,? FROM porthole_credentials c WHERE c.secret_hash=? AND ${fence.sql} AND (${condition})`)
 .bind(crypto.randomUUID(),signal,group.team,group.service,group.environment,Date.now(),kind,reason,group.count,batch,hash,...fence.args,...args))
}
function check(scope: CredentialScope, signal: string, records: TelemetryRecord[]) { authorizeRecords(records,scope,signal) }
/** One D1 transaction reserves credential quota and persists the full envelope.
 * Backlog checks and duplicate recognition run inside that same transaction. */
export async function acceptEnvelope(request: Request, env: Bindings, envelope: Envelope) {
 const hash = await secretHash((request.headers.get('authorization') ?? '').slice(7)), now = Date.now()
 const originalWireBytes=envelope.wire.length
 const pipeline=['logs','traces'].includes(envelope.signal)?await current(env):null
 if(['logs','traces'].includes(envelope.signal)&&sanitize(envelope.identity)!==envelope.identity)envelope.identity='masked-'+await sha256(new TextEncoder().encode(envelope.identity))
 let encodedWire=base64(envelope.wire)
 // Older three-signal installations can intake during their schema upgrade.
 // They cannot have an erasure journal before its additive migration exists.
 const journalAvailable=!!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_erased_batches'").first()
 let granted: CredentialScope | undefined
 try {
  const response = await verifyCredential(request,env,{ action:'telemetry.write',scope:emptyScope,dataScope:allScope,acceptedBytes:originalWireBytes,
   writes(fence,scope) {
    check(scope,envelope.signal,envelope.records); granted = scope
    if(pipeline){
     envelope.records=envelope.records.map(record=>processed(record,pipeline.definition,pipeline.revision,envelope.signal==='logs'))
     encodedWire=base64(storedLogWire(envelope.records,envelope.signal))
     envelope.protocol+=';stored='+storedFormat(envelope.signal)
    }
    // Resource metadata can be repeated by thousands of records even when
    // the compressed request is small. Bound the durable representation before
    // serializing the whole array, so expansion cannot exhaust the Worker.
    let normalizedBytes=2
    for(const record of envelope.records) {
     normalizedBytes+=new TextEncoder().encode(canonical(record)).length+1
     if(normalizedBytes+encodedWire.length>1536*1024)throw new IntakeError('durable_envelope_too_large',413)
    }
    const encodedRecords=canonical(envelope.records)
    const bufferedBytes=new TextEncoder().encode(encodedRecords).length+encodedWire.length
    const tenant = request.headers.get('x-scope-orgid')
    if (tenant && (tenant.includes('|') || !envelope.records.length || envelope.records.some(row => row.team !== tenant))) throw new IntakeError('tenant_scope_forbidden',403)
    const invalidTime = envelope.records.find(row => row.payload.rejection)
    if (invalidTime) throw new IntakeError(String(invalidTime.payload.rejection))
    const source = 'SELECT id FROM porthole_credentials WHERE secret_hash=?'
    const exists = `EXISTS(SELECT 1 FROM porthole_ingest_batches WHERE source_id=(${source}) AND signal=? AND identity=?)`
    const same = `${exists.slice(0,-1)} AND digest=?)`
    const duplicateArgs = [hash,envelope.signal,envelope.identity,envelope.digest]
    const pressure = '(SELECT COALESCE(SUM(byte_count),0) FROM porthole_ingest_batches WHERE state=\'pending\')+?>(SELECT max_pending_bytes FROM porthole_ingest_control WHERE singleton=1)'
    return [env.DB.prepare(`INSERT INTO porthole_ingest_batches(id,sequence,source_id,signal,identity,digest,protocol,accepted_at,byte_count,record_count,wire_base64,records)
     SELECT ?,(SELECT COALESCE(MAX(sequence),0)+1 FROM porthole_ingest_batches),c.id,?,?,?,?,?,?,?,?,? FROM porthole_credentials c WHERE c.secret_hash=? AND ${fence.sql}
     AND ${journalAvailable?'NOT EXISTS(SELECT 1 FROM porthole_erased_batches WHERE content_digest=?)':"NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_erased_batches')"} AND ${pipeline?.available?'COALESCE((SELECT MAX(revision) FROM porthole_pipeline_versions),0)='+pipeline.revision:'1'} AND NOT (${pressure}) ON CONFLICT(source_id,signal,identity) DO NOTHING`)
     .bind(envelope.id,envelope.signal,envelope.identity,envelope.digest,envelope.protocol,now,bufferedBytes,envelope.records.length,encodedWire,encodedRecords,hash,...fence.args,...(journalAvailable?[envelope.digest]:[]),bufferedBytes),
     ...eventStatements(env,hash,envelope.signal,envelope.records,scope,'duplicate','batch_retried',null,fence,`${same} AND NOT EXISTS(SELECT 1 FROM porthole_ingest_batches WHERE id=?)`,[...duplicateArgs,envelope.id]),
     ...eventStatements(env,hash,envelope.signal,envelope.records,scope,'rejected','batch_identity_conflict',null,fence,`${exists} AND NOT (${same})`,[hash,envelope.signal,envelope.identity,...duplicateArgs]),
     ...eventStatements(env,hash,envelope.signal,envelope.records,scope,'rejected','queue_pressure',null,fence,`NOT (${exists}) AND ${pressure}`,[hash,envelope.signal,envelope.identity,bufferedBytes]),
     env.DB.prepare(`SELECT id,digest,state,record_count,accepted_at FROM porthole_ingest_batches WHERE source_id=(${source}) AND signal=? AND identity=? AND ${fence.sql}`).bind(hash,envelope.signal,envelope.identity,...fence.args),
    ]
   },
  })
  const row = response.results.at(-1)?.results[0] as {id:string;digest:string;state:string;record_count:number;accepted_at:number} | undefined
  const erased=journalAvailable&&await env.DB.prepare('SELECT 1 FROM porthole_erased_batches WHERE content_digest=?').bind(envelope.digest).first()
  if(erased)throw new IntakeError('erased_batch_refused',409)
  if (!row) {
   if(pipeline?.available&&(await current(env)).revision!==pipeline.revision)throw new IntakeError('pipeline_revision_changed',409)
   throw new IntakeError('queue_pressure',429,5)
  }
  if (row.digest !== envelope.digest) throw new IntakeError('batch_identity_conflict',409)
  return { batchId:row.id,accepted:row.record_count,duplicate:row.id !== envelope.id,state:row.state,acceptedAt:row.accepted_at }
 } catch (error) {
  // The failed-quota write fence intentionally cannot record anything. Recheck
  // the live identity and its complete granted scope for the rejection ledger.
  if (error instanceof CredentialLimit && granted) await recordQuotaRejection(env,hash,envelope.signal,envelope.records,granted)
  else if (error instanceof IntakeError && !['queue_pressure','batch_identity_conflict'].includes(error.code)) await rejectEnvelope(request,env,envelope.signal,error.code,envelope.records)
  throw error
 }
}
async function recordQuotaRejection(env: Bindings, hash: string, signal: string, records: TelemetryRecord[], scope: CredentialScope) {
 const dimensions = ['services','environments','teams']
 const contains = (column: string, key: string) => `NOT EXISTS(SELECT 1 FROM json_each(?, '$.${key}') s WHERE NOT EXISTS(SELECT 1 FROM json_each(${column},'$.${key}') h WHERE h.value='*' OR h.value=s.value))`
 const checks = dimensions.flatMap(key => [contains('c.scope',key),contains('m.scope',key)]).join(' AND ')
 const fence = { sql:`c.class='ingest' AND c.status='active' AND c.expires_at>? AND EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=c.custodian_id AND o.status='active' AND o.role=m.role AND m.role IN ('owner','admin') AND ${checks}) AND EXISTS(SELECT 1 FROM json_each(c.scope,'$.signals') WHERE value=?) AND EXISTS(SELECT 1 FROM json_each(c.scope,'$.actions') WHERE value='telemetry.write')`, args:[Date.now(),...dimensions.flatMap(() => [canonical(scope),canonical(scope)]),signal] }
 await env.DB.batch(eventStatements(env,hash,signal,records,scope,'rejected','credential_quota_exceeded',null,fence))
}
/** Malformed bodies are never acknowledged. Authenticated failures retain a
 * count only when parsing got far enough to count actual source records. */
export async function rejectEnvelope(request: Request, env: Bindings, signal: string, reason: string, records: TelemetryRecord[] = []) {
 const hash = await secretHash((request.headers.get('authorization') ?? '').slice(7))
 let granted: CredentialScope | undefined
 try {
  await verifyCredential(request,env,{action:'telemetry.write',scope:emptyScope,dataScope:allScope,writes(fence,scope) {
   // The write action authenticates the source; a denied signal still gets a
   // rejection receipt without permitting a telemetry write in that signal.
   granted=scope
   // Only account groups covered by the live credential; do not copy denied
   // foreign resource names into a ledger readable by its custodian.
   const permitted = records.filter(row => (scope.services.includes('*') || scope.services.includes(row.service)) && (scope.environments.includes('*') || scope.environments.includes(row.environment)) && (scope.teams.includes('*') || scope.teams.includes(row.team)))
   return eventStatements(env,hash,signal,permitted,scope,'rejected',reason,null,fence)
  }})
 } catch (error) {
  if (error instanceof CredentialLimit && granted) await recordQuotaRejection(env,hash,signal,records,granted)
  throw error
 }
}
