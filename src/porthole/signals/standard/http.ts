import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { CredentialLimit, verifyCredential } from '../../credentials/verify'
import { privateHeaders } from '../../document'
import { IntakeError } from '../../ingest/model'
import { readBytes, unsnappy } from '../../ingest/wire'
import { allScope, emptyScope, fail } from '../../security/authority'
import { readRequest, readResponse } from './prometheus'
import { snappy } from './protobuf'
import { standardRead } from './read'
import { tempoTrace } from './tempo'

export function standardRoute(path:string) {
 return path==='/api/v1/read'||/^\/api\/v1\/(?:query|query_range|series|labels|label|metadata|exemplars)(?:\/|$)/.test(path)||/^\/api\/(?:v2\/)?(?:traces|search|echo|tags)(?:\/|$)/.test(path)
}
export async function standardResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(!standardRoute(path))return null
 try{
  // Header-only credential verification precedes decoding or data discovery.
  await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  if(path==='/api/v1/read'){
   if(request.method!=='POST')fail('method_not_allowed',405)
   if(url.search)fail('invalid_standard_query',400)
   if(request.headers.get('content-type')?.split(';')[0]!=='application/x-protobuf'||request.headers.get('content-encoding')!=='snappy'||request.headers.get('x-prometheus-remote-read-version')!=='0.1.0')fail('unsupported_remote_read_version_or_encoding',415)
   const queries=readRequest(unsnappy(await readBytes(request.body)))
   const from=queries.reduce((n,q)=>q.start<n?q.start:n,queries[0].start)*1000000n,through=queries.reduce((n,q)=>q.end>n?q.end:n,queries[0].end)*1000000n+999999n
   const read=await standardRead(request,env,'metrics',{from:String(from),through:String(through)})
   return new Response(new Uint8Array(snappy(readResponse(queries,read.records))).buffer,{headers:{...privateHeaders,...read.headers,'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-read-version':'0.1.0'}})
  }
  if(!path.startsWith('/api/traces/'))fail('standard_route_unsupported',501)
  if(request.method!=='GET')fail('method_not_allowed',405)
  const traceId=path.slice('/api/traces/'.length).toLowerCase()
  if(!/^[a-f0-9]{32}$/.test(traceId)||/^0+$/.test(traceId))fail('invalid_trace_id',400)
  if([...url.searchParams.keys()].some(key=>!['start','end'].includes(key))||[...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1))fail('invalid_standard_query',400)
  const parameters:Record<string,string>={trace:traceId}
  if(url.search){
   const start=url.searchParams.get('start')??'',end=url.searchParams.get('end')??''
   if(!/^\d{1,10}$/.test(start)||!/^\d{1,10}$/.test(end)||BigInt(end)<BigInt(start))fail('invalid_standard_range',400)
   parameters.from=String(BigInt(start)*1000000000n);parameters.through=String(BigInt(end)*1000000000n+999999999n)
  }
  const accept=request.headers.get('accept')??'application/json'
  if(!['application/protobuf','application/json','*/*'].includes(accept))fail('unsupported_trace_representation',406)
  const read=await standardRead(request,env,'traces',parameters)
  if(!read.records.length)fail('trace_not_found',404)
  const trace=tempoTrace(traceId,read.records),headers={...privateHeaders,...read.headers,...trace.headers}
  if(trace.protobuf.length>1024*1024)fail('standard_read_budget_exceeded',422)
  return accept==='application/protobuf'?new Response(new Uint8Array(trace.protobuf).buffer,{headers:{...headers,'content-type':'application/protobuf'}}):Response.json(trace.json,{headers})
 }catch(error){
  const known=error instanceof AuthError||error instanceof IntakeError||error instanceof CredentialLimit
  return Response.json({error:known?error.code:'standard_read_unavailable'},{status:known?error.status:503,headers:{...privateHeaders,...(error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{})}})
 }
}
