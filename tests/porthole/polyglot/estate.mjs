import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {createServer as httpServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
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


/** Real four-language, three-signal producers and the unchanged official
 * Collector. The forwarding edge records bytes and receipts, never telemetry
 * or expected product results. No production connection or provider is used. */
export async function otlpLanguageEstate({origin,secret,transport='http'}) {
 const scratch=await mkdtemp(join(tmpdir(),'porthole-otlp-')),names=[],captures=new Map(),failures=[]
 const delivery={interrupted:0,duplicates:0}
 const prefix='porthole-otlp-'+randomUUID().slice(0,8),ports=Object.fromEntries(await Promise.all(['http','grpc','python','java','go','dotnet'].map(async name=>[name,await freePort()])))
 const {receiver}=await import('../../../scripts/porthole/otlp-grpc.mjs')
 const gateway=httpServer(async(req,res)=>{
  try {
   const parts=[];for await(const part of req)parts.push(part)
   const wire=Buffer.concat(parts),headers={'content-type':req.headers['content-type'],authorization:'Bearer '+secret,...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{})}
   const response=await fetch(origin+req.url,{method:'POST',headers,body:wire,signal:AbortSignal.timeout(30000)})
   const id=response.headers.get('x-porthole-batch')
   if(response.ok&&id&&!captures.has(id))captures.set(id,{signal:req.url.slice(4),wire,headers:{'content-type':headers['content-type'],...(headers['content-encoding']?{'content-encoding':headers['content-encoding']}:{})},count:Number(response.headers.get('x-porthole-accepted'))})
   if(response.headers.get('x-porthole-duplicate')==='true')delivery.duplicates++
   if(response.ok&&id&&delivery.interrupted===0){delivery.interrupted++;await response.arrayBuffer();res.destroy();return}
   if(!response.ok)failures.push({signal:req.url,status:response.status,error:response.headers.get('x-porthole-error')})
   const receipt=Object.fromEntries([...response.headers].filter(([name])=>['content-type','x-porthole-batch','x-porthole-accepted','x-porthole-duplicate','retry-after','x-porthole-error'].includes(name)))
   res.writeHead(response.status,receipt);res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){failures.push({error:error.code??'forwarding_unavailable'});res.writeHead(503);res.end()}
 })
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
 const gatewayOrigin='http://127.0.0.1:'+gateway.address().port
 const grpcReceiver=await receiver({upstream:gatewayOrigin,listen:'127.0.0.1:0'})
 const exporter=transport==='grpc'?'otlp':'otlphttp'
 const endpoint=transport==='grpc'?'127.0.0.1:'+grpcReceiver.port:gatewayOrigin
 const config=`receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:${ports.http}
      grpc:
        endpoint: 127.0.0.1:${ports.grpc}
exporters:
  ${exporter}:
    endpoint: ${endpoint}
    ${transport==='grpc'?'tls:\n      insecure: true':'encoding: proto'}
    compression: none
    headers:
      authorization: \${env:PORTHOLE_COLLECTOR_AUTHORIZATION}
    sending_queue:
      enabled: false
    retry_on_failure:
      enabled: true
      initial_interval: 100ms
      max_interval: 1s
      max_elapsed_time: 30s
service:
  telemetry:
    logs:
      level: error
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [${exporter}]
    logs:
      receivers: [otlp]
      exporters: [${exporter}]
    metrics:
      receivers: [otlp]
      exporters: [${exporter}]
`
 await writeFile(join(scratch,'collector.yaml'),config)
 await chmod(scratch,0o755)
 await chmod(join(scratch,'collector.yaml'),0o644)
 async function container(name,args){names.push(name);try{await execute('docker',['run','--detach','--name',name,'--network','host',...args],{maxBuffer:1024*1024})}catch(error){throw Error('OTLP process launch failed: '+String(error.stderr??error.message).split(secret).join('[redacted]'))}}
 async function stop(){
  for(const name of [...names].reverse())await execute('docker',['stop','--time','3',name]).catch(()=>{})
  for(const name of names)await execute('docker',['rm','-f',name]).catch(()=>{})
  await grpcReceiver.close()
  await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})
  await rm(scratch,{recursive:true,force:true})
 }
 try {
  await container(prefix+'-collector',['--mount','type=bind,src='+scratch+',dst=/config,readonly','-e','PORTHOLE_COLLECTOR_AUTHORIZATION=Bearer '+secret,['otel','opentelemetry-collector-contrib:0.135.0@sha256:89107a3a8f4636a396927edf7025bb9614b8da2d92f4cc3f43109e8d115736e2'].join('/'),'--config=/config/collector.yaml'])
  for(const language of ['python','java','go','dotnet']){
   const variables={PORT:String(ports[language]),NEXT_URL:'',OTEL_SERVICE_NAME:language,OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-1001',OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:'+ports[language==='dotnet'?'grpc':'http'],OTEL_EXPORTER_OTLP_PROTOCOL:language==='dotnet'?'grpc':['http','protobuf'].join('/'),OTEL_PROPAGATORS:'tracecontext',OTEL_TRACES_SAMPLER:'always_on',OTEL_BSP_SCHEDULE_DELAY:'100',OTEL_BLRP_SCHEDULE_DELAY:'100',OTEL_METRIC_EXPORT_INTERVAL:'1000',OTEL_METRICS_EXEMPLAR_FILTER:'trace_based',OTEL_METRICS_EXPORTER:'otlp',OTEL_LOGS_EXPORTER:'otlp',OTEL_INSTRUMENTATION_HTTP_SERVER_EXCLUDE_URLS:'.*/health',OTEL_DOTNET_EXPERIMENTAL_ASPNETCORE_DISABLE_URL_QUERY_REDACTION:'true'}
   await container(prefix+'-'+language,[...Object.entries(variables).flatMap(([key,value])=>['-e',key+'='+value]),'porthole-c7-'+language])
  }
  for(const language of ['python','java','go','dotnet']){
   let ready=false
   for(let attempt=0;attempt<120;attempt++){
    const states=await execute('docker',['inspect','--format','{{.Name}} {{.State.Running}}',...names])
    const exited=states.stdout.split('\n').find(line=>line.endsWith(' false'))
    if(exited)throw Error('OTLP estate process exited: '+exited.split(' ')[0])
    try{if((await fetch('http://127.0.0.1:'+ports[language]+'/health')).status===200){ready=true;break}}catch{}
    await pause(250)
   }
   if(!ready)throw Error(language+' readiness failed')
  }
  return {captures,failures,delivery,ports,stop,async stopProducers(){
   // Stop exporters after their periodic metrics have run, then drain their
   // final batches while the stock Collector and real intake remain alive.
   for(const language of ['python','java','go','dotnet'])await execute('docker',['stop','--time','10',prefix+'-'+language])
   await pause(500)
  },async diagnostics(){return Promise.all(names.map(async name=>{const result=await execute('docker',['logs',name]);return {name,output:(result.stdout+result.stderr).split(secret).join('[redacted]')}}))}}
 }catch(error){console.log(JSON.stringify(await Promise.all(names.map(async name=>{const result=await execute('docker',['logs',name]).catch(()=>({stdout:'',stderr:''}));return {name,output:(result.stdout+result.stderr).split(secret).join('[redacted]')}}))));await stop();throw error}
}
