import {assertNoCredentials,liveCredentialRemoved,removeCredentials} from '../../../modules/import-kit/src/provenance/credentials.ts'
import type {Json} from '../../../modules/import-kit/src/types.ts'
import {fail} from '../../security/authority'
import {sources} from '../sources'
import {splunkCollections} from '../splunk/source'
import {challengerCollections} from '../challengers/source'
import {custodyByTable} from './catalog'

export type Row=Record<string,unknown>
export interface CustodyRow {stream:string;source_table:string;source_key:string;body:string;state:'inactive'}
export const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value)
export function invalid():never {return fail('migration_custody_invalid',422)}
export const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const numeric=new Set(['ordinal','effect_ordinal','size','total_bytes','total_chunks','complete','checkpoint','total','fence','reversal_cursor','version','reversed','position','end_position','released','records_erased','jobs_retired','streams_retired'])
const nullable=new Set(['head_id','pending_id','previous_id','actor_ref','error','reversal_policy_hash','reversal_conversion_hash','bytes'])
/** Match the reader's credential policy, including structured JSON embedded in
 * source fields. No string from this scan is authority or included in errors. */
export function inspectCredentials(value:unknown,depth=0):void {
 if(depth>32)invalid()
 try {
  const clean=removeCredentials(value as Json)
  if(clean.removed.some(liveCredentialRemoved))fail('migration_custody_holds_credentials',422)
  assertNoCredentials(clean.value)
 }catch(error){if(error instanceof Error&&'code' in error)throw error;fail('migration_custody_holds_credentials',422)}
 const encoded=(item:unknown):void=>{
  if(Array.isArray(item)){for(const child of item)encoded(child)}
  else if(object(item)){for(const child of Object.values(item))encoded(child)}
  else if(typeof item==='string'&&/(?:^|\n)(?:event|data):/.test(item)){
   // Rejected source records still have original bytes in custody. Inspect
   // every JSON data payload without granting validity to its SSE protocol.
   const values:unknown[]=[]
   for(const frame of item.replaceAll('\r\n','\n').replaceAll('\r','\n').split('\n\n')){
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n')
    if(!data)continue
    try{values.push(JSON.parse(data))}catch{return invalid()}
   }
   if(!values.length)return invalid()
   inspectCredentials(values,depth+1)
  }else if(typeof item==='string'&&/^\s*[\[{]/.test(item)){
   let decoded:unknown;try{decoded=JSON.parse(item)}catch{return}
   inspectCredentials(decoded,depth+1)
  }
 }
 encoded(value)
}
export function parseJson(value:unknown):unknown {
 if(typeof value!=='string')return invalid()
 try{return JSON.parse(value)}catch{return invalid()}
}
export function validateCustodyRow(value:Row):CustodyRow {
 if(!uuid(value.stream)||value.state!=='inactive'||typeof value.source_table!=='string'||typeof value.source_key!=='string'||typeof value.body!=='string')invalid()
 const spec=custodyByTable.get(String(value.source_table)),row=parseJson(value.body)
 if(!spec||!object(row)||Object.keys(row).sort().join(',')!==[...spec.columns].sort().join(','))return invalid()
 if(value.source_key!==JSON.stringify(spec.key.map(key=>row[key])))invalid()
 for(const [key,child]of Object.entries(row)){
  if(child===null){if(!nullable.has(key)&&!(key==='job_id'&&spec.table==='ik_door_plans'))invalid();continue}
  if(numeric.has(key)){if(!Number.isSafeInteger(child)||Number(child)<0)invalid()}
  else if(typeof child!=='string'||child.length>2097152)invalid()
  if(['fingerprint','bundle_sha256','snapshot_hash','sha256','source_hash','effects_hash','reversal_hash','reversal_policy_hash','reversal_conversion_hash'].includes(key)&&!hex(child))invalid()
  if(key.endsWith('_json')&&key!=='plan_json')parseJson(child)
 }
 if('destination' in row&&row.destination!=='migration-evidence')invalid()
 if('principal_id' in row&&row.principal_id!=='role:owner')invalid()
 if('installation_id' in row&&row.installation_id!=='porthole-migration-v1')invalid()
 if(spec.table.startsWith('ik_door_')&&'namespace' in row&&!sources.includes(String(row.namespace)))invalid()
 if(spec.table==='ik_door_approval_history'&&(!uuid(row.actor_ref)&&row.actor_ref!==null||row.reviewer_kind!=='native-owner'||!Number.isFinite(Date.parse(String(row.approved_at)))))invalid()
 if(spec.table==='ik_jobs'&&(!['queued','applying','completed','failed','undoing','undone','rolling_back','rolled_back'].includes(String(row.state))||Number(row.checkpoint)>Number(row.total)||!['strict','preserve-conflicts'].includes(String(row.reversal_policy))))invalid()
 if(spec.table==='ik_original_sets'&&row.version!==3)fail('migration_custody_domain_unsupported',409)
 if(spec.table==='ik_originals'&&row.bytes!==null)fail('migration_custody_domain_unsupported',409)
 if(spec.table==='ik_door_plans'&&![0,1].includes(Number(row.complete)))invalid()
 if(['ik_provenance','ik_d1_history'].includes(spec.table)&&![0,1].includes(Number(row.reversed)))invalid()
 // Partial chunks are scanned only after their complete source document is
 // reassembled. Scanning a fragment as JSON cannot establish secret exclusion.
 if(!['ik_door_chunks','ik_door_archive_chunks','ik_door_plan_chunks','ik_d1_plan_chunks','ik_d1_creation_plans','ik_d1_original_chunks'].includes(spec.table))inspectCredentials(row)
 return value as unknown as CustodyRow
}
export function validateMigrationRecord(row:Row):void {
 if(typeof row.kind!=='string'||typeof row.id!=='string'||typeof row.revision!=='string'||!uuid(row.revision)&&!hex(row.revision))invalid()
 const body=parseJson(row.body)
 if(!object(body)||!sources.includes(String(body.vendor))||body.kind!==row.kind||!String(row.id).startsWith(`${body.vendor}:${row.kind}:`)||body.status!=='source-evidence'||!object(body.definition)||!object(body.review)||body.review.cutover!=='blocked')invalid()
 const collections=body.vendor==='splunk'?splunkCollections:challengerCollections[String(body.vendor)]
 if(!collections?.includes(String(row.kind) as never)||Object.keys(body).some(key=>!['vendor','kind','definition','status','qualification','review','sourceTopology','specialist','handoff','humanResolutions'].includes(key)))invalid()
 if(body.sourceTopology!==undefined&&!(body.vendor==='splunk'&&row.kind==='services'&&object(body.sourceTopology)&&Array.isArray(body.sourceTopology.nodes)&&Array.isArray(body.sourceTopology.edges)))invalid()
 inspectCredentials(body)
}
