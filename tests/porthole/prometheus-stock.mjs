import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import {recipientMailJourney} from './health.mjs'
import {analyticalEstate} from './analytics.mjs'

// Official v3.5.0 release checksums; the producer, sender and reference run on
// loopback. No provider account, external source, query parity or capacity claim.
const version='3.5.0',checksums={
 'linux-x64':'e811827af26d822afb09a4f28314f61b618b12cff5369835a67f674d8b46f39a',
 'linux-arm64':'173389cc42bf09c4e6e54cb53fa07a5a835d7c261e14775d2183181d6e385d1c',
 'darwin-x64':'5856d0c306e7d852d9a79788b20acb630501b3fab120b69f5317d6b0732dea57',
 'darwin-arm64':'c17bc2c992f0b5515eebe2b4ccd626214f8e309a0fe6ec40ed13c42ec13d05fb',
}
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const scope={services:['synthetic-porthole-22000'],environments:['production'],teams:['synthetic-porthole-22001']}
const root='/api/porthole/v1/ingest'
const canonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
const sampleKey=sample=>canonical(sample.labels)+' '+sample.timestamp+' '+sample.bits
async function until(check,message,timeout=60000) {
 const end=Date.now()+timeout
 while(Date.now()<end){if(await check())return;await delay(100)}
 assert.fail(message)
}
async function listen(handler) {
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening')
 return {server,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
}
async function freePort(){const server=await listen();const port=new URL(server.origin).port;await server.close();return port}
async function prometheusBinary() {
 if(process.env.PORTHOLE_PROMETHEUS_BIN){
  const binary=resolve(process.env.PORTHOLE_PROMETHEUS_BIN),result=await execute(binary,['--version'])
  assert.match(result.stdout+result.stderr,/version 3\.5\.0\b/,'reference qualification uses the declared source version')
  return binary
 }
 const checksum=checksums[process.platform+'-'+process.arch]
 assert.ok(checksum,'no qualified Prometheus binary for this platform')
 const platform=process.platform+'-'+(process.arch==='x64'?'amd64':'arm64'),name='prometheus-'+version+'.'+platform
 const directory=resolve('.cache/toolchains'),archive=join(directory,name+'.tar.gz'),binary=join(directory,name,'prometheus')
 await mkdir(directory,{recursive:true})
 let bytes=await readFile(archive).catch(()=>null)
 if(!bytes||hash(bytes)!==checksum){
  const response=await fetch('https://github.com/prometheus/prometheus/releases/download/v'+version+'/'+name+'.tar.gz',{signal:AbortSignal.timeout(180000)})
  assert.equal(response.status,200,'official Prometheus release download')
  bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),checksum,'official release integrity')
  await writeFile(archive,bytes)
 }
 if(!await access(binary).then(()=>true,()=>false))await execute('tar',['-xzf',archive,'-C',directory])
 return binary
}
async function launch(binary,scratch,name,configuration,receiver=false) {
 const port=await freePort(),file=join(scratch,name+'.yml')
 await writeFile(file,configuration,{mode:0o600})
 const args=['--config.file='+file,'--storage.tsdb.path='+join(scratch,name),'--web.listen-address=127.0.0.1:'+port,'--log.level=warn',...(receiver?['--web.enable-remote-write-receiver']:[])]
 const child=spawn(binary,args,{env:{...process.env,GOMAXPROCS:'2'},stdio:['ignore','pipe','pipe']})
 const server={child,origin:'http://127.0.0.1:'+port,logs:'',stopped:false}
 const output=chunk=>{server.logs=(server.logs+String(chunk)).slice(-4000)}
 child.stdout.on('data',output);child.stderr.on('data',output)
 server.stop=async()=>{if(server.stopped)return;server.stopped=true;if(child.exitCode!==null)return;const ended=once(child,'exit');child.kill('SIGTERM');if(!await Promise.race([ended.then(()=>true),delay(10000).then(()=>false)])){child.kill('SIGKILL');await ended}}
 try {await until(async()=>{if(child.exitCode!==null)throw Error('Stock Prometheus exited before readiness');return fetch(server.origin+'/-/ready').then(r=>r.ok).catch(()=>false)},'stock Prometheus readiness');return server}
 catch(error){await server.stop();throw error}
}

