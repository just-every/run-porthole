import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createServer as socketServer} from 'node:net'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {setTimeout as delay} from 'node:timers/promises'
const execute=promisify(execFile),require=createRequire(import.meta.resolve('@opentelemetry/sdk-node'))
const {MeterProvider,PeriodicExportingMetricReader,AggregationType}=require('@opentelemetry/sdk-metrics')
const {OTLPMetricExporter}=require('@opentelemetry/exporter-metrics-otlp-http')
const {resourceFromAttributes}=require('@opentelemetry/resources')
const api='/api/porthole/v1',credential='/app/settings/credentials'
const scope={services:['synthetic-porthole-6100'],environments:['production'],teams:['commerce'],signals:['metrics','traces'],actions:['telemetry.read']}
const auth=secret=>({authorization:'Bearer '+secret})
const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port}
const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.()})
const freePort=async()=>{const s=socketServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
async function until(check,message,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await delay(100)}assert.fail(message)}

// Independent minimal protobuf wire construction for official remote-read
// protocol probes. Interoperability is established by stock Prometheus below.
const cat=(...parts)=>Buffer.concat(parts.flat().map(p=>Buffer.from(p)))
const vint=value=>{let n=BigInt.asUintN(64,BigInt(value)),out=[];do{out.push(Number(n&127n)|(n>127n?128:0));n>>=7n}while(n);return Buffer.from(out)}
const integer=(n,v)=>cat(vint(n*8),vint(v))
const msg=(n,b)=>cat(vint(n*8+2),vint(b.length),b)
const text=(n,s)=>msg(n,Buffer.from(s))
const packed=b=>{const n=b.length-1;return cat(vint(b.length),n<60?Buffer.from([n<<2]):n<256?Buffer.from([240,n]):Buffer.from([244,n&255,n>>8]),b)}
function unpack(b){let at=0;const uint=()=>{let n=0,shift=0,v;do{v=b[at++];n+=(v&127)*2**shift;shift+=7}while(v&128);return n};const size=uint(),out=Buffer.alloc(size);let pos=0;while(at<b.length){const tag=b[at++],kind=tag&3;let count,distance;if(!kind){count=tag>>2;if(count<60)count++;else{const bytes=count-59;count=1;for(let i=0;i<bytes;i++)count+=b[at++]*2**(i*8)}b.copy(out,pos,at,at+count);at+=count;pos+=count}else{if(kind===1){count=4+((tag>>2)&7);distance=((tag&224)<<3)+b[at++]}else{count=1+(tag>>2);distance=0;for(let i=0;i<(kind===2?2:4);i++)distance+=b[at++]*2**(i*8)}for(let i=0;i<count;i++)out[pos]=out[pos++-distance]}}assert.equal(pos,size);return out}
function fields(b){let at=0;const uint=()=>{let n=0n,shift=0n,v;do{v=b[at++];n|=BigInt(v&127)<<shift;shift+=7n}while(v&128);return n};const result=[];while(at<b.length){const tag=Number(uint()),wire=tag&7;let v;if(wire===0)v=uint();else if(wire===2){const size=Number(uint());v=b.subarray(at,at+=size)}else{assert.ok(wire===1||wire===5);v=b.subarray(at,at+=wire===1?8:4)}result.push([tag>>3,v])}return result}
const get=(parts,n)=>parts.find(([k])=>k===n)?.[1]
export function remoteBody({from=0n,through=18446744073709n,matchers=[['__name__','.*',2]],types=[0]}={}){
 const query=cat(integer(1,from),integer(2,through),...matchers.map(([name,v,type=0])=>msg(3,cat(integer(1,type),text(2,name),text(3,v)))))
 return packed(cat(msg(1,query),...types.map(type=>integer(2,type))))
}
export async function remoteRead(call,secret,options={},extra={}){
 return call('/api/v1/read',{method:'POST',headers:{...auth(secret),'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-read-version':'0.1.0',...extra},body:remoteBody(options)})
}
export async function remoteSeries(response){
 assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store')
 const body=unpack(Buffer.from(await response.arrayBuffer()))
 return fields(body).flatMap(([,result])=>fields(result).map(([,series])=>{
  const parts=fields(series),metric=Object.fromEntries(parts.filter(([n])=>n===1).map(([,v])=>{const pair=fields(v);return [get(pair,1).toString(),get(pair,2)?.toString()??'']}))
  return {metric,values:parts.filter(([n])=>n===2).map(([,v])=>{const sample=fields(v);return [Number(get(sample,2)??0n)/1000,get(sample,1)?.readDoubleLE()??0]})}
 }))
}

