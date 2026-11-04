// Stock instrumentation records actual HTTP and Kafka operations. This process
// also counts application requests independently of the exported span stream.
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-proto')
const {HttpInstrumentation}=require('@opentelemetry/instrumentation-http')
const {KafkaJsInstrumentation}=require('@opentelemetry/instrumentation-kafkajs')
const {PgInstrumentation}=require('@opentelemetry/instrumentation-pg')
const {createRequire}=require('node:module'),sdkRequire=createRequire(require.resolve('@opentelemetry/sdk-node'))
const {BatchSpanProcessor}=sdkRequire('@opentelemetry/sdk-trace')
const spans=[],resources=[],processor={onStart(){},onEnd(span){const receipt={traceId:span.spanContext().traceId,spanId:span.spanContext().spanId,parentSpanId:span.parentSpanContext?.spanId??null,kind:span.kind+1,name:span.name,attributes:span.attributes,status:span.status,resource:span.resource.attributes,startNs:(BigInt(span.startTime[0])*1000000000n+BigInt(span.startTime[1])).toString(),durationNs:(BigInt(span.duration[0])*1000000000n+BigInt(span.duration[1])).toString()};spans.push(receipt);resources.push({receipt,resource:span.resource})},forceFlush:async()=>{},shutdown:async()=>{}}
const sdk=new NodeSDK({spanProcessors:[processor,new BatchSpanProcessor({exporter:new OTLPTraceExporter()})],instrumentations:[new HttpInstrumentation(),new KafkaJsInstrumentation(),new PgInstrumentation()]});sdk.start()
const http=require('node:http'),{Kafka,logLevel}=require('kafkajs'),{trace,context}=require('@opentelemetry/api')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),counts={},received=[]
let databaseQueries=0
const request=url=>new Promise((resolve,reject)=>{const req=http.get(url,res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});req.once('error',reject)})
let server,client,producer,consumer
async function main(){
 const kafka=new Kafka({clientId:'synthetic-porthole-8201',brokers:[process.env.KAFKA_BROKER],logLevel:logLevel.NOTHING,retry:{retries:20,initialRetryTime:200,maxRetryTime:2000}})
 if(process.env.PORTHOLE_SERVICE_ROLE==='checkout'){
  const {Client}=require('pg');client=new Client();await client.connect()
  const admin=kafka.admin();await admin.connect();await admin.createTopics({topics:[{topic:process.env.PORTHOLE_TOPIC,numPartitions:1,replicationFactor:1}]});await admin.disconnect()
  producer=kafka.producer();await producer.connect()
 }
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=url.pathname
  trace.getSpan(context.active())?.setAttribute('http.route',path)
  counts[path]=(counts[path]??0)+1
  try {
   if(process.env.PORTHOLE_SERVICE_ROLE==='checkout'){
    const selected=await client.query('SELECT $1::text AS request_id',[url.searchParams.get('id')]);if(selected.rows[0].request_id!==url.searchParams.get('id'))throw Error('Database request mismatch');databaseQueries++
    const mode=url.searchParams.get('mode')??'work',code=await request(process.env.PORTHOLE_NEXT+'/'+mode)
    await producer.send({topic:process.env.PORTHOLE_TOPIC,messages:[{value:url.searchParams.get('id')} ]})
    res.writeHead(code);res.end('synthetic-porthole-8202')
   }else{
    if(path==='/slow')await pause(40)
    res.writeHead(path==='/error'?503:200);res.end('synthetic-porthole-8203')
   }
  }catch{res.writeHead(503);res.end('synthetic-porthole-8204')}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 if(process.env.PORTHOLE_SERVICE_ROLE==='fulfillment'&&process.env.PORTHOLE_HTTP_ONLY!=='1'){
  consumer=kafka.consumer({groupId:process.env.PORTHOLE_TOPIC});await consumer.connect();await consumer.subscribe({topic:process.env.PORTHOLE_TOPIC,fromBeginning:true})
  await consumer.run({eachMessage:async({message})=>{received.push(message.value.toString());await request('http://127.0.0.1:'+server.address().port+'/queued')}})
 }
 process.send({type:'ready',port:server.address().port})
 process.on('message',async message=>{
  if(message==='stats')process.send({type:'stats',counts,received})
  if(message==='stop'){
   if(consumer)await consumer.disconnect();if(producer)await producer.disconnect()
   await new Promise(resolve=>server.close(resolve));if(client)await client.end();await sdk.shutdown()
   // Resource detectors settle asynchronously before the stock export. Capture
   // those same resolved source identities instead of an early incomplete map.
   for(const {receipt,resource}of resources){await resource.waitForAsyncAttributes?.();receipt.resource=resource.attributes}
   process.send({type:'receipt',counts,received,databaseQueries,spans},()=>process.exit(0))
  }
 })
}
main().catch(async()=>{server?.closeAllConnections?.();server?.close();await sdk.shutdown().catch(()=>{});process.stderr.write('Stock service estate failed\n');process.exit(1)})