// Independent wire inspection, following the upstream v3.5.0 prompb schema.
// These helpers never call the product decoder and do not manufacture the
// qualifying samples. The encoder is only for raw reference reads and refusals.
const vint=value=>{let n=BigInt(value),result=[];while(n>127n){result.push(Number(n&127n)|128);n>>=7n}return Buffer.from([...result,Number(n)])}
const message=(number,bytes)=>Buffer.concat([vint(number*8+2),vint(bytes.length),bytes])
const string=(number,text)=>message(number,Buffer.from(text))
const uint=(number,value)=>Buffer.concat([vint(number*8),vint(value)])
function protobuf(bytes) {
 bytes=Buffer.from(bytes);let offset=0
 const integer=()=>{let n=0n,shift=0n,byte;do{assert.ok(offset<bytes.length,'complete captured protobuf');byte=bytes[offset++];n|=BigInt(byte&127)<<shift;shift+=7n;assert.ok(shift<=70n)}while(byte&128);return n}
 const result=[]
 while(offset<bytes.length){const tag=Number(integer()),number=tag>>3,wire=tag&7;assert.ok(number>0);let value;if(wire===0)value=integer();else{const length=wire===2?Number(integer()):wire===1?8:wire===5?4:NaN;assert.ok(Number.isSafeInteger(length)&&offset+length<=bytes.length);value=bytes.subarray(offset,offset+length);offset+=length}result.push({number,wire,value})}
 return result
}
function uncompress(bytes) {
 bytes=Buffer.from(bytes);let position=0,length=0,shift=0,byte
 do{byte=bytes[position++];length+=(byte&127)*2**shift;shift+=7}while(byte&128)
 assert.ok(length<=1024*1024*4)
 const output=Buffer.alloc(length);let offset=0
 while(position<bytes.length){const tag=bytes[position++],kind=tag&3;let count,distance=0
  if(kind===0){count=(tag>>2)+1;if(count>60){const size=count-60;count=1;for(let i=0;i<size;i++)count+=bytes[position++]*2**(8*i)}bytes.copy(output,offset,position,position+count);position+=count}
  else{if(kind===1){count=4+((tag>>2)&7);distance=((tag&224)<<3)+bytes[position++]}
   else{count=(tag>>2)+1;for(let i=0;i<(kind===2?2:4);i++)distance+=bytes[position++]*2**(8*i)}
   assert.ok(distance>0&&distance<=offset);for(let i=0;i<count;i++)output[offset+i]=output[offset+i-distance]
  }offset+=count
 }assert.equal(offset,length);return output
}
function compress(bytes) {
 const length=bytes.length-1,extra=[];let n=length
 while(n){extra.push(n&255);n>>>=8}
 return Buffer.concat([vint(bytes.length),Buffer.from(length<60?[length<<2]:[(59+extra.length)<<2,...extra]),bytes])
}
function series(bytes) {
 const fields=protobuf(bytes),labels=Object.fromEntries(fields.filter(f=>f.number===1).map(f=>{const pair=protobuf(f.value);return [pair.find(f=>f.number===1).value.toString(),pair.find(f=>f.number===2)?.value.toString()??'']}))
 return fields.filter(f=>f.number===2).map(f=>{const parts=protobuf(f.value),value=parts.find(f=>f.number===1)?.value??Buffer.alloc(8);return {labels,timestamp:String(parts.find(f=>f.number===2)?.value??0n),bits:value.readBigUInt64LE().toString(16).padStart(16,'0'),value:value.readDoubleLE()}})
}
function decodeWrite(wire) {
 const fields=protobuf(uncompress(wire)),types=['unknown','counter','gauge','histogram','gaugehistogram','summary','info','stateset']
 return {samples:fields.filter(f=>f.number===1).flatMap(f=>series(f.value)),metadata:fields.filter(f=>f.number===3).map(f=>{const parts=protobuf(f.value),field=n=>parts.find(p=>p.number===n)?.value;return {type:types[Number(field(1)??0n)],familyName:field(2)?.toString()??'',help:field(4)?.toString()??'',unit:field(5)?.toString()??''}})}
}
async function referenceSamples(origin) {
 const matcher=Buffer.concat([uint(1,0),string(2,'job'),string(3,scope.services[0])])
 const query=Buffer.concat([uint(1,0),uint(2,Date.now()+60000),message(3,matcher)])
 const response=await fetch(origin+'/api/v1/read',{method:'POST',headers:{'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-read-version':'0.1.0'},body:compress(message(1,query))})
 assert.equal(response.status,200,await response.clone().text())
 return protobuf(uncompress(Buffer.from(await response.arrayBuffer()))).filter(f=>f.number===1).flatMap(f=>protobuf(f.value).filter(f=>f.number===1).flatMap(f=>series(f.value)))
}
function producer() {
 const workers=Array.from({length:4},()=>({count:0,sum:0,buckets:[0,0,0],gauge:0})),expositions=[]
 let scrapes=0
 const handler=async(request,response)=>{
  const url=new URL(request.url,'http://localhost')
  if(url.pathname==='/work'){
   const worker=workers[Number(url.searchParams.get('worker'))],begin=process.hrtime.bigint()
   await delay(2)
   const seconds=Number(process.hrtime.bigint()-begin)/1e9
   worker.count++;worker.sum+=seconds;worker.gauge=seconds
   for(const [i,bound]of [.001,.01,Infinity].entries())if(seconds<=bound)worker.buckets[i]++
   response.end('synthetic-porthole-22002');return
  }
  assert.equal(url.pathname,'/metrics');scrapes++
  const lines=['# HELP synthetic_porthole_duration_seconds Real request duration 日本語.','# TYPE synthetic_porthole_duration_seconds histogram','# HELP synthetic_porthole_requests_total Real completed requests.','# TYPE synthetic_porthole_requests_total counter','# HELP synthetic_porthole_last_seconds Last measured duration.','# TYPE synthetic_porthole_last_seconds gauge','# HELP synthetic_porthole_nan A measured NaN.','# TYPE synthetic_porthole_nan gauge','# HELP synthetic_porthole_vanish A removed source series.','# TYPE synthetic_porthole_vanish gauge'],samples=[]
  const add=(name,labels,value)=>{lines.push(name+'{'+Object.entries(labels).map(([key,value])=>key+'='+JSON.stringify(value)).join(',')+'} '+value);samples.push({labels:{__name__:name,...labels},value:String(value)})}
  const base={service:scope.services[0],environment:scope.environments[0],team:scope.teams[0]}
  workers.forEach((worker,index)=>{
   const labels={...base,worker:String(index),note:'日本語 "quoted" \\ label',empty:''}
   add('synthetic_porthole_requests_total',labels,worker.count);add('synthetic_porthole_last_seconds',labels,worker.gauge)
   for(const [i,le]of ['0.001','0.01','+Inf'].entries())add('synthetic_porthole_duration_seconds_bucket',{...labels,le},worker.buckets[i])
   add('synthetic_porthole_duration_seconds_sum',labels,worker.sum);add('synthetic_porthole_duration_seconds_count',labels,worker.count)
  })
  add('synthetic_porthole_nan',base,'NaN')
  if(scrapes<=4)add('synthetic_porthole_vanish',base,17)
  expositions.push({at:Date.now(),samples});response.setHeader('content-type','text/plain; version=0.0.4');response.end(lines.join('\n')+'\n')
 }
 return {handler,workers,expositions,get scrapes(){return scrapes}}
}
function remoteHeaders(secret,extra={}) {return {'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0',authorization:'Bearer '+secret,...extra}}
async function nativePages(context,extra={},headers={cookie:context.cookie},path=root+'/records') {
 const records=[];let cursor,snapshot,pages=0
 do {
  const params=new URLSearchParams({signal:'metrics',service:scope.services[0],limit:'47',...extra,...(cursor?{cursor,snapshot:String(snapshot)}:{})})
  const response=await context.call(path+'?'+params,{headers});assert.equal(response.status,200,await response.clone().text())
  const page=await response.json();snapshot??=page.snapshot;assert.equal(page.snapshot,snapshot)
  records.push(...page.records);cursor=page.cursor;pages++;assert.ok(pages<100)
 }while(cursor)
 return {records,pages,snapshot}
}
function reconcile(records,expected) {
 const samples=records.filter(row=>row.payload.metricKind!=='metadata')
 assert.equal(samples.length,expected.length,'every source sample, including staleness, remains queryable once')
 assert.equal(new Set(records.map(row=>row.id)).size,records.length,'no page overlap')
 assert.deepEqual(samples.map(row=>sampleKey({labels:row.payload.resource.attributes,timestamp:row.payload.record.timestamp,bits:row.payload.record.valueBits})).sort(),expected.map(sampleKey).sort(),'complete label sets, original milliseconds and original floating-point bits match the reference store')
 for(const row of samples){assert.equal(row.event_time_ns,String(BigInt(row.payload.record.timestamp)*1000000n).padStart(20,'0'));assert.equal(row.payload.record.sampleState,row.payload.record.valueBits==='7ff0000000000002'?'stale':row.payload.record.value==='NaN'?'nan':'present')}
 assert.ok(samples.some(row=>row.payload.record.sampleState==='stale'),'stock removal produces a source stale marker')
 assert.ok(samples.some(row=>row.payload.record.sampleState==='nan'),'ordinary source NaN remains distinct')
 return samples
}
async function drained(context) {
 let outcome
 await until(async()=>{outcome=await (await context.post(root+'/drain',{})).json();return !outcome.pendingBatches&&outcome.analytical.complete},'all durable samples indexed and replicated')
}