/** Existing journeys reuse the standard door on their actual retained inputs. */
export async function assertTempoRead({origin,call=(path,options)=>fetch(origin+path,options),cookie,traceId,scope:grants,expected}){
 const post=(path,data)=>call(path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const read=await value(await post(credential+'/mint',{name:'Standard trace reader',class:'read',scope:{...grants,signals:['traces'],actions:['telemetry.read']}}),201)
 const response=await call('/api/traces/'+traceId,{headers:{...auth(read.secret),accept:'application/protobuf'}})
 assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('x-porthole-trace-completeness'),'partial')
 const bytes=Buffer.from(await response.arrayBuffer())
 assert.ok(bytes.length>0)
 if(expected){
  const scratch=await mkdtemp(join(tmpdir(),'tempo-otlp-'))
  try{
   await writeFile(join(scratch,'trace.pb'),bytes)
   const python=process.env.PORTHOLE_EXPORT_PYTHON??resolve('.cache/export-readers/bin/python')
   const parsed=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',join(scratch,'trace.pb')])).stdout)
   const spans=parsed.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans))
   assert.deepEqual(spans.map(s=>s.spanId).sort(),expected.map(s=>s.spanId).sort())
   for(const span of spans){const source=expected.find(s=>s.spanId===span.spanId);assert.equal(span.startTimeUnixNano,source.startTimeUnixNano??source.startTimeNs);assert.equal(span.endTimeUnixNano,source.endTimeUnixNano??source.endTimeNs)}
  }finally{await rm(scratch,{recursive:true,force:true})}
 }
 await value(await post(credential+'/revoke',{id:read.credential.id}))
 assert.equal((await call('/api/traces/'+traceId,{headers:{cookie,...auth(read.secret)}})).status,401)
}

