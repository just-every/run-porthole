import {gunzipSync} from 'node:zlib'
import {createServer as tlsServer} from 'node:https'
import {createServer} from 'node:net'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,readFile,chmod,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const execute=promisify(execFile),rows=[]
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
for(const kind of (process.env.PROOF_ONE?['503']:['503','429','timeout'])) {
 const dir=await mkdtemp(join(tmpdir(),'porthole-real-collector-'))
 let child,childExit,exit,attempts=0,recovered=false,received=[],rejected=0,inputAccepted=false,first=false,output='',collectorLog=''
 const sockets=new Set(),receiver=await port(),marker='synthetic-porthole-report-outage-'+kind,stamp=(BigInt(Date.now())*1000000n).toString()
 try {
  await mkdir(join(dir,'storage'))
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'ca.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'])
  const server=tlsServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'ca.pem'))},async(req,res)=>{
   const chunks=[];for await(const b of req)chunks.push(b)
   if(req.url==='/api/porthole/v1/fleet/report'){
    if(JSON.parse(Buffer.concat(chunks)).state==='stopped'){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return}
    attempts++
    if(attempts===1){
     first=true
     const payload={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:'synthetic-porthole-proof'}}]},scopeLogs:[{scope:{name:'synthetic-porthole-proof'},logRecords:[{timeUnixNano:stamp,body:{stringValue:marker}}]}]}]}
     const r=await fetch('http://127.0.0.1:'+receiver+'/v1/logs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
     inputAccepted=r.status===200
     if(kind==='timeout')return
     res.writeHead(Number(kind),{'retry-after':'1'});res.end('{}');return
    }
    recovered=true;res.writeHead(200,{'content-type':'application/json'});res.end('{}');return
   }
   if(req.url==='/v1/logs'){
    if(!recovered){rejected++;res.writeHead(503);res.end('{}');return}
    received.push(JSON.parse((req.headers['content-encoding']==='gzip'?gunzipSync(Buffer.concat(chunks)):Buffer.concat(chunks)).toString()));res.writeHead(200,{'content-type':'application/json'});res.end('{}');return
   }
   res.writeHead(200);res.end('{}')
  })
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const endpoint='https://127.0.0.1:'+server.address().port
  // Use the product exporter/retry/queue configuration unchanged. Only receivers,
  // filesystem paths and the local TLS edge are adapted for a host binary.
  const product=await readFile('packaging/collector/config.yaml','utf8')
  const exporter=product.slice(product.indexOf('exporters:\n'),product.indexOf('service:\n')).replace('endpoint: ${env:PORTHOLE_ENDPOINT}','endpoint: '+endpoint+'\n    encoding: json\n    tls:\n      ca_file: '+join(dir,'ca.pem'))
  await writeFile(join(dir,'otel.yaml'),'extensions:\n  file_storage:\n    directory: '+join(dir,'storage')+'\n  bearertokenauth:\n    token: synthetic-porthole-proof\nreceivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 127.0.0.1:'+receiver+'\nprocessors:\n  batch:\n    timeout: 100ms\n'+exporter+'service:\n  extensions: [bearertokenauth, file_storage]\n  pipelines:\n    logs:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlphttp]\n')
  await execute('/tmp/porthole-otel/otelcol-contrib',['validate','--config='+join(dir,'otel.yaml')])
  await writeFile(join(dir,'docker'),'#!'+process.execPath+'\n'+`
import {spawn} from 'node:child_process';
import {appendFileSync,writeFileSync,readFileSync,openSync} from 'node:fs';
const dir=process.env.PORTHOLE_FIXTURE,verb=process.argv[2];
appendFileSync(dir+'/commands',verb+'\\n');
if(verb==='create')console.log('a'.repeat(64));
if(verb==='start'){const log=openSync(dir+'/otel.log','a');const p=spawn('/tmp/porthole-otel/otelcol-contrib',['--config='+dir+'/otel.yaml'],{detached:true,stdio:['ignore',log,log]});p.unref();writeFileSync(dir+'/pid',String(p.pid));await new Promise(r=>setTimeout(r,500))}
if(verb==='inspect'){let running=false;try{process.kill(Number(readFileSync(dir+'/pid','utf8')),0);running=true}catch{}console.log(JSON.stringify([{Mounts:[],Config:{User:'0:0'},HostConfig:{},State:{Running:running,ExitCode:0}}]))}
if(verb==='version')console.log('host-proof');
if(verb==='stop'){try{process.kill(Number(readFileSync(dir+'/pid','utf8')),'SIGTERM')}catch{}}
`)
  await chmod(join(dir,'docker'),0o700)
  const file=join(dir,'collector.env')
  await writeFile(file,Object.entries({PORTHOLE_ENDPOINT:endpoint,PORTHOLE_INSTALL_ID:'synthetic-porthole-8630',PORTHOLE_SERVICE:'synthetic-porthole-8631',PORTHOLE_ENVIRONMENT:'production',PORTHOLE_TEAM:'synthetic-porthole-8632',PORTHOLE_INGEST_TOKEN:'synthetic-porthole-8633',PORTHOLE_CA_FILE:join(dir,'ca.pem')}).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600})
  child=spawn(process.execPath,['packaging/collector/install.mjs','install','--env-file',file],{env:{...process.env,PATH:dir+':'+process.env.PATH,PORTHOLE_FIXTURE:dir},stdio:['ignore','pipe','pipe']})
  childExit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{exit=code??signal;resolve()})})
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b)
  const deadline=Date.now()+25000
  while(exit===undefined&&!received.length&&Date.now()<deadline)await delay(50)
  const runningAtRecovery=exit===undefined
  if(exit===undefined){child.kill('SIGINT');const force=setTimeout(()=>child.kill('SIGKILL'),2000);await childExit;clearTimeout(force)}
  collectorLog=await readFile(join(dir,'otel.log'),'utf8')
  const records=received.flatMap(p=>p.resourceLogs.flatMap(r=>r.scopeLogs.flatMap(s=>s.logRecords)))
  rows.push({kind,officialCollector:'0.135.0',firstReportObserved:first,inputAcceptedDuringFailure:inputAccepted,exportRefusals:rejected,reportAttempts:attempts,fleetRecovered:recovered,installerAliveUntilDelivery:runningAtRecovery,delivered:records.filter(r=>r.body.stringValue===marker&&r.timeUnixNano===stamp).length,installerExit:exit,collectorShutdown:collectorLog.includes('Shutdown complete'),originalTimeUnixNano:stamp,marker})
  console.log(JSON.stringify(rows.at(-1)));if(!first)console.log({output,collectorLog})
  for(const s of sockets)s.destroy()
  await new Promise(r=>server.close(r))
 } finally {
  if(child&&exit===undefined){child.kill('SIGKILL');await childExit}
  try{process.kill(Number(await readFile(join(dir,'pid'),'utf8')),'SIGTERM')}catch{}
  await rm(dir,{recursive:true,force:true})
 }
}
await writeFile(process.argv[2],JSON.stringify({mode:process.argv[3],binarySha256:'43132748eb0effb56b9d508ca789149684bf7ab6ade5d65cd0b22c4d265a30c0',rows},null,2)+'\n')