export async function prometheusStockJourney() {
 const binary=await prometheusBinary(),scratch=await mkdtemp(join(tmpdir(),'synthetic-porthole-prometheus-')),servers=[]
 const captures=new Map(),attempts=[],emitter=producer();let sender,reference,traffic,sourceMetadata,expected,savedWire,metadata
 let trafficRunning=true
 try {
  const producerServer=await listen(emitter.handler);servers.push(producerServer)
  reference=await launch(binary,scratch,'reference','global:\n  scrape_interval: 1s\nscrape_configs: []\n',true)
  await recipientMailJourney({run:async context=>{
   const {call,post,cookie,restart,getDb,browser}=context
   const source=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-22003',class:'ingest',scope:{...scope,signals:['metrics'],actions:['telemetry.write']},requestsPerMinute:10000,acceptedBytesPerMinute:100000000},201)).json()
   await post(root+'/control',{paused:true,maxPendingBytes:1})
   let interrupt=true
   const proxy=await listen((request,response)=>{(async()=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk)
    const wire=Buffer.concat(chunks),headers={...request.headers};delete headers.host;delete headers['content-length']
    const result=await call('/api/v1/write',{method:'POST',headers,body:wire})
    const receipt={status:result.status,duplicate:result.headers.get('x-porthole-duplicate'),retry:result.headers.get('retry-after'),wire,headers}
    attempts.push(receipt)
    if(result.status===204){captures.set(hash(wire),{wire,headers});if(interrupt){interrupt=false;response.destroy();return}}
    response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()))
   })().catch(()=>response.destroy())});servers.push(proxy)
   const endpoints=[{url:reference.origin+'/api/v1/write'},{url:proxy.origin+'/api/v1/write',bearer_token:source.secret}]
   // Existing stock multi-endpoint facility. The only destination differences
   // are the endpoint and installation-local bearer credential.
   const config='global:\n  scrape_interval: 1s\n  scrape_timeout: 900ms\nscrape_configs:\n  - job_name: '+scope.services[0]+'\n    static_configs:\n      - targets: ['+JSON.stringify(new URL(producerServer.origin).host)+']\nremote_write:\n'+endpoints.map(endpoint=>'  - url: '+JSON.stringify(endpoint.url)+'\n'+(endpoint.bearer_token?'    bearer_token: '+JSON.stringify(endpoint.bearer_token)+'\n':'')+'    queue_config:\n      min_shards: 1\n      max_shards: 1\n      batch_send_deadline: 200ms\n      min_backoff: 100ms\n      max_backoff: 1s\n      retry_on_http_429: true\n    metadata_config:\n      send: true\n      send_interval: 1s\n').join('')
   sender=await launch(binary,scratch,'sender',config)
   traffic=(async()=>{while(trafficRunning){await Promise.all(emitter.workers.map((_,i)=>fetch(producerServer.origin+'/work?worker='+i).then(r=>r.text())));await delay(30)}})()
   await until(()=>attempts.some(a=>a.status===429),'stock sender encounters real durable-buffer backpressure')
   assert.ok(Number(attempts.find(a=>a.status===429).retry)>0,'pressure supplies retry advice')
   await post(root+'/control',{paused:true,maxPendingBytes:33554432})
   await until(()=>attempts.some(a=>a.duplicate==='true'),'stock sender retries after its durable acknowledgement is interrupted')
   await until(()=>emitter.scrapes>=5&&[...captures.values()].flatMap(c=>decodeWrite(c.wire).samples).length>120,'real stock samples arrive before source restart')
   const beforeRestart=emitter.scrapes,lastBeforeRestart=Math.max(...[...captures.values()].flatMap(c=>decodeWrite(c.wire).samples).map(s=>Number(s.timestamp)))
   // Restart the actual source with its existing TSDB and WAL, unchanged
   // producer, scrape configuration and destination queue settings.
   await sender.stop()
   sender=await launch(binary,scratch,'sender',config)
   await until(()=>emitter.scrapes>=beforeRestart+5&&[...captures.values()].some(c=>decodeWrite(c.wire).samples.some(s=>Number(s.timestamp)>lastBeforeRestart)),'stock source resumes collection from the existing TSDB and WAL')
   await until(()=>emitter.scrapes>=10&&[...captures.values()].flatMap(c=>decodeWrite(c.wire).samples).length>250,'more than 200 real stock samples accepted')
   sourceMetadata=(await (await fetch(sender.origin+'/api/v1/metadata')).json()).data
   // Stop collection by reloading only the scrape target list. Both stock
   // destination queues retain their existing settings and drain the same WAL.
   await writeFile(join(scratch,'sender.yml'),config.replace('targets: ['+JSON.stringify(new URL(producerServer.origin).host)+']','targets: []'),{mode:0o600})
   sender.child.kill('SIGHUP')
   await until(async()=>{
    const metrics=await (await fetch(sender.origin+'/metrics')).text()
    return metrics.split('\n').filter(line=>line.startsWith('prometheus_remote_storage_samples_pending{')).every(line=>line.endsWith(' 0'))&&attempts.some(a=>decodeWrite(a.wire).samples.some(s=>s.bits==='7ff0000000000002'))
   },'both stock destination queues drain and source staleness is emitted')
   await delay(1200)
   await sender.stop();trafficRunning=false;await traffic
   const writes=[...captures.values()].map(c=>decodeWrite(c.wire)),captured=writes.flatMap(write=>write.samples).filter(s=>s.labels.__name__.startsWith('synthetic_porthole_'))
   metadata=writes.flatMap(write=>write.metadata)
   assert.ok(captured.length>200);assert.equal(new Set(captured.map(sampleKey)).size,captured.length,'wire-identical retries never add a distinct captured source batch')
   expected=(await referenceSamples(reference.origin)).filter(s=>s.labels.__name__.startsWith('synthetic_porthole_'))
   assert.deepEqual(captured.map(sampleKey).sort(),expected.map(sampleKey).sort(),'all identical producer samples reach the actual stock reference TSDB')
   const instance=new URL(producerServer.origin).host
   for(const sample of captured.filter(s=>s.bits!=='7ff0000000000002')) {
    const {job,instance:actualInstance,...labels}=sample.labels
    assert.equal(job,scope.services[0]);assert.equal(actualInstance,instance)
    // Prometheus canonicalizes an empty label to absence, identically at both destinations.
    assert.ok(emitter.expositions.some(e=>Math.abs(e.at-Number(sample.timestamp))<2000&&e.samples.some(s=>canonical(Object.fromEntries(Object.entries(s.labels).filter(([,v])=>v!=='')))===canonical(labels)&&(Number.isNaN(sample.value)?s.value==='NaN':Number(s.value)===sample.value))),'each reference sample came from independently captured real producer exposition')
   }
   for(const name of ['synthetic_porthole_last_seconds','synthetic_porthole_requests_total','synthetic_porthole_duration_seconds'])assert.ok(metadata.some(m=>m.familyName===name),'stock metric-family metadata is emitted for '+name)
   assert.ok(metadata.some(m=>m.help.includes('日本語')),'metadata preserves original Unicode help')
   for(const m of metadata){const entries=sourceMetadata[m.familyName]??sourceMetadata[m.familyName+'_total'];assert.ok(entries?.some(e=>e.type===m.type&&e.help===m.help&&e.unit===m.unit),'metadata matches the stock source catalog')}
   savedWire=[...captures.values()]
   await restart()
   for(const capture of savedWire){const response=await call('/api/v1/write',{method:'POST',headers:capture.headers,body:capture.wire});assert.equal(response.status,204);assert.equal(response.headers.get('x-porthole-duplicate'),'true','durable restart retains exact source batch identity')}
   await post(root+'/control',{paused:false});await drained(context)
   const page=await nativePages(context),samples=reconcile(page.records.filter(r=>r.payload.metricKind==='metadata'||r.payload.metric.name.startsWith('synthetic_porthole_')),expected)
   assert.ok(page.pages>4,'native public reads really paginate')
   const retainedMetadata=page.records.filter(r=>r.payload.metricKind==='metadata')
   assert.deepEqual(retainedMetadata.map(r=>canonical(r.payload.metadata)).sort(),metadata.map(canonical).sort(),'separate metadata requests remain native records without invented values')
   assert.ok(retainedMetadata.every(r=>!Object.hasOwn(r.payload.record,'value')&&!Object.hasOwn(r.payload.record,'timestamp')))
   const archived=await nativePages(context,{},undefined,root+'/archive')
   assert.deepEqual(archived.records.map(r=>r.payload),page.records.map(r=>r.payload),'native retained and archived payloads agree')
   const query=await (await post('/api/porthole/v1/query',{signal:'metrics',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],limit:47})).json()
   assert.equal(query.records.length,47)
   const status=await (await call(root+'/status',{headers:{cookie}})).json(),totals=status.sources.filter(s=>s.sourceId===source.credential.id)
   for(const key of ['accepted','queryable','archived'])assert.equal(totals.reduce((n,s)=>n+s[key],0),page.records.length,key+' accounts for samples and metadata descriptors')
   assert.ok(totals.some(s=>s.reasons.some(r=>r.reason==='queue_pressure')),'pressure remains visible in delivery accounting')
   await browser('/app/explore?'+new URLSearchParams({signal:'metrics',service:scope.services[0],metric:'synthetic_porthole_vanish',limit:'47'}),'prometheus-stale-explore',['Query results','sampleState','stale'])
   await browser('/app/ingest','prometheus-delivery',['Telemetry delivery','queue_pressure'])
   await prometheusRefusals({context,source,capture:savedWire.find(c=>decodeWrite(c.wire).samples.length),samples:page.records.length})
   const {prometheusArchiveJourney}=await import('./archive.mjs')
   await prometheusArchiveJourney({context,expected:page.records,readPages:nativePages,recipientMailJourney})
   console.log('PROBE PORT-002 stock-source: Prometheus '+version+' real requests -> '+samples.length+' reference-matched source samples; '+metadata.length+' metadata descriptors; '+page.pages+' native pages; actual 429 retry, interrupted ACK, source TSDB and WAL restart, receiver restart and inactive archive passed')
  }})
  const estate=await analyticalEstate()
  try {await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
   const {post,call,cookie,restart}=context
   const source=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-22004',class:'ingest',scope:{...scope,signals:['metrics'],actions:['telemetry.write']},requestsPerMinute:10000,acceptedBytesPerMinute:100000000},201)).json()
   const configure=async role=>{const config=await (await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}})).json();await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role,enabled:true,confirm:'connect-analytical-workers'})}
   await configure('primary')
   for(const capture of savedWire)assert.equal((await call('/api/v1/write',{method:'POST',headers:{...capture.headers,authorization:'Bearer '+source.secret},body:capture.wire})).status,204)
   await drained(context)
   let first
   for(const role of ['primary','standby']){
    await configure(role)
    const page=await nativePages(context)
    reconcile(page.records.filter(r=>r.payload.metricKind!=='metadata'&&r.payload.metric.name.startsWith('synthetic_porthole_')),expected)
    assert.deepEqual(page.records.filter(r=>r.payload.metricKind==='metadata').map(r=>canonical(r.payload.metadata)).sort(),metadata.map(canonical).sort())
    const archive=await nativePages(context,{},undefined,root+'/archive');assert.deepEqual(archive.records.map(r=>r.payload),page.records.map(r=>r.payload))
    if(first)assert.deepEqual(page.records.map(r=>r.payload),first);else first=page.records.map(r=>r.payload)
    console.log('PROBE PORT-002 '+role+': stock wire replay through public intake -> '+expected.length+' exact reference samples and complete metadata across '+page.pages+' native pages')
   }
   await restart()
   for(const capture of savedWire){const response=await call('/api/v1/write',{method:'POST',headers:{...capture.headers,authorization:'Bearer '+source.secret},body:capture.wire});assert.equal(response.status,204);assert.equal(response.headers.get('x-porthole-duplicate'),'true')}
   await drained(context)
   for(const role of ['primary','standby'])assert.equal((await estate.inspect(role)).length,first.length,'both real physical copies retain one record per accepted sample or metadata descriptor')
   await estate.stop('standby')
   try {assert.equal((await call(root+'/records?signal=metrics',{headers:{cookie}})).status,503,'unavailable analytical storage cannot look like an empty successful result')}
   finally {await estate.start('standby')}
   const reader=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-22005',class:'read',scope:{...scope,signals:['metrics'],actions:['telemetry.read']},requestsPerMinute:1000,scannedBytesPerMinute:100000000},201)).json()
   const firstPage=await (await call(root+'/records?signal=metrics&limit=47',{headers:{authorization:'Bearer '+reader.secret}})).json();assert.equal(firstPage.records.length,47);assert.ok(firstPage.cursor)
   await post('/app/settings/credentials/revoke',{id:reader.credential.id})
   const denied=await call(root+'/records?'+new URLSearchParams({signal:'metrics',cursor:firstPage.cursor,snapshot:String(firstPage.snapshot)}),{headers:{authorization:'Bearer '+reader.secret}})
   assert.equal(denied.status,401);assert.equal(Object.hasOwn(await denied.json(),'records'),false)
   // Official-schema supplement for proto3 defaults and a nonempty unit that
   // this text exposition format does not emit. This is not stock-source proof.
   const name='synthetic_porthole_22009',descriptor=Buffer.concat([uint(1,2),string(2,name),string(4,'synthetic-porthole-22010 日本語'),string(5,'seconds')])
   const labels=[['__name__',name],['service',scope.services[0]],['environment',scope.environments[0]],['team',scope.teams[0]],['empty','']]
   const series=Buffer.concat([...labels.map(([name,value])=>message(1,Buffer.concat([string(1,name),...(value?[string(2,value)]:[])]))),message(2,Buffer.alloc(0))])
   const edge=compress(Buffer.concat([message(1,series),message(3,descriptor)]))
   assert.equal((await call('/api/v1/write',{method:'POST',headers:remoteHeaders(source.secret),body:edge})).status,204)
   await drained(context)
   const edgeRead=await nativePages(context,{metric:name})
   assert.equal(edgeRead.records.length,2)
   const edgeSample=edgeRead.records.find(r=>r.payload.metricKind==='sample').payload
   assert.equal(edgeSample.record.value,0);assert.equal(edgeSample.record.timestamp,'0');assert.equal(edgeSample.resource.attributes.empty,'')
   const edgeMetadata=edgeRead.records.find(r=>r.payload.metricKind==='metadata').payload.metadata
   assert.deepEqual(edgeMetadata,{type:'gauge',familyName:name,help:'synthetic-porthole-22010 日本語',unit:'seconds'})
   const edgeArchive=await nativePages(context,{metric:name},undefined,root+'/archive')
   assert.deepEqual(edgeArchive.records.map(r=>r.payload),edgeRead.records.map(r=>r.payload))
   await post('/app/settings/credentials/revoke',{id:source.credential.id})
   assert.equal((await call('/api/v1/write',{method:'POST',headers:remoteHeaders(source.secret),body:savedWire[0].wire})).status,401)
  }})}finally{await estate.dispose()}
 }finally{
  trafficRunning=false;if(traffic)await traffic
  if(sender)await sender.stop();if(reference)await reference.stop()
  for(const server of servers.reverse())await server.close()
  await rm(scratch,{recursive:true,force:true})
 }
 console.log('prometheusStockJourney passed: pinned unmodified Prometheus, real producer and reference TSDB, exact paginated native and both analytical reads, metadata, staleness, transport recovery, scope refusal and inactive custody')
}

