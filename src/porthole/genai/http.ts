import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {privateHeaders} from '../document'
import {readTelemetry} from '../ingest/read'
import {authority,fail} from '../security/authority'
import type {TraceRecord} from '../traces/graph'
import {genaiView} from './model'
import {genaiPage} from './page'

export async function genaiResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname==='/app/genai'
 if(!page&&url.pathname!=='/api/porthole/v1/genai')return null
 try{
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(page)await authority(request,env)
  if([...url.searchParams.keys()].some(key=>!['trace','service','environment','team','from','through','cursor','snapshot'].includes(key)))fail('invalid_query',400)
  const target=new URL('/api/porthole/v1/ingest/records',url)
  for(const [key,value]of url.searchParams)if(value)target.searchParams.set(key,value)
  target.searchParams.set('signal','traces');target.searchParams.set('limit',url.searchParams.get('trace')?'2000':'200')
  const response=await readTelemetry(new Request(target,{headers:request.headers}),env)
  if(!response.ok){if(!page)return response;const result=await response.json() as {error:string};return genaiPage(undefined,url.searchParams.get('trace')??'',null,response.status,result.error)}
  const data=await response.json() as {records:TraceRecord[];snapshot:number;cursor:string|null;analytical?:unknown}
  const view=genaiView(data.records,!!data.cursor)
  const next=new URL(url);if(data.cursor){next.searchParams.set('snapshot',String(data.snapshot));next.searchParams.set('cursor',data.cursor)}
  const result=page?await genaiPage(view,url.searchParams.get('trace')??'',data.cursor?next.pathname+next.search:null):Response.json({...view,snapshot:data.snapshot,cursor:data.cursor,...(data.analytical?{analytical:data.analytical}:{})},{headers:privateHeaders})
  for(const header of ['x-porthole-entity','x-porthole-actor','x-porthole-actor-revision']){const value=response.headers.get(header);if(value)result.headers.set(header,value)}
  return result
 }catch(error){const code=error instanceof AuthError?error.code:'genai_unavailable',status=error instanceof AuthError?error.status:503;return page?genaiPage(undefined,'',null,status,code):Response.json({error:code},{status,headers:privateHeaders})}
}
