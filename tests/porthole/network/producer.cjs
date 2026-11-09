// Count actual application operations independently of stock-exported spans.
const fs=require('node:fs')
const ids=JSON.parse(fs.readFileSync('/run/identities.json','utf8'))
process.env.OTEL_RESOURCE_ATTRIBUTES+=',synthetic.private_value='+['123','45','6789'].join('-')+',container.id='+ids[process.env.ROLE]+',host.id='+ids.host+',porthole.messaging.broker.container.id='+ids[process.env.SYSTEM]
if(process.env.SYSTEM==='rabbitmq')process.env.OTEL_RESOURCE_ATTRIBUTES+=',porthole.messaging.rabbitmq.vhost=/'
const {NodeSDK}=require('@opentelemetry/sdk-node'),{OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-proto')
const {createRequire}=require('node:module'),reqSdk=createRequire(require.resolve('@opentelemetry/sdk-node')),{BatchSpanProcessor}=reqSdk('@opentelemetry/sdk-trace')
const spans=[],processor={onStart(){},onEnd(s){spans.push({traceId:s.spanContext().traceId,spanId:s.spanContext().spanId,parentSpanId:s.parentSpanContext?.spanId??null,name:s.name,kind:s.kind+1,attributes:s.attributes,status:s.status,scope:s.instrumentationScope,resource:s.resource.attributes,startNs:(BigInt(s.startTime[0])*1000000000n+BigInt(s.startTime[1])).toString(),durationNs:(BigInt(s.duration[0])*1000000000n+BigInt(s.duration[1])).toString()})},forceFlush:async()=>{},shutdown:async()=>{}}
// Keep every span, but export at the explicit per-window /flush boundary.
// Subsecond SDK exports turn this multi-minute fixture into hundreds of wire
// custody units, exceeding the bounded subject-erasure door.
const sdk=new NodeSDK({spanProcessors:[processor,new BatchSpanProcessor({exporter:new OTLPTraceExporter(),scheduledDelayMillis:60000})],instrumentations:[new(require('@opentelemetry/instrumentation-http').HttpInstrumentation)(),new(require('@opentelemetry/instrumentation-dns').DnsInstrumentation)(),new(require('@opentelemetry/instrumentation-net').NetInstrumentation)(),new(require('@opentelemetry/instrumentation-kafkajs').KafkaJsInstrumentation)(),new(require('@opentelemetry/instrumentation-amqplib').AmqplibInstrumentation)()]});sdk.start()
const http=require('node:http'),pause=ms=>new Promise(r=>setTimeout(r,ms))
const counts={sent:[],received:[],requests:0,failed:0},system=process.env.SYSTEM,producerRole=process.env.ROLE.startsWith('checkout'),destination=process.env.DESTINATION
let producer,consumer,channel,connection,tag,server
const request=url=>new Promise((resolve,reject)=>{const req=http.get(url,{agent:false,lookup:require('node:dns').lookup},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});req.setTimeout(8000,()=>req.destroy(Error('application timeout')));req.once('error',reject)})
async function subscribe(){
 const result=await channel.consume(destination,async msg=>{if(!msg)return;await pause(15);counts.received.push(msg.content.toString());channel.ack(msg)},{noAck:false});tag=result.consumerTag
}
async function main(){
 if(system==='kafka'){
  const {Kafka,logLevel}=require('kafkajs'),kafka=new Kafka({brokers:['kafka:9092'],clientId:process.env.ROLE,logLevel:logLevel.NOTHING,retry:{retries:15,initialRetryTime:200,maxRetryTime:2000},sasl:{mechanism:'plain',username:'admin',password:process.env.WORKLOAD_PASSWORD}})
  if(producerRole){producer=kafka.producer();await producer.connect()}
  else{consumer=kafka.consumer({groupId:'synthetic-porthole-network-group'});await consumer.connect();await consumer.subscribe({topic:destination,fromBeginning:true});await consumer.run({autoCommitInterval:500,eachMessage:async({message})=>{await pause(15);counts.received.push(message.value.toString())}})}
 }else{
  const amqp=require('amqplib');connection=await amqp.connect({hostname:'rabbit',username:'workload',password:process.env.WORKLOAD_PASSWORD});channel=await connection.createConfirmChannel();await channel.assertQueue(destination,{durable:false});if(!producerRole)await subscribe()
 }
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost')
  try{
   if(url.pathname==='/work'&&producerRole){
    const n=Number(url.searchParams.get('count')??1),window=url.searchParams.get('window')??'baseline'
    for(let i=0;i<n;i++){
     const id=window+'-'+counts.sent.length
     counts.requests++
     // Normal checkout work, with passive stock DNS, TCP, HTTP and broker
     // instrumentation. The collector itself never initiates test traffic.
     await request('http://'+process.env.CONSUMER_HOST+':8080/fulfill')
     if(system==='kafka')await producer.send({topic:destination,messages:[{value:id}]})
     else{channel.sendToQueue(destination,Buffer.from(id),{messageId:id});await channel.waitForConfirms()}
     counts.sent.push(id)
    }
   }else if(url.pathname==='/pause'&&!producerRole){if(consumer)consumer.pause([{topic:destination}]);else await channel.cancel(tag)}
   else if(url.pathname==='/resume'&&!producerRole){if(consumer)consumer.resume([{topic:destination}]);else await subscribe()}
   else if(url.pathname==='/flush')await sdk._tracerProvider?.forceFlush()
   else if(url.pathname==='/dns-failure'&&producerRole){await request('http://unresolved.porthole.test:8080/fulfill').catch(()=>{counts.failed++})}
   else if(url.pathname==='/connection-failure'&&producerRole){await request('http://'+process.env.CONSUMER_HOST+':1/fulfill').catch(()=>{counts.failed++})}
   else if(!['/fulfill','/stats'].includes(url.pathname)){res.writeHead(404);res.end();return}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({counts,spans}))
  }catch(error){counts.failed++;res.writeHead(503);res.end(JSON.stringify({error:String(error.message),counts}))}
 });await new Promise(r=>server.listen(8080,'0.0.0.0',r))
}
async function stop(){await producer?.disconnect();await consumer?.disconnect();await channel?.close();await connection?.close();server?.close();await sdk.shutdown();process.exit(0)}
process.on('SIGTERM',()=>stop().catch(()=>process.exit(1)))
main().catch(e=>{console.error(e.message);process.exit(1)})
