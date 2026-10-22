// Actual HTTP + gRPC operations, exported by stock auto-instrumentation.
const sdk=require('../../../instrumentation/node/register.cjs')
const http=require('node:http'),grpc=require('@grpc/grpc-js')
const {trace,context}=require('@opentelemetry/api')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const servers=[]
const request=(url,headers={})=>new Promise((resolve,reject)=>{
 const req=http.get(url,{headers},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});req.once('error',reject)
})
const rpc={check:{path:'/checkout.Inventory/Check',requestStream:false,responseStream:false,requestSerialize:Buffer.from,responseSerialize:Buffer.from,requestDeserialize:Buffer.from,responseDeserialize:Buffer.from}}
async function main(){
 const server=new grpc.Server();servers.push(server)
 server.addService(rpc,{check:async(call,callback)=>{await pause(20);callback(null,Buffer.from('reserved'))}})
 const rpcPort=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(error,port)=>error?reject(error):resolve(port)))
 const Client=grpc.makeGenericClientConstructor(rpc,'Inventory'),client=new Client('127.0.0.1:'+rpcPort,grpc.credentials.createInsecure())
 const web=http.createServer(async(req,res)=>{
  if(req.url==='/fulfillment'){await pause(35);res.end('shipped');return}
  if(req.url==='/payment'){await pause(25);res.end('paid');return}
  if(req.url==='/broken'){res.end(JSON.stringify({traceId:trace.getSpan(context.active()).spanContext().traceId}));return}
  await Promise.all([request(base+'/fulfillment'),request(base+'/payment'),new Promise((resolve,reject)=>client.check(Buffer.from('reserve'),(error)=>error?reject(error):resolve()))])
  res.end('checkout complete')
 })
 servers.push(web);await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+web.address().port
 const tracer=trace.getTracer('porthole-polyglot','1.0.0');let traceId
 const before=process.hrtime.bigint()
 await tracer.startActiveSpan('checkout.transaction',async span=>{
  traceId=span.spanContext().traceId
  try{await request(base+'/checkout')}finally{span.end()}
 })
 const elapsed=process.hrtime.bigint()-before
 client.close();await new Promise(resolve=>web.close(resolve));await new Promise(resolve=>server.tryShutdown(resolve));servers.length=0
 await sdk.shutdown()
 process.stdout.write(JSON.stringify({traceId,elapsedNs:elapsed.toString()})+'\n')
}
main().catch(async()=>{for(const server of servers){if(server.forceShutdown)server.forceShutdown();else server.closeAllConnections?.()}await sdk.shutdown();process.stderr.write('Instrumented Node journey failed\n');process.exitCode=1})
