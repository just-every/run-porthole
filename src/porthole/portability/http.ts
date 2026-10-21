import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { authority, fail } from '../security/authority'
import { document, escape, privateHeaders } from '../document'
import { uuid } from './format'
import { exportChunk, exportManifest, jobFor, jobStatus, startExport } from './store'
import { commitRestore, stageChunk, startRestore } from './restore'
import { archivePage, pageRoot } from './page'
const api='/api/porthole/v1/archive'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
const download=(value:unknown,name:string)=>{const response=json(value);response.headers.set('content-disposition',`attachment; filename="${name}"`);return response}
async function body(request:Request):Promise<Record<string,unknown>> {
 const type=request.headers.get('content-type')??'',reader=request.body?.getReader();if(!reader)fail('invalid_input',400)
 const chunks:Uint8Array[]=[];let size=0
 while(true){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>33554432){await reader.cancel();fail('archive_chunk_too_large',413)}chunks.push(result.value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try {
  if(type.startsWith('application/json')){const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_input',400);return value as Record<string,unknown>}
  if(type.startsWith('multipart/form-data')||type.startsWith('application/x-www-form-urlencoded')) {
   const form=await new Response(bytes,{headers:{'content-type':type}}).formData(),data:Record<string,unknown>={}
   for(const [key,value]of form){if(key in data)fail('invalid_input',400);const text=typeof value==='string'?value:await value.text();data[key]=['manifest','chunk'].includes(key)?JSON.parse(text):text}return data
  }
  fail('unsupported_media_type',415)
 } catch(error){if(error instanceof AuthError)throw error;return fail('invalid_input',400)}
}
export async function archiveResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname===pageRoot||url.pathname.startsWith(pageRoot+'/'),isApi=url.pathname===api||url.pathname.startsWith(api+'/')
 if(!page&&!isApi)return null
 try {
  const post=request.method==='POST'
  if(!post&&request.method!=='GET')fail('method_not_allowed',405)
  const actor=await authority(request,env,{post,stepUp:!(page&&request.method==='GET'&&url.pathname===pageRoot)})
  if(actor.member.role!=='owner')fail('owner_required')
  if(actor.session.kind!=='native')fail('native_session_required')
  const redirect=(id:string)=>new Response(null,{status:303,headers:{...privateHeaders,location:`${pageRoot}/jobs/${id}`}})
  if(page&&url.pathname===pageRoot&&request.method==='GET'){if(url.search)fail('invalid_cursor',400);return archivePage()}
  if(url.search&&!(isApi&&url.pathname.startsWith(api+'/audit/')))fail('invalid_cursor',400)
  if(post&&[api+'/exports',pageRoot+'/export'].includes(url.pathname)){
   const job=await startExport(env.DB,actor);return page?redirect(job.id):json(jobStatus(job),201)
  }
  if(post&&[api+'/restores',pageRoot+'/restore'].includes(url.pathname)){
   const data=await body(request),job=await startRestore(env.DB,actor,data.manifest);return page?redirect(job.id):json(jobStatus(job),201)
  }
  if(isApi&&url.pathname===api+'/audit'&&request.method==='GET') {
   const streams=(await env.DB.prepare('SELECT stream,MAX(sequence) AS sequence FROM porthole_archive_audit GROUP BY stream ORDER BY stream').all<{stream:string;sequence:number}>()).results
   const heads=await Promise.all(streams.map(async stream=>({...stream,hash:(await env.DB.prepare('SELECT hash FROM porthole_archive_audit WHERE stream=? AND sequence=?').bind(stream.stream,stream.sequence).first<{hash:string}>())!.hash})))
   return json({streams:heads})
  }
  const audit=url.pathname.match(/^\/api\/porthole\/v1\/archive\/audit\/([a-f0-9-]+)$/)
  if(audit&&request.method==='GET'){
   if(!uuid(audit[1])||[...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1||!/^(0|[1-9][0-9]*)$/.test(url.searchParams.get('after')??'0'))fail('invalid_cursor',400)
   const after=Number(url.searchParams.get('after')??0);if(!Number.isSafeInteger(after))fail('invalid_cursor',400)
   const records=(await env.DB.prepare('SELECT sequence,hash,entry FROM porthole_archive_audit WHERE stream=? AND sequence>? ORDER BY sequence LIMIT 100').bind(audit[1],after).all<{sequence:number;hash:string;entry:string}>()).results
   return json({stream:audit[1],records:records.map(row=>({hash:row.hash,entry:JSON.parse(row.entry)})),next:records.length===100?records.at(-1)!.sequence:null})
  }
  const match=isApi?url.pathname.match(/^\/api\/porthole\/v1\/archive\/(exports|restores)\/([a-f0-9-]+)(?:\/(manifest|chunks|commit)(?:\/(0|[1-9][0-9]*))?)?$/):url.pathname.match(/^\/app\/settings\/archive\/jobs\/([a-f0-9-]+)(?:\/(chunk|commit))?$/)
  if(!match)fail('archive_not_found',404)
  const id=isApi?match[2]:match[1],operation=isApi?match[3]:match[2]
  if(!uuid(id))fail('archive_not_found',404)
  let job=await jobFor(env.DB,id,actor,isApi?(match[1]==='exports'?'export':'restore'):undefined)
  if(!operation&&request.method==='GET')return page?archivePage(job):json(jobStatus(job))
  if(job.direction==='export'&&request.method==='GET') {
   if(operation==='manifest')return download(await exportManifest(env.DB,actor,job),'manifest.json')
   if(operation==='chunks'&&match[4]!==undefined){const index=Number(match[4]);if(!Number.isSafeInteger(index))fail('invalid_cursor',400);const chunk=await exportChunk(env.DB,actor,job,index);return chunk?download(chunk,`chunk-${index}.json`):new Response(null,{status:204,headers:privateHeaders})}
  }
  if(job.direction==='restore'&&post){
   const data=await body(request)
   if(operation==='chunks'||operation==='chunk')job=await stageChunk(env.DB,actor,job,data.chunk)
   else if(operation==='commit')job=await commitRestore(env.DB,actor,job,data.confirm)
   else fail('method_not_allowed',405)
   return page?redirect(job.id):json(jobStatus(job))
  }
  fail('method_not_allowed',405)
 } catch(error) {
  const status=error instanceof AuthError?error.status:503,code=error instanceof AuthError?error.code:'archive_unavailable'
  return page?document('Archive unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}.</p><p><a href="/auth/settings">Verify your native identity</a> · <a href="${pageRoot}">Return to Archive</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
