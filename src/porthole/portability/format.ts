import { canonical, digest, genesis, type AuditEntry } from '../audit/store'
import { byTable, catalog } from './catalog'
import { validateBody } from '../objects/schema'
import { validateHealthHistory } from './health-history'
import { fail, parseScope, roles } from '../security/authority'

export const format = 'porthole.product-archive.v1'
export const chunkRows = 8
export interface PortableRow { table: string; row: Record<string, unknown> }
export interface Chunk { version: 1; index: number; previousHash: string; rows: PortableRow[]; digest: string }
export interface Manifest { format: typeof format; id: string; createdAt: number; rowCount: number; chunks: number; rootHash: string; tables: Record<string,number>; inactive: true }
export interface Validation { tables: Record<string,number>; audit: Record<string,{sequence:number;hash:string}> }
export const initialValidation = (): Validation => ({tables:Object.fromEntries(catalog.map(item=>[item.table,0])),audit:{}})
export const uuid = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const hex = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value)
const integer = (value: unknown, min=0): value is number => Number.isSafeInteger(value) && (value as number)>=min
const str = (value: unknown): value is string => typeof value==='string' && value.length<=2097152
const bad = (): never => fail('archive_semantics_invalid',422)
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value)
export function manifestInput(value: unknown): Manifest {
 if(!object(value) || Object.keys(value).sort().join(',')!==['format','id','createdAt','rowCount','chunks','rootHash','tables','inactive'].sort().join(',') || value.format!==format || !uuid(value.id) || !integer(value.createdAt) || !integer(value.rowCount) || !integer(value.chunks) || !hex(value.rootHash) || value.inactive!==true || !object(value.tables)) return bad()
 if(Object.keys(value.tables).sort().join(',')!==catalog.map(item=>item.table).sort().join(',') || Object.values(value.tables).some(v=>!integer(v)) || Object.values(value.tables).reduce<number>((a,b)=>a+(b as number),0)!==value.rowCount || value.chunks!==Math.ceil(value.rowCount/chunkRows)) return bad()
 if(value.tables.porthole_ingest_control!==1)bad()
 return value as unknown as Manifest
}
export async function chunkInput(value: unknown, index: number, previousHash: string, count?: number): Promise<Chunk> {
 if(!object(value) || Object.keys(value).sort().join(',')!=='digest,index,previousHash,rows,version' || value.version!==1 || value.index!==index || value.previousHash!==previousHash || !hex(value.digest) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length>chunkRows || count!==undefined && value.rows.length!==count) return bad()
 const {digest: claimed,...base}=value
 if(await digest(JSON.stringify(base))!==claimed) fail('archive_integrity_failed',422)
 return value as unknown as Chunk
}
function json(value: unknown): unknown {
 if(!str(value)) return bad()
 try { return JSON.parse(value) } catch { return bad() }
}
export async function validateRow(payload: PortableRow, state: Validation): Promise<void> {
 if(!object(payload) || Object.keys(payload).sort().join(',')!=='row,table' || !str(payload.table) || !object(payload.row)) bad()
 const item=byTable.get(payload.table); if(!item) return bad()
 const row=payload.row
 if(Object.keys(row).sort().join(',')!==[...item.columns].sort().join(',')) bad()
 for(const value of Object.values(row)) if(value!==null && typeof value!=='string' && !integer(value)) bad()
 const required=(...keys:string[])=>{for(const key of keys)if(!str(row[key]) || !(row[key] as string).length)bad()}
 if(item.table==='porthole_objects') {
  if(!uuid(row.id) || !['monitor','repair'].includes(String(row.kind)) || !str(row.name) || !integer(row.revision,1) || !integer(row.created_at) || !integer(row.updated_at) || !['active','inactive','approved','archived','quarantined','pending','paused','draft'].includes(String(row.state))) bad()
  parseScope(json(row.scope)); const body=json(row.body); if(!object(body)) bad(); validateBody(String(row.kind),body)
 } else if(item.table==='porthole_archive_quarantine') {
  if(!uuid(row.object_id)||!uuid(row.archive_id)||!str(row.source_state)||!integer(row.restored_at)||row.collection!=='paused'||row.schedules!=='paused'||row.delivery!=='quarantined'||row.execution!=='paused'||row.leases!=='interrupted')bad()
 } else if(item.table==='porthole_archive_actors') {
  if(!uuid(row.actor_ref) || !roles.includes(row.role as never) || row.state!=='inactive')bad()
  parseScope(json(row.scope))
 } else if(item.table==='porthole_query_snapshots') {
  if(!uuid(row.id)||!uuid(row.actor_ref)||!['logs','metrics','traces'].includes(String(row.signal))||!integer(row.through_batch)||!integer(row.created_at)||!/^\d{20}$/.test(String(row.from_ns))||!/^\d{20}$/.test(String(row.through_ns))||String(row.from_ns)>String(row.through_ns))bad()
  const descriptor=json(row.scope) as Record<string,unknown>
  if(!object(descriptor) || Object.keys(descriptor).some(key=>!['service','environment','team','cursor','limit'].includes(key)))bad()
  for(const key of ['service','environment','team'])if(descriptor[key]!==undefined && (typeof descriptor[key]!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(descriptor[key]))))bad()
  if(descriptor.cursor!==undefined && (typeof descriptor.cursor!=='string' || descriptor.cursor.length>512))bad()
  if(descriptor.limit!==undefined && (!Number.isSafeInteger(Number(descriptor.limit)) || Number(descriptor.limit)<1 || Number(descriptor.limit)>200))bad()
 } else if(item.table==='porthole_erased_actors') {
  if(!uuid(row.actor_ref)||!integer(row.erased_at))bad()
 } else if(item.table==='porthole_archive_audit') {
  if(!uuid(row.stream)||!integer(row.sequence,1)||!(uuid(row.event_id)||typeof row.event_id==='string'&&/^[a-f0-9]{32}$/.test(row.event_id))||!hex(row.previous_hash)||!hex(row.hash))bad()
  const entry=json(row.entry) as AuditEntry
  if(!object(entry)||Object.keys(entry).sort().join(',')!==['version','sequence','eventId','previousHash','operationRef','actorRef','actorRevision','action','entityRef','revision','phase','status','occurredAt','recordedAt','rangeStart','rangeEnd'].sort().join(',')||entry.version!==1||!uuid(entry.operationRef)||entry.actorRef!==null&&!uuid(entry.actorRef)||entry.entityRef!==null&&!uuid(entry.entityRef)||!integer(entry.occurredAt)||!integer(entry.recordedAt)||!['attempted','committed','succeeded','denied','failed'].includes(entry.phase)||typeof entry.action!=='string'||!/^[a-zA-Z0-9_.:-]{1,120}$/.test(entry.action))bad()
  for(const key of ['actorRevision','revision','status','rangeStart','rangeEnd'] as const)if(entry[key]!==null&&!integer(entry[key]))bad()
  const head=state.audit[String(row.stream)]??{sequence:0,hash:genesis}
  if(!object(entry)||entry.sequence!==head.sequence+1||entry.sequence!==row.sequence||entry.eventId!==row.event_id||entry.previousHash!==head.hash||row.previous_hash!==head.hash||await digest(canonical(entry))!==row.hash)fail('archive_audit_integrity_failed',422)
  state.audit[String(row.stream)]={sequence:entry.sequence,hash:row.hash as string}
 } else if(item.table==='porthole_archive_health_history') {
  validateHealthHistory(row)
 } else if(item.table==='porthole_monitor_evaluations') {
  if(!uuid(row.id)||!uuid(row.object_id)||!integer(row.revision,1)||!integer(row.evaluated_at)||!/^\d{20}$/.test(String(row.window_start_ns))||!/^\d{20}$/.test(String(row.window_end_ns))||String(row.window_start_ns)>String(row.window_end_ns)||!['Healthy','Firing','Unknown'].includes(String(row.status))||row.observed_count!==null&&!integer(row.observed_count)||!str(row.reason)||row.firing_episode!==null&&!str(row.firing_episode))bad()
 } else if(item.table==='porthole_ingest_control') {
  if(row.singleton!==1||![0,1].includes(row.paused as number)||!integer(row.max_pending_bytes,1)||!integer(row.revision,1)||!integer(row.changed_at))bad()
 } else if(item.table==='porthole_ingest_batches') {
  required('id','source_id','identity','protocol'); if(!str(row.wire_base64))bad();try{atob(String(row.wire_base64))}catch{return bad()}; if(!['traces','metrics','logs'].includes(String(row.signal))||!hex(row.digest)||!integer(row.accepted_at)||!integer(row.byte_count)||!integer(row.record_count)||!integer(row.sequence,1)||row.completion_sequence!==null&&!integer(row.completion_sequence,1)||!['pending','complete'].includes(String(row.state))||row.completed_at!==null&&!integer(row.completed_at))bad()
  const records=json(row.records);if(!Array.isArray(records)||records.length!==row.record_count)bad()
  if(row.state==='pending'&&(row.completed_at!==null||row.completion_sequence!==null)||row.state==='complete'&&(!integer(row.completed_at)||!integer(row.completion_sequence,1)))bad()
  for(const raw of records as unknown[]) {
   if(!object(raw))return bad()
   const entry:Record<string,unknown>=raw
   if(Object.keys(entry).sort().join(',')!=='environment,eventTimeNs,late,outOfOrder,payload,service,spanId,team,traceId'||!object(entry.payload)||!/^\d{20}$/.test(String(entry.eventTimeNs))||BigInt(String(entry.eventTimeNs))>18446744073709551615n||![0,1].includes(entry.late as number)||![0,1].includes(entry.outOfOrder as number))bad()
   for(const key of ['team','service','environment'])if(typeof entry[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(entry[key])))bad()
   if(entry.traceId!==null&&!/^[a-f0-9]{32}$/.test(String(entry.traceId))||entry.spanId!==null&&!/^[a-f0-9]{16}$/.test(String(entry.spanId)))bad()
  }
 } else if(['porthole_telemetry_records','porthole_telemetry_archive'].includes(item.table)) {
  required('id','batch_id','source_id','team','service','environment');if(!integer(row.ordinal)||!['traces','metrics','logs'].includes(String(row.signal))||typeof row.event_time_ns!=='string'||!/^\d{20}$/.test(row.event_time_ns)||row.trace_id!==null&&!/^[a-f0-9]{32}$/.test(String(row.trace_id))||row.span_id!==null&&!/^[a-f0-9]{16}$/.test(String(row.span_id)))bad()
  if(!object(json(row.payload)))bad()
  if(item.table==='porthole_telemetry_records'&&(!integer(row.indexed_at)||![0,1].includes(row.late as number)||![0,1].includes(row.out_of_order as number))||item.table==='porthole_telemetry_archive'&&!integer(row.archived_at))bad()
 } else {
  required('id','source_id','reason');for(const key of ['team','service','environment'])if(!str(row[key]))bad();if(!['traces','metrics','logs','profiles'].includes(String(row.signal))||!['rejected','duplicate','source_loss','buffer_loss'].includes(String(row.kind))||!integer(row.occurred_at)||row.record_count!==null&&!integer(row.record_count))bad()
  for(const key of ['range_start_ns','range_end_ns'])if(row[key]!==null&&!/^\d{20}$/.test(String(row[key])))bad()
 }
 state.tables[item.table]++
}
