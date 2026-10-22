// Actual HTTP + gRPC operations, exported by stock auto-instrumentation.
const sdk=require('../../../instrumentation/node/register.cjs')
const {connect}=require('node:net')
const http=require('node:http'),grpc=require('@grpc/grpc-js')
const {Kafka,logLevel}=require('kafkajs')
const {trace,context}=require('@opentelemetry/api')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const servers=[]
const request=(url,headers={})=>new Promise((resolve,reject)=>{
 const req=http.get(url,{headers},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});req.once('error',reject)
})
const rpc={check:{path:'/checkout.Inventory/Check',requestStream:false,responseStream:false,requestSerialize:Buffer.from,responseSerialize:Buffer.from,requestDeserialize:Buffer.from,responseDeserialize:Buffer.from}}
async function main(){
 const server=new grpc.Server();servers.push(server)
 server.addService(rpc,{check:async(call,callback)=>{await pause(20);if(call.request.toString()==='decline'){callback({code:grpc.status.UNAVAILABLE,details:'inventory unavailable'});return};callback(null,Buffer.from('reserved'))}})
 const rpcPort=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(error,port)=>error?reject(error):resolve(port)))
 const Client=grpc.makeGenericClientConstructor(rpc,'Inventory'),client=new Client('127.0.0.1:'+rpcPort,grpc.credentials.createInsecure())
 const web=http.createServer(async(req,res)=>{
  if(req.url==='/error'){res.statusCode=503;res.end('payment unavailable');return}
  if(req.url==='/fulfillment'){await pause(35);res.end('shipped');return}
  if(req.url==='/payment'){await pause(25);res.end('paid');return}
  if(req.url==='/broken'){res.end(JSON.stringify({traceId:trace.getSpan(context.active()).spanContext().traceId}));return}
  await Promise.all([request(base+'/fulfillment'),request(base+'/payment'),request(base+'/error'),new Promise(resolve=>client.check(Buffer.from('decline'),error=>{if(error?.code!==grpc.status.UNAVAILABLE)throw Error('Expected actual gRPC failure');resolve()})),new Promise((resolve,reject)=>client.check(Buffer.from('reserve'),(error)=>error?reject(error):resolve()))])
  res.end('checkout complete')
 })
 servers.push(web);await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+web.address().port
 let kafka,producer,consumer,received,done
 if(process.env.KAFKA_BROKER){
  kafka=new Kafka({clientId:'synthetic-porthole-1120',brokers:[process.env.KAFKA_BROKER],logLevel:logLevel.NOTHING,retry:{retries:3}})
  const topic='synthetic-porthole-1121-'+Date.now(),admin=kafka.admin();await admin.connect();await admin.createTopics({topics:[{topic,numPartitions:1,replicationFactor:1}]});await admin.disconnect()
  producer=kafka.producer();consumer=kafka.consumer({groupId:topic});await producer.connect();await consumer.connect();await consumer.subscribe({topic,fromBeginning:true})
  received=new Promise((resolve,reject)=>{done={resolve,reject}})
  await consumer.run({eachMessage:async()=>{try{if(process.env.POLYGLOT_NEXT_URL)await request(process.env.POLYGLOT_NEXT_URL);done.resolve()}catch(error){done.reject(error)}}})
  producer.topic=topic
 }
 const tracer=trace.getTracer('porthole-polyglot','1.0.0');let traceId
 const before=process.hrtime.bigint()
 await tracer.startActiveSpan('checkout.transaction',async span=>{
  traceId=span.spanContext().traceId
  try{
   const work=[request(base+'/checkout')]
   if(producer){
    work.push(producer.send({topic:producer.topic,messages:[{value:'synthetic-porthole-1122'}]}))
    let timer;work.push(Promise.race([received,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Kafka consumer timed out')),30000)})]).finally(()=>clearTimeout(timer)))
   } else if(process.env.POLYGLOT_NEXT_URL)work.push(request(process.env.POLYGLOT_NEXT_URL))
   await Promise.all(work)
  }finally{span.end()}
 })
 const elapsed=process.hrtime.bigint()-before
 let brokenTraceId
 await tracer.startActiveSpan('boundary.upstream',async span=>{
  brokenTraceId=span.spanContext().traceId
  // This real TCP forwarder deliberately corrupts the parent ID while
  // preserving the trace ID. The downstream span is emitted by stock HTTP
  // instrumentation, so the product must expose the missing boundary.
  try {await new Promise((resolve,reject)=>{
   const socket=connect(web.address().port,'127.0.0.1',()=>socket.write('GET /broken HTTP/1.1\r\nHost: 127.0.0.1\r\ntraceparent: 00-'+brokenTraceId+'-00000000000000ff-01\r\nConnection: close\r\n\r\n'))
   socket.on('data',()=>{});socket.on('end',resolve);socket.on('error',reject)
  })}finally{span.end()}
 })
 if(consumer)await consumer.disconnect();if(producer)await producer.disconnect()
 client.close();await new Promise(resolve=>web.close(resolve));await new Promise(resolve=>server.tryShutdown(resolve));servers.length=0
 await sdk.shutdown()
 process.stdout.write(JSON.stringify({traceId,brokenTraceId,elapsedNs:elapsed.toString()})+'\n')
}
main().catch(async()=>{for(const server of servers){if(server.forceShutdown)server.forceShutdown();else {server.closeAllConnections?.();server.close()}}await sdk.shutdown();process.stderr.write('Instrumented Node journey failed\n');process.exitCode=1})
