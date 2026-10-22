import { fail } from '../security/authority'
import { maxHistoryBytes, type HistoryReference } from './model'

export async function bytesFrom(stream: ReadableStream<Uint8Array> | null, maximum=maxHistoryBytes): Promise<Uint8Array> {
 if(!stream)fail('history_bytes_required',400)
 const reader=stream.getReader(),chunks:Uint8Array[]=[]
 let size=0
 while(true){
  const {value,done}=await reader.read();if(done)break
  size+=value.length
  if(size>maximum){await reader.cancel();fail('history_bytes_too_large',413)}
  chunks.push(value)
 }
 if(!size)fail('history_bytes_required',400)
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 return bytes
}
export async function bytesDigest(bytes: Uint8Array): Promise<string> {
 const hash=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')
}
/** Metadata alone cannot prove original bytes. Read and hash the actual object
 * before either releasing contents or granting destination read authority. */
export async function verifiedObject(bucket: R2Bucket, reference: HistoryReference): Promise<Uint8Array> {
 const head=await bucket.head(reference.object_key)
 if(!head)fail('history_object_missing',409)
 if(head.size!==reference.byte_count)fail('history_integrity_failed',422)
 const object=await bucket.get(reference.object_key)
 if(!object)fail('history_object_missing',409)
 if(object.size!==reference.byte_count){await object.body.cancel();fail('history_integrity_failed',422)}
 const bytes=await bytesFrom(object.body,reference.byte_count)
 if(bytes.length!==reference.byte_count || await bytesDigest(bytes)!==reference.sha256)fail('history_integrity_failed',422)
 return bytes
}
/** Never overwrite a historical key, even during reauthorization. A conflicting
 * destination object is evidence of a mismatch and must remain a refusal. */
export async function placeObject(bucket: R2Bucket, reference: HistoryReference, bytes: Uint8Array): Promise<void> {
 if(bytes.length!==reference.byte_count || await bytesDigest(bytes)!==reference.sha256)fail('history_integrity_failed',422)
 if(!await bucket.head(reference.object_key)) {
  await bucket.put(reference.object_key,bytes,{
   onlyIf:{etagDoesNotMatch:'*'},sha256:reference.sha256,
   httpMetadata:{contentType:reference.content_type},
   customMetadata:{sha256:reference.sha256,source:reference.source_label,history:reference.history_label},
  })
 }
 await verifiedObject(bucket,reference)
}