async function stockMetrics({origin,cookie,call,reader,source,scratch}){
 const clients=resolve('.cache/standard-clients'),binary=process.env.PORTHOLE_PROMETHEUS_BIN??join(clients,'prometheus')
 const prom=await import('prom-client'),registry=new prom.Registry(),labels=['service','environment','team','producer']
 const gauge=new prom.Gauge({name:'synthetic_scrape_gauge',help:'Actual producer state',labelNames:labels,registers:[registry]})
 const counter=new prom.Counter({name:'synthetic_scrape_requests_total',help:'Actual requests',labelNames:labels,registers:[registry]})
 const histogram=new prom.Histogram({name:'synthetic_scrape_latency_seconds',help:'Observed work',labelNames:labels,buckets:[0.1,0.5,1],registers:[registry]})
 let generation=0,scrapeAt=0;const sourceSamples=[],otlpPackets=[],children=[]
 const producer=createServer(async(req,res)=>{
  if(req.url==='/work'){
   generation++;for(let i=0;i<24;i++){const l=[scope.services[0],'production','commerce','synthetic-porthole-'+(6200+i)];gauge.labels(...l).set(generation+i);counter.labels(...l).inc(i+1);histogram.labels(...l).observe((i%3+1)/10)}
   scrapeAt=Date.now();res.end(String(generation));return
  }
  if(req.url==='/metrics'){
   const body=(await registry.metrics()).split('\n').map(line=>line&&!line.startsWith('#')?line+' '+scrapeAt:line).join('\n')
   if(scrapeAt)sourceSamples.push({time:scrapeAt,body});res.writeHead(200,{'content-type':registry.contentType});res.end(body);return
  }
  res.writeHead(404);res.end()
 })
 const producerOrigin=await listen(producer)
 let referenceOrigin
 const relay=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks)
   const read=req.url.startsWith('/api/v1/read'),otlp=req.url==='/v1/metrics'
   const headers={'content-type':req.headers['content-type']??'application/x-protobuf',authorization:req.headers.authorization??'',...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{}),...(read?{'x-prometheus-remote-read-version':'0.1.0'}:{'x-prometheus-remote-write-version':'0.1.0'})}
   assert.ok(headers.authorization==='Bearer '+(read?reader.secret:source.secret),'stock client sends its configured credential')
   const response=await call(req.url,{method:'POST',headers,body})
   if(otlp){otlpPackets.push(body);const reference=await fetch(referenceOrigin+'/api/v1/otlp/v1/metrics',{method:'POST',headers:{'content-type':headers['content-type']},body});assert.equal(reference.status,200,await reference.text())}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){res.writeHead(503);res.end(String(error))}
 })
 const relayOrigin=await listen(relay)
 const start=async(name,config)=>{
  const p=await freePort(),dir=join(scratch,name);await mkdir(dir)
  const path=join(dir,'prometheus.yml');await writeFile(path,config,{mode:0o600})
  const child=spawn(binary,['--config.file='+path,'--storage.tsdb.path='+join(dir,'data'),'--web.listen-address=127.0.0.1:'+p,'--web.enable-otlp-receiver','--log.level=info'],{env:{...process.env,GOMAXPROCS:'2'},stdio:['ignore','pipe','pipe']});children.push(child)
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b)
  const base='http://127.0.0.1:'+p
  await until(async()=>{if(child.exitCode!==null)throw Error(logs);return fetch(base+'/-/ready').then(r=>r.ok,()=>false)},'stock Prometheus readiness')
  if(name==='reference')await until(async()=>logs.includes('Replaying WAL'),'stock remote-write WAL watcher starts before producer samples')
  return base
 }
 let provider
 try{
  const sourceKeyPath=join(scratch,'source-credential');await writeFile(sourceKeyPath,source.secret,{mode:0o600})
  referenceOrigin=await start('reference',`global:\n  scrape_interval: 500ms\n  scrape_timeout: 400ms\nscrape_configs:\n  - job_name: synthetic-porthole-6100\n    honor_labels: true\n    static_configs:\n      - targets: [${JSON.stringify(new URL(producerOrigin).host)}]\nremote_write:\n  - url: ${relayOrigin}/api/v1/write\n    authorization:\n      credentials_file: ${sourceKeyPath}\n    write_relabel_configs:\n      - source_labels: [__name__]\n        regex: synthetic_scrape_.*\n        action: keep\n    queue_config:\n      batch_send_deadline: 100ms\n      min_shards: 1\n      max_shards: 1\n`)
  // Only standard remote_read and its private credential file are configured.
  const keyPath=join(scratch,'read-credential');await writeFile(keyPath,reader.secret,{mode:0o600})
  const remoteOrigin=await start('reader',`global:\n  scrape_interval: 1s\nremote_read:\n  - url: ${relayOrigin}/api/v1/read\n    read_recent: true\n    authorization:\n      credentials_file: ${keyPath}\n`)
  const exporter=new OTLPMetricExporter({url:relayOrigin+'/v1/metrics',headers:auth(source.secret)})
  provider=new MeterProvider({resource:resourceFromAttributes({'service.name':scope.services[0],'service.instance.id':'synthetic-porthole-6101','deployment.environment.name':'production','team.name':'commerce'}),readers:[new PeriodicExportingMetricReader({exporter,exportIntervalMillis:3600000})],views:[{instrumentName:'synthetic.otel.histogram',aggregation:{type:AggregationType.EXPLICIT_BUCKET_HISTOGRAM,boundaries:[0.1,0.5,1]}}]})
  const meter=provider.getMeter('synthetic-porthole-6102','1.0'),otelGauge=meter.createGauge('synthetic.otel.gauge',{unit:'ms'}),otelCounter=meter.createCounter('synthetic.otel.requests',{unit:'{request}'}),otelHistogram=meter.createHistogram('synthetic.otel.histogram',{unit:'s'})
  for(let i=0;i<5;i++){
   await fetch(producerOrigin+'/work');const emittedAt=scrapeAt;await until(async()=>sourceSamples.some(s=>s.time===emittedAt),'reference scrapes each source generation');otelGauge.record(20+i,{region:'synthetic-porthole-6103'});otelCounter.add(2,{region:'synthetic-porthole-6103'});otelHistogram.record(0.2,{region:'synthetic-porthole-6103'})
   await provider.forceFlush();await delay(1100)
  }
  await value(await call(api+'/ingest/drain',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'}))
  const query=async(base,expression,instant)=>{
   const response=await fetch(base+'/api/v1/query?'+new URLSearchParams({query:expression,time:String(instant)}));assert.equal(response.status,200,await response.clone().text());const data=await response.json();assert.equal(data.status,'success');return data.data
  }
  await until(async()=>{
   await value(await call(api+'/ingest/drain',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'}))
   const data=await query(remoteOrigin,'count(synthetic_scrape_gauge)',Date.now()/1000)
   return data.result[0]?.value[1]==='24'
  },'stock remote-write becomes queryable through stock remote-read',90000)
  console.log('Stock scrape generations '+JSON.stringify({scrapes:sourceSamples.length,timestamps:[...new Set(sourceSamples.map(s=>s.time))],counter:(await query(referenceOrigin,'synthetic_scrape_requests_total[2m]',Date.now()/1000)).result.slice(0,1)}))
  await until(async()=>{const data=await query(referenceOrigin,'min(count_over_time(synthetic_scrape_requests_total[2m]))',Date.now()/1000);return Number(data.result[0]?.value[1])>=3},'reference retains multiple real counter scrapes')
  const instant=Date.now()/1000
  const expressions=['synthetic_scrape_gauge','sum by (producer) (synthetic_scrape_requests_total)','rate(synthetic_scrape_requests_total[2m])','increase(synthetic_scrape_requests_total[2m])','synthetic_scrape_latency_seconds_bucket','synthetic_otel_gauge_milliseconds','synthetic_otel_requests_total','synthetic_otel_histogram_seconds_bucket','synthetic_otel_histogram_seconds_sum','synthetic_otel_histogram_seconds_count']
  for(const expression of expressions){
   const reference=await query(referenceOrigin,expression,instant),actual=await query(remoteOrigin,expression,instant)
   const sort=data=>({...data,result:data.result.slice().sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric)))})
   assert.ok(reference.result.length>0,'reference has actual source data for '+expression+' '+JSON.stringify(await query(referenceOrigin,'synthetic_scrape_requests_total[2m]',instant)))
   assert.deepEqual(sort(actual),sort(reference),'stock evaluation parity: '+expression)
  }
  const range='synthetic_scrape_gauge[2m]',reference=await query(referenceOrigin,range,instant),actual=await query(remoteOrigin,range,instant)
  const normalize=data=>data.result.map(series=>({metric:Object.fromEntries(Object.entries(series.metric).sort()),values:series.values})).sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric)))
  assert.deepEqual(normalize(actual),normalize(reference),'every original label, timestamp and value survives stock remote-read')
  assert.ok(actual.result.reduce((n,s)=>n+s.values.length,0)>100,'multiple real scrapes and pages are reconciled')
  assert.ok(sourceSamples.length>=5);assert.equal(otlpPackets.length,5)
  console.log('PROBE PORT-061 standard metrics: stock Prometheus 3.5.0 remote_read evaluates ten fixed expressions over real scrape and stock OTLP input -> exact reference series, labels, timestamps and values')
  return {otlpPackets,instant,sourceSamples,referenceOrigin,readerOrigin:remoteOrigin}
 }finally{
  if(provider)await provider.shutdown()
  for(const child of children)if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped}
  await close(relay);await close(producer)
 }
}

