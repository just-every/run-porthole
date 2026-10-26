import {Buffer} from 'node:buffer'
import type {ImportPlan,SourceArtifact} from '../../../modules/import-kit/src/types.ts'
import {planFingerprint,validateEffect} from '../../../modules/import-kit/src/plan/index.ts'
import {assertPlanCredentials} from '../../../modules/import-kit/src/provenance/credentials.ts'
import {canonicalJson,sha256,sourceIdentity} from '../../../modules/import-kit/src/provenance/identity.ts'
import {validateArtifactOriginal} from '../../../modules/import-kit/src/storage/originals.ts'
import {fail} from '../../security/authority'
import {inspectCredentials,invalid,object,parseJson,type Row} from './rows'

export function chunkText(chunks:Row[],field='body'):string {
 chunks.sort((a,b)=>Number(a.ordinal)-Number(b.ordinal))
 if(chunks.some((row,index)=>row.ordinal!==index||typeof row[field]!=='string'))invalid()
 return chunks.map(row=>String(row[field])).join('')
}
export function sourceBytes(header:Row,chunks:Row[]):void {
 chunkText(chunks,'base64')
 const parts=chunks.map(chunk=>{const part=Buffer.from(String(chunk.base64),'base64');if(part.toString('base64')!==chunk.base64||part.length!==chunk.size||sha256(part)!==chunk.sha256)invalid();return part})
 const bytes=Buffer.concat(parts)
 if(chunks.length!==header.total_chunks||bytes.length!==header.total_bytes||sha256(bytes)!==header.bundle_sha256)invalid()
 let value:unknown
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{return invalid()}
 inspectCredentials(value)
}
export function validatePlan(value:unknown):ImportPlan {
 if(!object(value)||value.version!==1||value.destination!=='migration-evidence'||value.principalId!=='role:owner'||!Array.isArray(value.entries)||!object(value.source)||!Array.isArray(value.source.artifacts)||!Array.isArray(value.source.records))return invalid()
 const plan=value as unknown as ImportPlan
 if(planFingerprint(plan)!==plan.fingerprint)invalid()
 inspectCredentials(plan)
 try{
  assertPlanCredentials(plan)
  for(const artifact of plan.source.artifacts)validateArtifactOriginal(artifact)
  for(const entry of plan.entries){
   if(entry.source.namespace!==plan.namespace||sha256(canonicalJson(entry.source.payload))!==entry.source.payloadHash)invalid()
   if(entry.erased){
    // The official erasure format keeps the original opaque identity while
    // replacing its source ID and payload. Re-deriving identity from the
    // replacement would reject a correctly erased, compatible archive.
    if(!/^[a-f0-9]{64}$/.test(entry.identity)||entry.source.sourceId!==`erased:${entry.identity}`||canonicalJson(entry.source.payload)!=='{"erased":true}'||entry.effects.length||typeof entry.erasedTargetIdentity!=='string'||!/^[a-f0-9]{64}$/.test(entry.erasedTargetIdentity)||!plan.erasure||!/^[a-f0-9]{64}$/.test(plan.erasure.reviewedFingerprint)||Object.keys(entry.source.location).join(',')!=='artifact')invalid()
   }else if(entry.identity!==sourceIdentity(plan.destination,plan.namespace,entry.source.kind,entry.source.sourceId))invalid()
   for(const effect of entry.effects)validateEffect(effect)
  }
 }catch{return invalid()}
 return plan
}
export function doorSnapshot(header:Row,chunks:Row[]):ImportPlan|null {
 if(!chunks.length)return null // Erasure withdraws snapshots and keeps headers.
 if(header.complete!==1)fail('migration_custody_domain_unsupported',409)
 const value=parseJson(chunkText(chunks))
 if(!object(value)||sha256(canonicalJson(value))!==header.snapshot_hash||value.id!==header.id||value.namespace!==header.namespace||value.bundleSha256!==header.bundle_sha256||value.previous!==header.previous_id||value.standingApproval!==null)invalid()
 const plan=validatePlan(value.plan)
 if(plan.fingerprint!==header.fingerprint||plan.namespace!==value.kitNamespace||!Array.isArray(value.records)||value.records.length<Number(value.sourceCount)||value.sourceCount!==plan.entries.length)invalid()
 return plan
}
export function jobPlan(header:Row,chunks:Row[]):ImportPlan {
 const encoded=parseJson(header.plan_json)
 let value=encoded
 if(object(encoded)&&encoded.d1Plan===1){
  const text=chunkText(chunks)
  if(chunks.length!==encoded.chunks||Buffer.byteLength(text)!==encoded.size||sha256(text)!==encoded.sha256)invalid()
  value=parseJson(text)
 }else if(chunks.length)invalid()
 if(object(value)&&'d1Plan' in value)fail('migration_custody_domain_unsupported',409)
 const plan=validatePlan(value)
 if(plan.fingerprint!==header.fingerprint||plan.namespace!==header.namespace||plan.mappingVersion!==header.mapping_version||plan.entries.length!==header.total)invalid()
 return plan
}
export function originalBytes(header:Row,chunks:Row[]):void {
 if(!chunks.length)return
 if(header.kind!=='artifact')fail('migration_custody_domain_unsupported',409)
 const base64=chunkText(chunks,'bytes')
 const artifact={name:header.name,size:header.size,sha256:header.sha256,original:{status:'available',base64}} as SourceArtifact
 try{validateArtifactOriginal(artifact)}catch{return invalid()}
 // Only the current JSON file door is qualified. Binary or unreadable source
 // originals cannot be treated as proof of credential exclusion.
 const bytes=Buffer.from(base64,'base64')
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{return invalid()}
 inspectCredentials(value)
}
