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
 const prefix='porthole-c7-'+randomUUID().slice(0,8),containers=[],gateway=httpServer()
 async function stop(){await pause(1000);await Promise.all(containers.map(name=>execute('docker',['stop','--time','5',name]).catch(()=>{})));for(const name of containers.reverse())await execute('docker',['rm','-f',name]).catch(()=>{});if(gateway.listening)await new Promise(resolve=>gateway.close(resolve))}
 async function container(name,args){containers.push(name);await execute('docker',['run','--detach','--name',name,'--network','host',...args],{maxBuffer:1024*1024})}
 async function environment({origin,secret}) {
  try {
   gateway.on('request',async(req,res)=>{
    try{
     const chunks=[];for await(const chunk of req)chunks.push(chunk)
     const response=await fetch(origin+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/x-protobuf',...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{}),authorization:'Bearer '+secret},body:Buffer.concat(chunks)})
     res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/x-protobuf'});res.end(Buffer.from(await response.arrayBuffer()))
    }catch{res.writeHead(503);res.end()}
   })
   await new Promise(resolve=>gateway.listen(0,'0.0.0.0',resolve));const exportUrl='http://127.0.0.1:'+gateway.address().port+'/v1/traces'
   const ports=Object.fromEntries(await Promise.all(['python','java','go','dotnet','ruby','php','kafka','controller'].map(async name=>[name,await freePort()])))
   await container(prefix+'-kafka',['-e','KAFKA_NODE_ID=1','-e','KAFKA_PROCESS_ROLES=broker,controller','-e',`KAFKA_LISTENERS=PLAINTEXT://:${ports.kafka},CONTROLLER://:${ports.controller}`,'-e',`KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:${ports.kafka}`,'-e','KAFKA_CONTROLLER_QUORUM_VOTERS=1@127.0.0.1:'+ports.controller,'-e','KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER','-e','KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT','-e','KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT','-e','KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1','apache/kafka:3.9.1'])
   console.log('Polyglot Kafka process started; starting six stock-instrumented services')
   const languages=['python','java','go','dotnet','ruby','php']
   for(let index=languages.length-1;index>=0;index--){
    const language=languages[index],next=index<languages.length-1?'http://127.0.0.1:'+ports[languages[index+1]]+'/work':''
    const variables={PORT:String(ports[language]),NEXT_URL:next,OTEL_SERVICE_NAME:language,OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-1101',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:exportUrl,OTEL_EXPORTER_OTLP_TRACES_PROTOCOL:'http/protobuf',OTEL_EXPORTER_OTLP_PROTOCOL:'http/protobuf',OTEL_PROPAGATORS:'tracecontext',OTEL_TRACES_SAMPLER:'always_on',OTEL_BSP_SCHEDULE_DELAY:'100',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',OTEL_PHP_AUTOLOAD_ENABLED:'true'}
    await container(prefix+'-'+language,[...Object.entries(variables).flatMap(([key,value])=>['-e',key+'='+value]),'porthole-c7-'+language])
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
 return {environment,stop}
}
