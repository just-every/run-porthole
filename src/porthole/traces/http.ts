import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { privateHeaders } from '../document'
import { readTelemetry } from '../ingest/read'
import { authority,fail } from '../security/authority'
import { traceGraph,type TraceRecord } from './graph'
import { tracePage } from './page'

export async function traceResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname==='/app/traces'||url.pathname.startsWith('/app/traces/'),api=url.pathname.startsWith('/api/porthole/v1/traces/')
 if(!page&&!api)return null
 try {
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(page)await authority(request,env)
  const identity=url.pathname==='/app/traces'?url.searchParams.get('trace'):url.pathname.split('/').at(-1)
  if(!identity&&page&&url.pathname==='/app/traces')return tracePage()
  if(!identity||!(/^[a-fA-F0-9]{32}$/).test(identity)||/^0+$/.test(identity))fail('invalid_trace_id',400)
  if([...url.searchParams.keys()].some(key=>!['trace','snapshot'].includes(key)))fail('invalid_query',400)
  const traceId=identity.toLowerCase(),target=new URL('/api/porthole/v1/ingest/records',url)
  target.searchParams.set('signal','traces');target.searchParams.set('trace',traceId);target.searchParams.set('limit','2000')
  if(url.searchParams.has('snapshot'))target.searchParams.set('snapshot',url.searchParams.get('snapshot')!)
  // One live-authority transaction reads the whole bounded graph. There is no
  // accumulation of earlier pages across a membership/credential revocation.
  const response=await readTelemetry(new Request(target,{headers:request.headers}),env,{trace:true})
  if(!response.ok) {
   const body=await response.json() as {error:string}
   return page?tracePage(undefined,undefined,response.status,body.error):response
  }
  const {records,snapshot,cursor}=await response.json() as {records:TraceRecord[];snapshot:number;cursor:string|null}
  const graph=traceGraph(traceId,records,!!cursor)
  return page?tracePage(graph,snapshot):Response.json({...graph,snapshot},{headers:privateHeaders})
 }catch(error) {
  const code=error instanceof AuthError?error.code:'trace_unavailable',status=error instanceof AuthError?error.status:503
  return page?tracePage(undefined,undefined,status,code):Response.json({error:code},{status,headers:privateHeaders})
 }
}
