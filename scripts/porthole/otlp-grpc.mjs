#!/usr/bin/env node
// A bounded stock OTLP gRPC receiver. Authentication and durable acknowledgement
// stay in the installation's real HTTP intake; this process holds no grant.
import grpc from '@grpc/grpc-js'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const limit=1024*1024
export const services=Object.fromEntries(['traces','metrics','logs','profiles'].map(signal=>{
 const type=signal[0].toUpperCase()+signal.slice(1),namespace=signal==='traces'?'trace':signal,version=signal==='profiles'?'v1development':'v1'
 return [signal,{Export:{path:`/opentelemetry.proto.collector.${namespace}.${version}.${type==='Traces'?'Trace':type}Service/Export`,requestStream:false,responseStream:false,requestSerialize:Buffer.from,requestDeserialize:Buffer.from,responseSerialize:Buffer.from,responseDeserialize:Buffer.from}}]
}))
const code=status=>status===401?grpc.status.UNAUTHENTICATED:status===403?grpc.status.PERMISSION_DENIED:status===429||status===413?grpc.status.RESOURCE_EXHAUSTED:status>=500?grpc.status.UNAVAILABLE:status===415?grpc.status.UNIMPLEMENTED:status===409?grpc.status.ALREADY_EXISTS:grpc.status.INVALID_ARGUMENT
export async function receiver({upstream,listen='127.0.0.1:4317',credentials=grpc.ServerCredentials.createInsecure(),insecure=true}) {
 const target=new URL(upstream)
 const loopback=['localhost','127.0.0.1','[::1]'].includes(target.hostname)
 if(target.username||target.password||target.search||target.hash||target.pathname!=='/'||!(target.protocol==='https:'||target.protocol==='http:'&&loopback))throw Error('upstream must be an HTTPS installation origin or loopback HTTP origin')
 if(insecure&&!/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(listen))throw Error('non-loopback gRPC requires TLS certificate and key')
 const server=new grpc.Server({'grpc.max_receive_message_length':limit,'grpc.max_send_message_length':limit,'grpc.max_concurrent_streams':100})
 for(const [signal,definition]of Object.entries(services))server.addService(definition,{Export:async(call,callback)=>{
  const abort=new AbortController(),cancel=()=>abort.abort()
  call.once('cancelled',cancel)
  const deadline=Math.min(30000,Number(call.getDeadline())-Date.now()),timer=setTimeout(cancel,Math.max(1,deadline))
  try {
   if(call.cancelled||deadline<=0){callback({code:grpc.status.DEADLINE_EXCEEDED,details:'export_deadline_exceeded'});return}
   const headers={'content-type':'application/x-protobuf'}
   for(const name of ['authorization','x-porthole-service','x-porthole-environment','x-porthole-team','x-scope-orgid','x-porthole-batch-id']) {
    const values=call.metadata.get(name)
    if(values.length>1||values.some(value=>typeof value!=='string')){callback({code:grpc.status.INVALID_ARGUMENT,details:'ambiguous_metadata'});return}
    if(values.length)headers[name]=values[0]
   }
   const response=await fetch(new URL('/v1/'+signal,target),{method:'POST',headers,body:call.request,redirect:'manual',signal:abort.signal})
   if(!response.ok) {
    const retry=response.headers.get('retry-after'),metadata=new grpc.Metadata()
    if(retry&&/^[0-9]{1,6}$/.test(retry))metadata.set('retry-after',retry)
    const detail=response.headers.get('x-porthole-error')
    await response.body?.cancel()
    callback({code:code(response.status),details:detail&&/^[a-z_]{1,120}$/.test(detail)?detail:'otlp_export_refused',metadata});return
   }
   const batch=response.headers.get('x-porthole-batch'),accepted=response.headers.get('x-porthole-accepted'),duplicate=response.headers.get('x-porthole-duplicate')
   const reader=response.body?.getReader(),first=await reader?.read()
   if(reader)await reader.cancel()
   if(!batch||!/^[a-f0-9-]{36}$/.test(batch)||!accepted||! /^(0|[1-9][0-9]{0,3})$/.test(accepted)||Number(accepted)>5000||!['true','false'].includes(duplicate)||first&&!first.done&&first.value.length) {
    callback({code:grpc.status.UNAVAILABLE,details:'otlp_durable_receipt_unavailable'});return
   }
   // All four ExportResponse messages are empty on complete acceptance.
   // Forward only receipt metadata, never downstream cookies or credentials.
   const metadata=new grpc.Metadata()
   for(const name of ['x-porthole-batch','x-porthole-accepted','x-porthole-duplicate']) {
    const value=response.headers.get(name);if(value)metadata.set(name,value)
   }
   call.sendMetadata(metadata);callback(null,Buffer.alloc(0))
  }catch {callback({code:call.cancelled?grpc.status.CANCELLED:abort.signal.aborted?grpc.status.DEADLINE_EXCEEDED:grpc.status.UNAVAILABLE,details:'otlp_upstream_unavailable'})}
  finally{clearTimeout(timer);call.removeListener('cancelled',cancel)}
 }})
 const port=await new Promise((resolve,reject)=>server.bindAsync(listen,credentials,(error,port)=>error?reject(error):resolve(port)))
 return {server,port,close:()=>new Promise(resolve=>server.tryShutdown(resolve))}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const upstream=process.env.PORTHOLE_OTLP_UPSTREAM,listen=process.env.PORTHOLE_OTLP_LISTEN??'127.0.0.1:4317'
 if(!upstream)throw Error('PORTHOLE_OTLP_UPSTREAM is required')
 const cert=process.env.PORTHOLE_OTLP_TLS_CERT,key=process.env.PORTHOLE_OTLP_TLS_KEY
 if(!!cert!==!!key)throw Error('both gRPC TLS certificate and key paths are required')
 const credentials=cert?grpc.ServerCredentials.createSsl(null,[{cert_chain:await readFile(cert),private_key:await readFile(key)}]):grpc.ServerCredentials.createInsecure()
 const running=await receiver({upstream,listen,credentials,insecure:!cert})
 console.log('OTLP gRPC receiver ready; caller credentials are checked by the installation')
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{const timer=setTimeout(()=>{running.server.forceShutdown()},10000);running.close().finally(()=>{clearTimeout(timer)})})
}