export async function standardReadJourney({origin,cookie,call=(path,options)=>fetch(origin+path,options),freshOwner,restartWorker,sql,withEmptyDestination,withPinnedClock}){
 cookie=await freshOwner()
 const post=(path,data,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)})
 const mint=async(kind,extra={})=>value(await post(credential+'/mint',{name:'Standard signal reader',class:kind,scope:{...scope,actions:kind==='ingest'?['telemetry.write']:['telemetry.read']},...extra}),201)
 const source=await mint('ingest'),reader=await mint('read'),quota=await mint('read',{scannedBytesPerDay:1})
 const scratch=await mkdtemp(join(tmpdir(),'porthole-standard-'))
 try{
  for(const path of ['/api/v1/read','/api/traces/0123456789abcdef0123456789abcdef'])assert.equal((await call(path,{headers:{cookie}})).status,401,'cookies alone cannot read standard signals')
  for(const path of ['/api/v1/query','/api/v1/query_range','/api/v1/series','/api/v1/labels','/api/v1/label/team/values','/api/v1/metadata','/api/v1/targets/metadata','/api/metrics/query_range','/api/v2/search/tags','/api/search','/api/search/tags','/api/v2/traces/0123456789abcdef0123456789abcdef'])assert.equal((await call(path,{headers:auth(reader.secret)})).status,501,'explicit unsupported standard route '+path)
  await value(await remoteRead(call,reader.secret,{types:[1]}),415)
  await value(await remoteRead(call,reader.secret,{matchers:[['__name__','(?=a)',2]]}),400)
  const metrics=await stockMetrics({origin,cookie,call,reader,source,scratch})
  const all=await remoteSeries(await remoteRead(call,reader.secret,{matchers:[['__name__','synthetic_.*',2]]}))
  assert.ok(all.length>24)
  const refusal=await remoteRead(call,quota.secret);assert.equal(refusal.status,429);assert.ok(Number(refusal.headers.get('retry-after'))>0)
  const foreign=await mint('read',{scope:{...scope,teams:['synthetic-porthole-6199']}})
  assert.deepEqual(await remoteSeries(await remoteRead(call,foreign.secret)),[],'restricted series never appear')
  const clone=await mint('read')
  await value(await post(credential+'/rescope',{id:clone.credential.id,scope:{...scope,teams:['synthetic-porthole-6199']}}))
  assert.deepEqual(await remoteSeries(await remoteRead(call,clone.secret)),[],'next request uses narrower current scope')
  await value(await post(credential+'/revoke',{id:clone.credential.id}))
  assert.equal((await remoteRead(call,clone.secret,{}, {cookie})).status,401,'revoked credential cannot borrow owner session')
  if(withPinnedClock){const expiring=await mint('read',{expiresAt:Date.now()+60000});await withPinnedClock(Date.now()+120000,async()=>assert.equal((await remoteRead(call,expiring.secret)).status,401))}
  // A real multi-team HTTP, Kafka and database estate supplies captured stock
  // spans and real operation identities. No hand-authored spans prove parity.
  const traceSource=await mint('ingest',{scope:{...scope,services:['checkout','fulfillment'],environments:['production','staging'],teams:['commerce','fulfillment'],actions:['telemetry.write']}})
  const {serviceCatalogEstate}=await import('./polyglot/estate.mjs')
  const estate=await serviceCatalogEstate({origin,secret:traceSource.secret,dispatch:call})
  await value(await post(api+'/ingest/drain',{}))
  const selected=estate.spans[0].traceId,expected=estate.spans.filter(span=>span.traceId===selected)
  assert.ok(expected.length>2)
  const traceReader=await mint('read',{scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}})
  const traceResponse=await call('/api/traces/'+selected,{headers:{...auth(traceReader.secret),accept:'application/protobuf'}})
  assert.equal(traceResponse.status,200);assert.equal(traceResponse.headers.get('x-porthole-trace-completeness'),'partial')
  const file=join(scratch,'trace.pb');await writeFile(file,Buffer.from(await traceResponse.arrayBuffer()))
  const python=process.env.PORTHOLE_EXPORT_PYTHON??resolve('.cache/export-readers/bin/python')
  const original=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',file])).stdout)
  const spans=original.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans))
  const captured=[]
  for(let index=0;index<estate.packets.length;index++){
   const packetPath=join(scratch,'capture-'+index+'.pb');await writeFile(packetPath,estate.packets[index].body)
   const packet=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',packetPath])).stdout)
   captured.push(...packet.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).filter(span=>span.traceId===selected))
  }
  const canonical=item=>JSON.stringify(item,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)
  assert.deepEqual(spans.map(canonical).sort(),captured.map(canonical).sort(),'official generated OTLP reader matches captured stock-exported spans exactly')
  assert.deepEqual(spans.map(s=>s.spanId).sort(),expected.map(s=>s.spanId).sort(),'stock SDK receipts independently account for every returned span')
  const proxy=createServer(async(req,res)=>{const response=await call(req.url,{headers:{...auth(traceReader.secret),accept:req.headers.accept??'application/json'}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))})
  const endpoint=await listen(proxy)
  try{
   const cli=process.env.PORTHOLE_TEMPO_CLI_BIN??resolve('.cache/standard-clients/tempo-cli')
   const output=await execute(cli,['query','api','trace-id',new URL(endpoint).host,selected,'--v1'],{timeout:30000})
   assert.ok(output.stdout.includes('batches'),'stock Tempo CLI decodes trace-by-ID')
  }finally{await close(proxy)}
  const restricted=await mint('read',{scope:{...scope,services:['fulfillment'],teams:['fulfillment']}})
  const limited=await value(await call('/api/traces/'+selected,{headers:auth(restricted.secret)}))
  const decodedIds=limited.batches.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).map(s=>Buffer.from(s.spanId,'base64').toString('hex'))
  assert.ok(decodedIds.length>0&&decodedIds.length<expected.length)
  assert.deepEqual(decodedIds.sort(),expected.filter(s=>s.resource?.['team.name']==='fulfillment').map(s=>s.spanId).sort())
  const before=all
  await restartWorker();cookie=await freshOwner()
  assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,{matchers:[['__name__','synthetic_.*',2]]})),before,'restart preserves exact standard samples')
  if(withEmptyDestination){const {standardArchiveJourney}=await import('./archive.mjs');await standardArchiveJourney({origin,freshOwner,withEmptyDestination,reader,scope,expected:before,traceId:selected})}
  if(withEmptyDestination)await standardSchemaProof({origin,cookie,call,source,reader,post,restartWorker,sql})
  console.log('PROBE PORT-061 standard traces: captured stock HTTP and Kafka spans -> official OTLP binary reader exact spans and stock Tempo CLI; restricted span set and explicit partial evidence; restart and inactive restore')
  return {metrics,estate,reader,source,scope}
 }finally{await rm(scratch,{recursive:true,force:true})}
}

