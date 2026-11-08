import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { readTelemetry } from '../../ingest/read'
import { remoteWrite } from '../../ingest/vendor'
import { unsnappy } from '../../ingest/wire'
import { canonical } from '../../ingest/model'
import { verifyCredential, CredentialLimit } from '../../credentials/verify'
import { allScope, emptyScope, fail } from '../../security/authority'
import { configuration, selected, fence as analyticalFence } from '../../analytical/client'

export interface StandardRow {id:string;batch_id:string;service:string;environment:string;team:string;span_id:string;trace_id:string;payload:Record<string,unknown>}
/** Bounded live read, with no detached cache, continuation token or export grant.
 * The native reader owns scope, completion snapshots and metered scans. */
export async function standardRead(request:Request,env:Bindings,signal:'metrics'|'traces',parameters:Record<string,string>) {
 const inspect=async()=>{
  const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  if(!auth.credential.scope.signals.includes(signal))fail('credential_scope_forbidden')
  return auth
 }
 const original=await inspect(),config=await configuration(env),rows:StandardRow[]=[]
 let snapshot:number|undefined,cursor:string|null=null,totalBytes=0,queryRef=''
 do {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [key,value]of Object.entries({signal,...parameters,limit:'200',...(snapshot===undefined?{}:{snapshot:String(snapshot)}),...(cursor?{cursor}:{})}))url.searchParams.set(key,value)
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env)
  if(!response.ok){const problem=await response.json() as {error:string};if(response.status===429)throw new CredentialLimit(Number(response.headers.get('retry-after')??1));throw new AuthError(problem.error,response.status)}
  const page=await response.json() as {snapshot:number;cursor:string|null;queryRef:string;records:StandardRow[]}
  snapshot=page.snapshot;cursor=page.cursor;queryRef=page.queryRef
  rows.push(...page.records);totalBytes+=new TextEncoder().encode(JSON.stringify(page.records)).length
  if(rows.length>2000||totalBytes>1024*1024||cursor&&rows.length>=2000)fail('standard_read_budget_exceeded',422)
 }while(cursor)
 // Older retained records predate float-bit metadata. Their original Snappy
 // envelope remains authoritative, including negative zero and stale NaN.
 const recovered=new Map<string,string>();let wireBytes=0
 for(const batchId of new Set(rows.filter(row=>row.payload.protocol==='prometheus.WriteRequest'&&!(row.payload.record as Record<string,unknown>).valueBits).map(row=>row.batch_id))){
  const batch=await env.DB.prepare('SELECT wire_base64 FROM porthole_ingest_batches WHERE id=?').bind(batchId).first<{wire_base64:string}>()
  if(!batch?.wire_base64)fail('standard_sample_wire_unavailable',409)
  wireBytes+=batch.wire_base64.length
  if(wireBytes>8*1024*1024)fail('standard_read_budget_exceeded',422)
  const decoded=remoteWrite(unsnappy(Uint8Array.from(atob(batch.wire_base64),c=>c.charCodeAt(0))),new Headers())
  for(const row of rows.filter(row=>row.batch_id===batchId)){
   const original=decoded[Number(row.id.split(':').at(-1))]?.payload.record as Record<string,unknown>|undefined
   if(!original?.valueBits)fail('standard_sample_wire_unavailable',409)
   recovered.set(row.id,String(original.valueBits))
  }
 }
 // Exclusions are intentionally additional to the native query rules. The
 // whole scanned set is verified, even records the protocol later filters out.
 const release=async()=>{
  const latest=await inspect()
  if(canonical([latest.credential.id,latest.credential.revision,latest.credential.scope])!==canonical([original.credential.id,original.credential.revision,original.credential.scope]))fail('authority_changed',409)
  const active=selected(env,config)?analyticalFence(config):{sql:'EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE singleton=1 AND revision=? AND changed_at=?)',args:[config.revision,config.changed_at]}
  const condition=`(${latest.fence.sql}) AND (${active.sql})`,args=[...latest.fence.args,...active.args]
  const checks=[env.DB.prepare(`SELECT 1 AS live WHERE ${condition}`).bind(...args)]
  for(let start=0;start<rows.length;start+=100){
   const chunk=rows.slice(start,start+100)
   checks.push(env.DB.prepare(`SELECT r.id,EXISTS(SELECT 1 FROM porthole_export_exclusions e WHERE e.record_id=r.id) AS excluded
    FROM json_each(?) j JOIN porthole_telemetry_records r ON r.id=json_extract(j.value,'$.id') JOIN porthole_ingest_batches b ON b.id=r.batch_id
    WHERE ${condition} AND b.state='complete' AND b.completion_sequence<=? AND json(r.payload)=json(json_extract(j.value,'$.payload'))
    AND NOT EXISTS(SELECT 1 FROM porthole_erased_batches e WHERE e.id=b.id OR e.content_digest=b.digest)`)
    .bind(JSON.stringify(chunk.map(row=>({id:row.id,payload:JSON.stringify(row.payload)}))),...args,snapshot))
  }
  const result=await env.DB.batch<{id:string;excluded:number}>(checks)
  if(!result[0].results.length)fail('authority_changed',409)
  if(result.slice(1).some((r,i)=>r.results.length!==Math.min(100,rows.length-i*100)))fail('standard_read_custody_changed',409)
  const permitted=new Set(result.slice(1).flatMap(r=>r.results.filter(row=>!row.excluded).map(row=>row.id)))
  return {records:rows.filter(row=>permitted.has(row.id)).map(row=>recovered.has(row.id)?{...row,payload:{...row.payload,record:{...row.payload.record as object,valueBits:recovered.get(row.id)}}}:row),headers:{'x-porthole-entity':queryRef,'x-porthole-actor':latest.credential.id,'x-porthole-actor-revision':String(latest.credential.revision),'x-porthole-snapshot':String(snapshot)}}
 }
 return release()
}
