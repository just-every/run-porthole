import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {createServer as httpServer} from 'node:http'
import {randomUUID} from 'node:crypto'
const execute=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function freePort(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port}

/** A local, disposable real runtime estate. The gateway forwards unchanged
 * OTLP bytes to the emitted Worker's actual public intake; it supplies no
 * telemetry, product responses or storage substitute. Docker host networking
 * is used only to reach these loopback test services, never for external access. */
export async function polyglotEstate(){
 let servicePorts
 const prefix='porthole-c7-'+randomUUID().slice(0,8),containers=[],gateway=httpServer()
 async function stop(){await pause(1000);await Promise.all(containers.map(name=>execute('docker',['stop','--time','5',name]).catch(()=>{})));for(const name of containers.reverse())await execute('docker',['rm','-f',name]).catch(()=>{});if(gateway.listening)await new Promise(resolve=>gateway.close(resolve))}
 async function container(name,args){containers.push(name);await execute('docker',['run','--detach','--name',name,'--network','host',...args],{maxBuffer:1024*1024})}
 async function environment({origin,secret,policyPath}) {
  try {
   gateway.on('request',async(req,res)=>{
    try{
     const chunks=[];for await(const chunk of req)chunks.push(chunk)
     const response=await fetch(origin+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/x-protobuf',...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{}),authorization:'Bearer '+secret},body:Buffer.concat(chunks)})
     if(!response.ok)console.log('Stock OTLP export refused by real intake: HTTP '+response.status)
     res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/x-protobuf'});res.end(Buffer.from(await response.arrayBuffer()))
    }catch{res.writeHead(503);res.end()}
   })
   await new Promise(resolve=>gateway.listen(0,'0.0.0.0',resolve));const exportUrl='http://127.0.0.1:'+gateway.address().port+'/v1/traces'
   const ports=servicePorts=Object.fromEntries(await Promise.all(['python','java','go','dotnet','ruby','php','kafka','controller'].map(async name=>[name,await freePort()])))
   await container(prefix+'-kafka',['-e','KAFKA_NODE_ID=1','-e','KAFKA_PROCESS_ROLES=broker,controller','-e',`KAFKA_LISTENERS=PLAINTEXT://:${ports.kafka},CONTROLLER://:${ports.controller}`,'-e',`KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:${ports.kafka}`,'-e','KAFKA_CONTROLLER_QUORUM_VOTERS=1@127.0.0.1:'+ports.controller,'-e','KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER','-e','KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT','-e','KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT','-e','KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1','apache/kafka:3.9.1'])
   console.log('Polyglot Kafka process started; starting six stock-instrumented services')
   const languages=['python','java','go','dotnet','ruby','php']
   for(let index=languages.length-1;index>=0;index--){
    const language=languages[index],next=index<languages.length-1?'http://127.0.0.1:'+ports[languages[index+1]]+'/work':''
    const variables={PORT:String(ports[language]),NEXT_URL:next,OTEL_SERVICE_NAME:language,OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name='+(['java','php'].includes(language)?'fulfillment':'commerce')+',service.version=synthetic-porthole-1101',OTEL_EXPORTER_OTLP_ENDPOINT:new URL(exportUrl).origin,OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:exportUrl,OTEL_EXPORTER_OTLP_TRACES_PROTOCOL:'http/protobuf',OTEL_EXPORTER_OTLP_PROTOCOL:'http/protobuf',OTEL_PROPAGATORS:language==='java'?'tracecontext,porthole':'tracecontext',PORTHOLE_BAGGAGE_POLICY:'/run/porthole-baggage-policy.json',OTEL_TRACES_SAMPLER:'always_on',OTEL_BSP_SCHEDULE_DELAY:'100',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',OTEL_PHP_AUTOLOAD_ENABLED:'true'}
    await container(prefix+'-'+language,[...(policyPath?['--mount','type=bind,src='+policyPath+',dst=/run/porthole-baggage-policy.json,readonly']:[]),...Object.entries(variables).flatMap(([key,value])=>['-e',key+'='+value]),'porthole-c7-'+language])
   }
   for(const language of languages){
    let ready=false
    for(let attempt=0;attempt<120;attempt++){
     const states=await execute('docker',['inspect','--format','{{.Name}} {{.State.Running}}',...containers])
     const exited=states.stdout.split('\n').find(line=>line.endsWith(' false'))
     if(exited){const name=exited.split(' ')[0].slice(1),logs=await execute('docker',['logs',name]);throw Error(name+' exited: '+logs.stderr.slice(-2000))}
     try{const response=await fetch('http://127.0.0.1:'+ports[language]+'/work');if(response.status===200){ready=true;break}}catch{}
     await pause(500)
    }
    if(!ready){const logs=await execute('docker',['logs',prefix+'-'+language]);throw Error(language+' readiness failed: '+logs.stderr.slice(-2000))}
   }
   console.log('All seven runtime processes are ready for the real Kafka/HTTP/gRPC trace')
   // Warm-up traffic is real and has independent trace identities. It cannot
   // enter the selected root's graph, even when its timestamps overlap it.
   return {KAFKA_BROKER:'127.0.0.1:'+ports.kafka,POLYGLOT_NEXT_URL:'http://127.0.0.1:'+ports.python+'/work'}
  }catch(error){await stop();throw error}
 }
 async function probe(header){
  const results=[]
  for(const language of ['python','java','go','dotnet','ruby','php']){
   const response=await fetch('http://127.0.0.1:'+servicePorts[language]+'/work',{headers:{baggage:header}})
   if(response.status!==200)throw Error(language+' baggage probe HTTP '+response.status)
   results.push({language,keys:(response.headers.get('x-porthole-baggage-keys')??'').split(',').filter(Boolean),maxBytes:Number(response.headers.get('x-porthole-baggage-bytes'))})
  }
  return results
 }
 async function diagnostics(){return (await Promise.all(containers.filter(name=>!name.endsWith('-kafka')).map(async name=>{const logs=await execute('docker',['logs',name]);return {language:name.split('-').at(-1),output:logs.stderr+logs.stdout}})))}
 async function restartServices(){
  await execute('docker',['restart',...containers.filter(name=>!name.endsWith('-kafka'))],{timeout:120000})
  for(const language of ['php','ruby','dotnet','go','java','python']){
   let ready=false
   for(let attempt=0;attempt<120;attempt++){try{const response=await fetch('http://127.0.0.1:'+servicePorts[language]+'/work');if(response.status===200){ready=true;break}}catch{};await pause(500)}
   if(!ready){const logs=await execute('docker',['logs',prefix+'-'+language]);throw Error(language+' policy restart failed: '+logs.stderr.slice(-2000))}
  }
 }
 return {environment,stop,probe,diagnostics,restartServices}
}

/** Focused two-team checkout estate, sharing the real Kafka runtime above.
 * Counts come from application handlers; durations come from independently
 * captured stock spans before the stock OTLP exporter sends its wire bytes. */
export async function serviceCatalogEstate({origin,secret,dispatch,logs=false}) {
 const children=[],packets=[],name='porthole-services-'+randomUUID().slice(0,8),topic='synthetic-porthole-8200-'+randomUUID().replaceAll('-','').replace(/[0-9]/g,digit=>String.fromCharCode(97+Number(digit))),kafkaPort=await freePort(),controller=await freePort(),databasePort=await freePort(),databaseName=name+'-postgres'
 const gateway=httpServer(async(req,res)=>{
  try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),type=req.headers['content-type']??'application/x-protobuf';packets.push({body,type,path:req.url});const response=await dispatch(req.url,{method:'POST',headers:{'content-type':type,authorization:'Bearer '+secret},body});res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/x-protobuf'});res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(503);res.end()}
 })
 async function message(child,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',receive);reject(Error('Stock estate timed out: '+type))},90000);const receive=data=>{if(data.type!==type)return;clearTimeout(timer);child.off('message',receive);resolve(data)};child.on('message',receive);child.once('exit',code=>{if(code){clearTimeout(timer);reject(Error('Stock estate process failed'))}})})}
 async function start(role,extra={}){
  const child=spawn(process.execPath,['tests/porthole/services/producer.cjs'],{env:{...process.env,OTEL_SERVICE_NAME:role,OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name='+(role==='checkout'?'commerce':'fulfillment')+',service.version=synthetic-porthole-8205',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'http://127.0.0.1:'+gateway.address().port+'/v1/traces',OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:'http://127.0.0.1:'+gateway.address().port+'/v1/logs',OTEL_EXPORTER_OTLP_LOGS_PROTOCOL:'http/protobuf',OTEL_TRACES_SAMPLER:'always_on',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:logs?'otlp':'none',KAFKA_BROKER:'127.0.0.1:'+kafkaPort,PORTHOLE_TOPIC:topic,PORTHOLE_SERVICE_ROLE:role,...extra},stdio:['ignore','ignore','pipe','ipc']});children.push(child);let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-3000)});const ready=await message(child,'ready');return {child,port:ready.port}
 }
 try {
  await execute('docker',['run','--detach','--name',name,'--network','host','-e','KAFKA_NODE_ID=1','-e','KAFKA_PROCESS_ROLES=broker,controller','-e',`KAFKA_LISTENERS=PLAINTEXT://:${kafkaPort},CONTROLLER://:${controller}`,'-e',`KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:${kafkaPort}`,'-e','KAFKA_CONTROLLER_QUORUM_VOTERS=1@127.0.0.1:'+controller,'-e','KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER','-e','KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT','-e','KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT','-e','KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1','apache/kafka:3.9.1'],{timeout:120000})
  await execute('docker',['run','--detach','--name',databaseName,'--network','host','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=synthetic_porthole_8400','postgres:17.7-alpine','-c','listen_addresses=127.0.0.1','-c','port='+databasePort],{timeout:120000})
  let databaseReady=false
  for(let attempt=0;attempt<100&&!databaseReady;attempt++){databaseReady=await execute('docker',['exec',databaseName,'pg_isready','-h','127.0.0.1','-p',String(databasePort),'-U','postgres']).then(()=>true,()=>false);if(!databaseReady)await pause(200)}
  if(!databaseReady)throw Error('Actual database did not become ready')
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  // Create the topic before the consumer subscribes, without sending telemetry.
  const {Kafka,logLevel}=await import('kafkajs'),admin=new Kafka({brokers:['127.0.0.1:'+kafkaPort],logLevel:logLevel.NOTHING,retry:{retries:20,initialRetryTime:200,maxRetryTime:2000}}).admin()
  await admin.connect();await admin.createTopics({topics:[{topic,numPartitions:1,replicationFactor:1}]});await admin.disconnect()
  const fulfillment=await start('fulfillment'),checkout=await start('checkout',{PORTHOLE_NEXT:'http://127.0.0.1:'+fulfillment.port,PGHOST:'127.0.0.1',PGPORT:String(databasePort),PGUSER:'postgres',PGDATABASE:'synthetic_porthole_8400'}),statuses=[]
  for(let i=0;i<36;i++){const mode=i<20?'work':i<28?'error':'slow',response=await fetch('http://127.0.0.1:'+checkout.port+'/checkout?mode='+mode+'&id=synthetic-porthole-'+(8300+i));statuses.push(response.status);await response.text()}
  let stats
  for(let attempt=0;attempt<100;attempt++){const pending=message(fulfillment.child,'stats');fulfillment.child.send('stats');stats=await pending;if(stats.received.length===36)break;await pause(50)}
  if(stats.received.length!==36)throw Error('Actual Kafka delivery did not reconcile')
  const receipts=[]
  for(const child of children){const pending=message(child,'receipt');child.send('stop');receipts.push(await pending);await new Promise(resolve=>child.exitCode===null?child.once('exit',resolve):resolve())}
  // A real replacement runtime keeps the production service identity while a
  // second deployment uses the same name in staging. Stock SDK resources,
  // rather than hand-authored spans, carry the changed version and environment.
  const originalPackets=packets.slice(),discoveryReceipts=[]
  for(const [environment,version,modes]of [
   ['production','synthetic-porthole-8210',['work','work','error','error','slow','slow']],
   ['staging','synthetic-porthole-8211',['work','work','work','slow','slow','slow']],
  ]){
   const runtime=await start('fulfillment',{OTEL_SERVICE_NAME:'checkout',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name='+environment+',team.name=commerce,service.version='+version,PORTHOLE_HTTP_ONLY:'1'})
   const outcomes=[]
   for(const mode of modes){const response=await fetch('http://127.0.0.1:'+runtime.port+'/'+mode);outcomes.push(response.status);await response.text()}
   const pending=message(runtime.child,'receipt');runtime.child.send('stop');const receipt=await pending
   await new Promise(resolve=>runtime.child.exitCode===null?runtime.child.once('exit',resolve):resolve())
   discoveryReceipts.push({...receipt,environment,version,outcomes})
  }
  return {statuses,receipts,packets:originalPackets,spans:receipts.flatMap(r=>r.spans),topic,databasePort,discovery:{receipts:discoveryReceipts,spans:discoveryReceipts.flatMap(r=>r.spans),packets:packets.slice(originalPackets.length)}}
 }finally{
  for(const child of children)if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped}
  await execute('docker',['stop','--time','5',name]).catch(()=>{});await execute('docker',['rm','-f',name]).catch(()=>{})
  await execute('docker',['stop','--time','5',databaseName]).catch(()=>{});await execute('docker',['rm','-f',databaseName]).catch(()=>{})
  if(gateway.listening)await new Promise(resolve=>gateway.close(resolve))
 }
}