export async function standardAnalyticalJourney(){
 const {analyticalEstate}=await import('./analytics.mjs'),{recipientMailJourney}=await import('./health.mjs'),{fixture}=await import('./fixture.mjs')
 const estate=await analyticalEstate()
 try{await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
  const {origin,call,getDb,sessionSecret,ownerEmail}=context
  const sql=async statement=>(await getDb().prepare(statement).all()).results
  const restartWorker=async change=>{await change?.();await context.restart()}
  const helpers=fixture({origin,sql,restartWorker,sessionSecret,ownerEmail,call})
  let cookie=await helpers.freshOwner()
  const post=(path,data,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)})
  const connect=async role=>{const config=await value(await call(api+'/analytics/configuration',{headers:{cookie}}));await value(await post(api+'/analytics/configuration',{revision:config.revision,role,enabled:true,confirm:'connect-analytical-workers'}))}
  await connect('primary')
  const result=await standardReadJourney({origin,call,cookie,restartWorker,...helpers})
  cookie=await helpers.freshOwner()
  const original=await remoteSeries(await remoteRead(call,result.reader.secret))
  await connect('standby')
  assert.deepEqual(await remoteSeries(await remoteRead(call,result.reader.secret)),original,'both real analytical configurations return identical standard samples')
  const traceId=result.estate.spans[0].traceId
  const allTrace=await value(await post(credential+'/mint',{name:'Live trace reader',class:'read',scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}}),201)
  const trace=await call('/api/traces/'+traceId,{headers:auth(allTrace.secret)})
  assert.equal(trace.status,200);assert.equal(trace.headers.get('x-porthole-trace-completeness'),'partial')
  const mint=async()=>value(await post(credential+'/mint',{name:'Live metric reader',class:'read',scope}),201)
  const afterLast=action=>{
   const run=async response=>{assert.equal(response.status,200);const page=await response.json();if(page.cursor)estate.afterQuery(run);else await action()}
   estate.afterQuery(run)
  }
  const revoked=await mint()
  afterLast(async()=>value(await post(credential+'/revoke',{id:revoked.credential.id})))
  const refusal=await remoteRead(call,revoked.secret);assert.equal(refusal.status,401);assert.deepEqual(await refusal.json(),{error:'invalid_credential'})
  const narrowed=await mint()
  afterLast(async()=>value(await post(credential+'/rescope',{id:narrowed.credential.id,scope:{...scope,teams:['synthetic-porthole-6199']}})))
  assert.equal((await remoteRead(call,narrowed.secret)).status,409,'final-page narrowing prevents accumulated result release')
  const expired=await mint()
  afterLast(()=>getDb().prepare('UPDATE porthole_credentials SET expires_at=created_at+1 WHERE id=?').bind(expired.credential.id).run())
  assert.equal((await remoteRead(call,expired.secret)).status,401,'expiry during a real analytical scan refuses the result')
  const row=await getDb().prepare('SELECT * FROM porthole_telemetry_records WHERE service=? AND signal=? LIMIT 1').bind(scope.services[0],'metrics').first()
  afterLast(()=>getDb().prepare('DELETE FROM porthole_telemetry_records WHERE id=?').bind(row.id).run())
  const custody=await remoteRead(call,result.reader.secret);assert.equal(custody.status,409);assert.deepEqual(await custody.json(),{error:'standard_read_custody_changed'})
  const columns=Object.keys(row);await getDb().prepare('INSERT INTO porthole_telemetry_records('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...columns.map(k=>row[k])).run()
  afterLast(async()=>value(await post(api+'/export-exclusions',{confirm:'apply-exclusions',journal:{format:'porthole.export-exclusions.v1',records:[{recordId:row.id,excludedAt:Date.now()}]}})))
  const excluded=await remoteSeries(await remoteRead(call,result.reader.secret))
  assert.ok(excluded.reduce((n,s)=>n+s.values.length,0)<original.reduce((n,s)=>n+s.values.length,0),'portable exclusions applied after last analytical page suppress the actual sample')
  await estate.stop('standby')
  try{assert.equal((await remoteRead(call,result.reader.secret)).status,503)}finally{await estate.start('standby')}
  await connect('primary')
  console.log('PROBE PORT-061 authority: both real analytical backends -> same stock samples; mid-read revoke and expiry -> 401; narrowing and custody change -> 409; quota -> 429; excluded records absent; unavailable backend -> 503')
 }})}finally{await estate.dispose()}
}

