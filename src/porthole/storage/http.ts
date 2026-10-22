import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../document'
import { authority, fail } from '../security/authority'
import { input } from '../security/input'
import { archiveBucket, historyColumns, historyId, historyKey, historyLabel, historyTypes, type HistoryReference, type StorageBindings } from './model'
import { bytesDigest, bytesFrom, placeObject, verifiedObject } from './objects'
import { authorizeHistory, historyFor, historyGuard, liveRead, saveHistory } from './store'

export const historyRoot='/api/porthole/v1/storage/history'
const json=(value: unknown,status=200,headers: Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...headers}})
const entity=(reference: HistoryReference)=>({'x-porthole-entity':reference.id})
/** The installation's binding supplies bucket access. No HTTP input, archive
 * row, or restored source reference can supply credentials or choose a binding. */
export async function bucketHistoryResponse(request: Request, bindings: Bindings): Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!==historyRoot && !url.pathname.startsWith(historyRoot+'/'))return null
 const env=bindings as StorageBindings
 try {
  const post=request.method==='POST'
  if(!post && !['GET','HEAD'].includes(request.method))fail('method_not_allowed',405)
  const actor=await authority(request,env,{post,stepUp:post})
  if(actor.member.role!=='owner')fail('owner_required')
  if(actor.session.kind!=='native')fail('native_session_required')
  if(url.pathname===historyRoot) {
   if(request.method==='GET') {
    if([...url.searchParams.keys()].some(key=>key!=='after') || url.searchParams.getAll('after').length>1 || url.searchParams.has('after')&&!historyId(url.searchParams.get('after')))fail('invalid_history_cursor',400)
    const rows=(await env.DB.prepare(`SELECT ${historyColumns.join(',')} FROM porthole_bucket_history WHERE id>? AND ${actor.fence} ORDER BY id LIMIT 101`).bind(url.searchParams.get('after')??'',...actor.args).all<HistoryReference>()).results
    await liveRead(env.DB,actor)
    return json({references:rows.slice(0,100),next:rows.length>100?rows[99].id:null})
   }
   if(!post)fail('method_not_allowed',405)
   if(url.search)fail('invalid_history_query',400)
   const source=request.headers.get('x-porthole-source'),history=request.headers.get('x-porthole-history'),type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
   if(!historyLabel(source)||!historyLabel(history))fail('history_labels_required',400)
   if(!type || !historyTypes.has(type))fail('unsupported_history_format',415)
   const bucket=archiveBucket(env),bytes=await bytesFrom(request.body),sha256=await bytesDigest(bytes),id=crypto.randomUUID()
   const reference:HistoryReference={id,source_binding:'ARCHIVE_BUCKET',object_key:historyKey(id,sha256),sha256,byte_count:bytes.length,content_type:type,source_label:source,history_label:history,created_at:Date.now(),state:'active'}
   await env.DB.batch([historyGuard(env.DB,actor)])
   await placeObject(bucket,reference,bytes)
   await saveHistory(env.DB,actor,reference)
   return json(reference,201,entity(reference))
  }
  if(url.search)fail('invalid_history_query',400)
  const match=url.pathname.slice(historyRoot.length).match(/^\/([a-f0-9-]+)(?:\/(content|reauthorize))?$/)
  if(!match || !historyId(match[1]))fail('history_not_found',404)
  const reference=await historyFor(env.DB,match[1])
  if(!match[2] && request.method==='GET') {await liveRead(env.DB,actor);return json(reference,200,entity(reference))}
  if(match[2]==='content' && ['GET','HEAD'].includes(request.method)) {
   if(reference.state!=='active')fail('history_quarantined',409)
   const bytes=await verifiedObject(archiveBucket(env),reference)
   await liveRead(env.DB,actor)
   return new Response(request.method==='HEAD'?null:new Uint8Array(bytes).buffer,{headers:{...privateHeaders,...entity(reference),'content-type':reference.content_type,'content-length':String(reference.byte_count),'content-disposition':`attachment; filename="${reference.id}"`,'x-porthole-sha256':reference.sha256,'x-porthole-source':reference.source_label,'x-porthole-history':reference.history_label}})
  }
  if(match[2]==='reauthorize' && post) {
   if(reference.state!=='quarantined')fail('history_already_authorized',409)
   const bucket=archiveBucket(env)
   // Reattach bytes through the same public door if the new installation has
   // a different bucket. This permits only the exact archived digest and key.
   if(request.headers.get('x-porthole-confirm')==='reauthorize-history') {
    const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if(type!==reference.content_type)fail('history_format_mismatch',400)
    const bytes=await bytesFrom(request.body,reference.byte_count)
    await env.DB.batch([historyGuard(env.DB,actor)])
    await placeObject(bucket,reference,bytes)
   } else {
    const data=await input(request)
    if(Object.keys(data).sort().join(',')!=='confirm,sha256' || data.confirm!=='reauthorize-history' || data.sha256!==reference.sha256)fail('history_confirmation_required',400)
    await verifiedObject(bucket,reference)
   }
   await authorizeHistory(env.DB,actor,reference.id)
   return json({...reference,state:'active'},200,entity(reference))
  }
  fail('method_not_allowed',405)
 } catch(error) {
  return json({error:error instanceof AuthError?error.code:'bucket_history_unavailable'},error instanceof AuthError?error.status:503)
 }
}