async function prometheusRefusals({context,source,capture,samples}) {
 const {call,post,cookie,getDb}=context
 const count=async()=>(await getDb().prepare('SELECT COUNT(*) AS n FROM porthole_telemetry_records').first()).n
 const before=await count()
 const refuse=async(body,status,code,extra={})=>{const response=await call('/api/v1/write',{method:'POST',headers:remoteHeaders(source.secret,extra),body});assert.equal(response.status,status);assert.equal((await response.json()).error,code);assert.equal(await count(),before,'refusal changes no retained samples')}
 const decoded=protobuf(uncompress(capture.wire)),timeseries=decoded.find(f=>f.number===1).value
 await refuse(capture.wire,415,'unsupported_remote_write_version_or_encoding',{'content-type':'application/x-protobuf;proto=io.prometheus.write.v2.Request'})
 await refuse(Buffer.from([255]),400,'invalid_protobuf_varint')
 for(const number of [3,4])await refuse(compress(message(1,Buffer.concat([timeseries,message(number,Buffer.alloc(0))]))),415,'unsupported_remote_write_histogram_or_exemplar')
 await refuse(compress(message(9,Buffer.alloc(0))),415,'unsupported_remote_write_field')
 const foreign=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-22006',class:'ingest',scope:{...scope,services:['synthetic-porthole-22007'],signals:['metrics'],actions:['telemetry.write']}},201)).json()
 await refuse(capture.wire,403,'credential_scope_forbidden',{authorization:'Bearer '+foreign.secret})
 const read=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-22008',class:'read',scope:{...scope,services:['synthetic-porthole-22007'],signals:['metrics'],actions:['telemetry.read']}},201)).json()
 const wrongScope=await call(root+'/records?signal=metrics&service='+scope.services[0],{headers:{cookie,authorization:'Bearer '+read.secret}})
 assert.equal(wrongScope.status,403,'owner cookie cannot override foreign bearer scope')
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 await refuse(capture.wire,401,'invalid_credential')
 console.log('PROBE PORT-002 refusals: malformed Snappy, v2, exemplar, native histogram, unknown field, foreign and revoked source -> explicit errors and unchanged '+samples+' retained records')
}