/** Official-schema edges complement the stock producers, including wire forms
 * those producers cannot emit (summary and stale float bit patterns). */
export async function standardSchemaProof({origin,cookie,call,source,reader,post,restartWorker,sql}) {
 const attributes=[['service.name',scope.services[0]],['deployment.environment.name','production'],['team.name','commerce']].map(([key,stringValue])=>({key,value:{stringValue}}))
 const at=1000000000123456n,through=at+1000000n
 const point={timeUnixNano:String(at),attributes:[{key:'privacy.subject',value:{stringValue:'synthetic-porthole-6110'}}]}
 const metrics=[
  {name:'synthetic.edge.gauge',unit:'ms',gauge:{dataPoints:[{...point,asDouble:24.5}]}},
  {name:'synthetic.edge.counter',sum:{aggregationTemporality:2,isMonotonic:true,dataPoints:[{...point,asInt:'17'}]}},
  {name:'synthetic.edge.nonmonotonic',sum:{aggregationTemporality:2,isMonotonic:false,dataPoints:[{...point,asInt:'-3'}]}},
  {name:'synthetic.edge.histogram',unit:'s',histogram:{aggregationTemporality:2,dataPoints:[{...point,count:'6',sum:2,explicitBounds:[0.1,0.5],bucketCounts:['1','2','3']}]}},
  {name:'synthetic.edge.summary',summary:{dataPoints:[{...point,count:'8',sum:4,quantileValues:[{quantile:0.5,value:0.2},{quantile:0.9,value:0.8}]}]}},
 ]
 const wire=JSON.stringify({resourceMetrics:[{resource:{attributes},scopeMetrics:[{scope:{name:'synthetic-porthole-6111'},metrics}]}]})
 await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:wire}))
 await value(await post(api+'/ingest/drain',{}))
 const query={from:at/1000000n,through:through/1000000n,matchers:[['__name__','synthetic_edge_.*',2]]}
 const rows=await remoteSeries(await remoteRead(call,reader.secret,query)),byName=name=>rows.filter(s=>s.metric.__name__===name)
 assert.deepEqual(byName('synthetic_edge_gauge_milliseconds')[0].values,[[1000000,24.5]])
 assert.deepEqual(byName('synthetic_edge_counter_total')[0].values,[[1000000,17]])
 assert.deepEqual(byName('synthetic_edge_nonmonotonic')[0].values,[[1000000,-3]])
 assert.deepEqual(byName('synthetic_edge_histogram_seconds_bucket').map(s=>[s.metric.le,s.values[0][1]]).sort(),[['+Inf',6],['0.1',1],['0.5',3]].sort())
 assert.deepEqual(byName('synthetic_edge_summary').map(s=>[s.metric.quantile,s.values[0][1]]).sort(),[['0.5',0.2],['0.9',0.8]])
 const missing=await remoteSeries(await remoteRead(call,reader.secret,{...query,matchers:[['__name__','synthetic_edge_gauge_milliseconds'],['absent','',0]]}))
 assert.equal(missing.length,1,'absent label equals empty string')
 assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,{...query,matchers:[['__name__','synthetic_edge_gauge_milliseconds'],['privacy_subject','synthetic-porthole-6110',1]]})),[])
 const staleAt=2000000n,bits=['0000000000000080','020000000000f07f','000000000000f07f'],series=bits.map((hex,index)=>{
  const labels={__name__:'synthetic_edge_float',service:scope.services[0],environment:'production',team:'commerce',edge:'synthetic-porthole-'+(6112+index)}
  return msg(1,cat(...Object.entries(labels).map(([k,v])=>msg(1,cat(text(1,k),text(2,v)))),msg(2,cat(vint(9),Buffer.from(hex,'hex'),integer(2,staleAt)))))
 })
 const write=packed(cat(...series))
 assert.equal((await call('/api/v1/write',{method:'POST',headers:{...auth(source.secret),'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'},body:write})).status,204)
 await value(await post(api+'/ingest/drain',{}))
 const read=await remoteRead(call,reader.secret,{from:staleAt,through:staleAt,matchers:[['__name__','synthetic_edge_float']]})
 assert.equal(read.status,200)
 const response=unpack(Buffer.from(await read.arrayBuffer())),actual=fields(get(fields(response),1)).map(([,s])=>get(fields(get(fields(s),2)),1).toString('hex')).sort()
 assert.deepEqual(actual,bits.slice().sort(),'negative zero, stale NaN and infinity round-trip bit-exact')
 // Model a pre-upgrade retained record; its unchanged stock wire remains in
 // the original custody envelope. This is fixture setup, not an edit API.
 if(sql){
  await sql("UPDATE porthole_telemetry_records SET payload=json_remove(payload,'$.record.valueBits') WHERE json_extract(payload,'$.metric.name')='synthetic_edge_float'")
  const legacy=await remoteRead(call,reader.secret,{from:staleAt,through:staleAt,matchers:[['__name__','synthetic_edge_float']]})
  assert.equal(legacy.status,200)
  const decoded=unpack(Buffer.from(await legacy.arrayBuffer()))
  assert.deepEqual(fields(get(fields(decoded),1)).map(([,s])=>get(fields(get(fields(s),2)),1).toString('hex')).sort(),bits.slice().sort(),'legacy samples recover exact float bits from original wire')
 }
 // Unsupported types are acknowledged by OTLP intake but cannot silently turn
 // into standard samples. Their own narrow ranges must explicitly refuse.
 for(const [kind,container,index]of [
  ['sum',{aggregationTemporality:1,isMonotonic:true,dataPoints:[{...point,timeUnixNano:'3000000000000',asInt:'1'}]},0],
  ['exponentialHistogram',{aggregationTemporality:2,dataPoints:[{...point,timeUnixNano:'3000001000000',count:'1',sum:1,scale:0,zeroCount:'1'}]},1],
 ]){
  const payload={resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics:[{name:'synthetic.edge.unsupported',[kind]:container}]}]}]}
  await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:JSON.stringify(payload)}))
  await value(await post(api+'/ingest/drain',{}))
  const response=await remoteRead(call,reader.secret,{from:3000000n+BigInt(index),through:3000000n+BigInt(index)})
  assert.equal(response.status,422);assert.ok((await response.json()).error.startsWith('unmappable_metric_'))
 }
 const traceId='61000000000000000000000000000001',traceWire=JSON.stringify({resourceSpans:[{resource:{attributes},scopeSpans:[{spans:[{traceId,spanId:'6100000000000001',name:'synthetic-porthole-6119',startTimeUnixNano:String(at),endTimeUnixNano:String(at+100n),attributes:point.attributes}]}]}]})
 await value(await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:traceWire}))
 await value(await post(api+'/ingest/drain',{}))
 assert.equal((await call('/api/traces/'+traceId,{headers:auth(reader.secret)})).status,200)
 const preview=await value(await post(api+'/subject-erasure',{identifier:'synthetic-porthole-6110'}))
 assert.equal(preview.canApply,true)
 await value(await post(api+'/subject-erasure/apply',{identifier:'synthetic-porthole-6110',digest:preview.digest,confirm:'erase-exact-batches'}))
 assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,query)),[],'erased original metric batch never appears in standard reads')
 assert.equal((await call('/api/traces/'+traceId,{headers:auth(reader.secret)})).status,404,'erased spans never appear through trace-by-ID')
 await restartWorker()
 assert.equal((await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:traceWire})).status,409,'erased trace capture cannot resurrect')
 assert.equal((await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:wire})).status,409,'replayed erased wire cannot resurrect a standard sample')
 for(let offset=0;offset<2001;offset+=100){
  const budgetWire=JSON.stringify({resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics:[{name:'synthetic.edge.budget',gauge:{dataPoints:Array.from({length:Math.min(100,2001-offset)},(_,index)=>({timeUnixNano:String(4000000000000n+BigInt(offset+index)*1000000n),asInt:String(offset+index)}))}}]}]}]})
  await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:budgetWire}))
 }
 let pending=1;for(let pass=0;pass<20&&pending;pass++)pending=(await value(await post(api+'/ingest/drain',{}))).pendingBatches
 assert.equal(pending,0)
 const exhausted=await remoteRead(call,reader.secret,{from:4000000n,through:4002000n})
 assert.equal(exhausted.status,422);assert.deepEqual(await exhausted.json(),{error:'standard_read_budget_exceeded'})
 console.log('PROBE PORT-061 schema and erasure: cumulative gauges, sums, buckets and summaries map exactly; raw float bits survive; delta and exponential inputs refuse; erased subject and replay remain absent after restart')
}
