import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { CredentialLimit, verifyCredential } from '../credentials/verify'
import { privateHeaders } from '../document'
import { allScope, authority, emptyScope, fail, sameOrigin } from '../security/authority'
import { base64, canonical, IntakeError, invalid, object, sha256, type Signal, type TelemetryRecord } from './model'
import { otlpRecords } from './normalize'
import { decode } from './otlp-proto'
import { drainIngest } from './processor'
import { readTelemetry } from './read'
import { changeControl, ingestStatus, recordLoss, statusPage } from './status'
import { acceptEnvelope, rejectEnvelope } from './store'
import { lokiProto, lokiRecords, remoteWrite } from './vendor'
import { readBytes, unsnappy, utf8 } from './wire'

const root='/api/porthole/v1/ingest'
const intake:Record<string,Signal>={'/api/porthole/v1/ingest/pre-sampling/traces':'traces','/v1/traces':'traces','/v1/logs':'logs','/v1/metrics':'metrics','/v1/profiles':'profiles','/api/v1/write':'metrics','/loki/api/v1/push':'logs'}
const native=new Set(['/app/ingest',root+'/status',root+'/records',root+'/archive',root+'/control',root+'/drain',root+'/loss'])
const json=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...extra}})
function failure(request:Request,error:unknown) {
 const known=error instanceof IntakeError||error instanceof AuthError||error instanceof CredentialLimit
 const status=known?error.status:503,code=known?error.code:'ingest_storage_unavailable'
 const retry=error instanceof CredentialLimit||error instanceof IntakeError?error.retryAfter:status===503?5:undefined
 const extra:Record<string,string>=retry?{'retry-after':String(retry)}:{}
 if(new URL(request.url).pathname.startsWith('/v1/')){
  const rpcCode=status===401?16:status===403?7:status===429?8:status===503?14:status===415?12:3
  if(request.headers.get('content-type')?.includes('protobuf')){
   const message=new TextEncoder().encode(code),prefix=[8,rpcCode,18];let size=message.length
   while(size>127){prefix.push((size&127)|128);size>>>=7}prefix.push(size)
   return new Response(new Uint8Array([...prefix,...message]),{status,headers:{...privateHeaders,...extra,'content-type':'application/x-protobuf','x-porthole-error':code}})
  }
  return json({code:rpcCode,message:code},status,extra)
 }
 return json({error:code},status,extra)
}
export async function ingestResponse(request: Request,env: Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname,signal=intake[path],unsupported=/^\/opentelemetry\.proto\.collector\./.test(path)
 if(!signal&&!native.has(path)&&!unsupported)return null
 try {
  sameOrigin(request,env)
  if(native.has(path)){
   if(path===root+'/records'||path===root+'/archive'){
    if(request.method!=='GET')fail('method_not_allowed',405)
    return readTelemetry(request,env,{archive:path.endsWith('/archive')})
   }
   if(path==='/app/ingest'||path===root+'/status'){
    if(request.method!=='GET')fail('method_not_allowed',405)
    if(path==='/app/ingest')return statusPage(request,env)
    return json(await ingestStatus(env,await authority(request,env,{manage:true})))
   }
   if(request.method!=='POST')fail('method_not_allowed',405)
   if(path===root+'/control')return json(await changeControl(request,env))
   if(path===root+'/loss')return json(await recordLoss(request,env),201)
   const actor=await authority(request,env,{manage:true,post:true})
   if(actor.session.kind!=='native')fail('native_session_required')
   return json(await drainIngest(env))
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(unsupported){await rejectEnvelope(request,env,path.includes('profiles')?'profiles':path.includes('Trace')?'traces':path.includes('Logs')?'logs':'metrics','unsupported_otlp_transport_or_signal');throw new IntakeError('unsupported_otlp_transport_or_signal',415)}
  // Authenticate before decoding; acceptance rechecks and meters the source. A
  // refused body is drained unread, so the refusal keeps its own status.
  try{await verifyCredential(request,env,{inspectOnly:true,action:'telemetry.write',scope:emptyScope,dataScope:allScope})}
  catch(error){await readBytes(request.body).catch(()=>undefined);throw error}
  const kind=signal!,type=request.headers.get('content-type')?.split(';')[0].trim(),encoding=request.headers.get('content-encoding')?.toLowerCase()??'identity'
  let wire:Uint8Array,records:TelemetryRecord[]=[],protocol:string
  try{
   wire=await readBytes(request.body)
   let body=wire
   if(encoding==='gzip')body=await readBytes(new Response(new Uint8Array(body).buffer).body!.pipeThrough(new DecompressionStream('gzip')))
   else if(encoding!=='identity'&&encoding!=='snappy')invalid('unsupported_content_encoding',415)
   if(path==='/api/v1/write'){
    if(type!=='application/x-protobuf'||encoding!=='snappy'||request.headers.get('x-prometheus-remote-write-version')!=='0.1.0'||request.headers.get('content-type')?.includes('proto=io.prometheus'))invalid('unsupported_remote_write_version_or_encoding',415)
    records=remoteWrite(unsnappy(body),request.headers);protocol='prometheus.WriteRequest/v1'
   }else if(path==='/loki/api/v1/push'){
    const data=type==='application/json'?object(JSON.parse(utf8(body))):type==='application/x-protobuf'||!type?lokiProto(unsnappy(body)):invalid('unsupported_loki_encoding',415)
    records=lokiRecords(data,request.headers);protocol='loki.PushRequest/v3.5'
   }else{
    if(encoding==='snappy')invalid('unsupported_otlp_content_encoding',415)
    const data=type==='application/json'?object(JSON.parse(utf8(body))):type==='application/x-protobuf'?decode(body,kind==='traces'?'Traces':kind==='logs'?'Logs':kind==='profiles'?'Profiles':'Metrics'):invalid('unsupported_otlp_encoding',415)
    records=otlpRecords(data,kind,request.headers);protocol=kind==='profiles'?'otlp.http/v1.9.0/profiles/v1development':'otlp.http/v1.9.0'
   }
   if(records.length>5000)invalid('too_many_records',413)
   if(new TextEncoder().encode(canonical(records)).length>1024*1024)invalid('normalized_batch_too_large',413)
  }catch(error){
   const failure=error instanceof IntakeError?error:new IntakeError('malformed_payload')
   await rejectEnvelope(request,env,kind,failure.code,records)
   throw failure
  }
  if(path==='/api/porthole/v1/ingest/pre-sampling/traces')for(const record of records)record.payload.inputStage='pre-sampling'
  const explicit=request.headers.get('x-porthole-batch-id')
  if(explicit!==null&&!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(explicit)){await rejectEnvelope(request,env,kind,'invalid_batch_identity',records);throw new IntakeError('invalid_batch_identity')}
  const digest=await sha256(new TextEncoder().encode(canonical({...(path==='/api/porthole/v1/ingest/pre-sampling/traces'?{inputStage:'pre-sampling'}:{}),wire:base64(wire),service:request.headers.get('x-porthole-service'),environment:request.headers.get('x-porthole-environment'),team:request.headers.get('x-porthole-team'),tenant:request.headers.get('x-scope-orgid')})))
  const receipt=await acceptEnvelope(request,env,{id:crypto.randomUUID(),identity:explicit??digest,digest,signal:kind,protocol,wire,records})
  const headers={...privateHeaders,'x-porthole-batch':receipt.batchId,'x-porthole-accepted':String(receipt.accepted),'x-porthole-duplicate':String(receipt.duplicate)}
  if(path.startsWith('/v1/')||path==='/api/porthole/v1/ingest/pre-sampling/traces')return type==='application/x-protobuf'?new Response(new Uint8Array(),{headers:{...headers,'content-type':'application/x-protobuf'}}):json({},200,headers)
  return new Response(null,{status:204,headers})
 }catch(error){return failure(request,error)}
}
export { drainIngest } from './processor'
