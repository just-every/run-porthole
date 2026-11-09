import assert from 'node:assert/strict'
import {literal} from './fixture.mjs'
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
export function remoteBody({from=0n,through=18446744073709n,matchers=[['__name__','.*',2]],types=[0],queries}={}){
 const query=({from:start=from,through:end=through,matchers:selectors=matchers})=>cat(integer(1,start),integer(2,end),...selectors.map(([name,v,type=0])=>msg(3,cat(integer(1,type),text(2,name),text(3,v)))))
 return packed(cat(...(queries??[{from,through,matchers}]).map(item=>msg(1,query(item))),...types.map(type=>integer(2,type))))
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

/** Reconcile the entire capture through disjoint bounded live reads. Each
 * window still uses every page of the scoped reader; none may be truncated. */
export async function remoteWindows(call,secret,windows){
 const series=new Map()
 for(const window of windows)for(const item of await remoteSeries(await remoteRead(call,secret,{...window,matchers:[['__name__','synthetic_.*',2]]}))){
  const metric=Object.fromEntries(Object.entries(item.metric).sort()),key=JSON.stringify(metric)
  if(!series.has(key))series.set(key,{metric,values:[]})
  series.get(key).values.push(...item.values)
 }
 return [...series.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,item])=>item)
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

async function stockMetrics({origin,cookie,call,reader,source,scratch,compareBackend}){
 const clients=resolve('.cache/standard-clients'),binary=process.env.PORTHOLE_PROMETHEUS_BIN??join(clients,'prometheus')
 const prom=await import('prom-client'),registry=new prom.Registry(),labels=['service','environment','team','producer']
 const gauge=new prom.Gauge({name:'synthetic_scrape_gauge',help:'Actual producer state',labelNames:labels,registers:[registry]})
 const counter=new prom.Counter({name:'synthetic_scrape_requests_total',help:'Actual requests',labelNames:labels,registers:[registry]})
 const histogram=new prom.Histogram({name:'synthetic_scrape_latency_seconds',help:'Observed work',labelNames:labels,buckets:[0.1,0.5,1],registers:[registry]})
 const summary=new prom.Summary({name:'synthetic_scrape_work_summary',help:'Observed work distribution',labelNames:labels,percentiles:[0.5,0.9],registers:[registry]})
 let generation=0,scrapeAt=0,capturing=true;const sourceSamples=[],otlpPackets=[],children=[]
 const producer=createServer(async(req,res)=>{
  if(req.url==='/work'){
   generation++;for(let i=0;i<24;i++){const l=[scope.services[0],'production','commerce','synthetic-porthole-'+(6200+i)];gauge.labels(...l).set(generation+i);counter.labels(...l).inc(i+1);histogram.labels(...l).observe((i%3+1)/10);if(i===0)summary.labels(...l).observe(generation)}
   scrapeAt=Date.now();res.end(String(generation));return
  }
  if(req.url==='/metrics'){
   if(!capturing){res.writeHead(503);res.end('capture complete');return}
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
   const headers={'accept-encoding':'identity','content-type':req.headers['content-type']??'application/x-protobuf',authorization:req.headers.authorization??'',...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{}),...(read?{'x-prometheus-remote-read-version':'0.1.0'}:{'x-prometheus-remote-write-version':'0.1.0'})}
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
  provider=new MeterProvider({resource:resourceFromAttributes({'service.name':scope.services[0],'service.instance.id':'synthetic-porthole-6101','deployment.environment.name':'production','team.name':'commerce'}),readers:[new PeriodicExportingMetricReader({exporter,exportIntervalMillis:3600000})],views:[{instrumentName:'synthetic.otel.histogram',aggregation:{type:AggregationType.EXPLICIT_BUCKET_HISTOGRAM,boundaries:[0.0000001,0.5,1]}}]})
  const meter=provider.getMeter('synthetic-porthole-6102','1.0'),otelGauge=meter.createGauge('synthetic.otel.gauge',{unit:'ms'}),otelCounter=meter.createCounter('synthetic.otel.total.requests',{unit:'{request}'}),otelHistogram=meter.createHistogram('synthetic.otel.histogram',{unit:'s'}),velocity=meter.createGauge('synthetic.otel.meters.velocity',{unit:['m','s'].join('/')}),ratio=meter.createGauge('synthetic.otel.ratio',{unit:'1'})
  for(let i=0;i<5;i++){
   await fetch(producerOrigin+'/work');const emittedAt=scrapeAt;await until(async()=>sourceSamples.some(s=>s.time===emittedAt),'reference scrapes each source generation');otelGauge.record(20+i,{region:'synthetic-porthole-6103',ready:true,shard:7,'9shard':'synthetic-porthole-6106',_edge:'synthetic-porthole-6107',__edge:'synthetic-porthole-6108','two..dots':'synthetic-porthole-6109',two__dots:'synthetic-porthole-6118',emptyZones:[],zones:['synthetic-porthole-6104','synthetic-porthole-6105'],weights:[1,2,3]});otelCounter.add(2,{region:'synthetic-porthole-6103'});otelHistogram.record(0.2,{region:'synthetic-porthole-6103'});velocity.record(i+1);ratio.record((i+1)/10)
   await provider.forceFlush();await delay(1100)
  }
  // End the real producer capture before the comparison workload. Stock
  // scraping otherwise keeps delivering the same final generation while the
  // reference queries run, legitimately exhausting a bounded live read.
  capturing=false
  // The stock reader's shutdown emits one last real collection. Finish that
  // collection before freezing the reference evaluation instant.
  await provider.shutdown();provider=undefined
  assert.equal(otlpPackets.length,6,'five explicit stock collections and the final shutdown collection')
  // The current stock SDK has no summary instrument. Its supported OTLP wire
  // form and cumulative non-monotonic sums also go to the actual reference
  // receiver, rather than using Porthole's mapper to compute expectations.
  const at=String(BigInt(Date.now())*1000000n),schemaAttributes=[{key:'structured',value:{kvlistValue:{values:[{key:'sequence',value:{intValue:'9007199254740993'}},{key:'nested',value:{arrayValue:{values:[{boolValue:false},{bytesValue:'AQID'},{}]}}}]}}}]
  const schema={resourceMetrics:[{resource:{attributes:[['service.name',scope.services[0]],['service.namespace','synthetic-porthole-6126'],['service.instance.id','synthetic-porthole-6127'],['deployment.environment.name','production'],['team.name','commerce']].map(([key,stringValue])=>({key,value:{stringValue}}))},scopeMetrics:[{metrics:[
   {name:'synthetic.schema.nonmonotonic',unit:'ms',sum:{aggregationTemporality:2,isMonotonic:false,dataPoints:[{timeUnixNano:at,asInt:'-3',attributes:schemaAttributes}]}},
   {name:'synthetic.schema.summary',summary:{dataPoints:[{timeUnixNano:at,count:'8',sum:4,quantileValues:[{quantile:0.0000001,value:0.2},{quantile:0.9,value:0.8}],attributes:schemaAttributes}]}},
  ]}]}]}
  const schemaResponse=await fetch(relayOrigin+'/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:JSON.stringify(schema)})
  assert.equal(schemaResponse.status,200,await schemaResponse.text())
  const instant=Date.now()/1000
  await value(await call(api+'/ingest/drain',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'}))
  const query=async(base,expression,instant)=>{
   const response=await fetch(base+'/api/v1/query?'+new URLSearchParams({query:expression,time:String(instant)}));assert.equal(response.status,200,await response.clone().text());const data=await response.json();assert.equal(data.status,'success');return data.data
  }
  await until(async()=>{
   await value(await call(api+'/ingest/drain',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'}))
   const data=await query(remoteOrigin,'count(synthetic_scrape_gauge)',instant)
   return data.result[0]?.value[1]==='24'
  },'stock remote-write becomes queryable through stock remote-read',90000)
  console.log('Stock scrape generations '+JSON.stringify({scrapes:sourceSamples.length,timestamps:[...new Set(sourceSamples.map(s=>s.time))],counter:(await query(referenceOrigin,'synthetic_scrape_requests_total[2m]',instant)).result.slice(0,1)}))
  await until(async()=>{const data=await query(referenceOrigin,'min(count_over_time(synthetic_scrape_requests_total[2m]))',instant);return Number(data.result[0]?.value[1])>=3},'reference retains multiple real counter scrapes')
  const expressions=['synthetic_scrape_gauge','sum by (producer) (synthetic_scrape_requests_total)','rate(synthetic_scrape_requests_total[2m])','increase(synthetic_scrape_requests_total[2m])','synthetic_scrape_latency_seconds_bucket','synthetic_otel_gauge_milliseconds','synthetic_otel_requests_total','synthetic_otel_histogram_seconds_bucket','synthetic_otel_histogram_seconds_sum','synthetic_otel_histogram_seconds_count','synthetic_otel_meters_velocity_per_second','synthetic_otel_ratio','synthetic_scrape_work_summary','synthetic_scrape_work_summary_sum','synthetic_scrape_work_summary_count','synthetic_schema_nonmonotonic_milliseconds','synthetic_schema_summary','synthetic_schema_summary_sum','synthetic_schema_summary_count']
  const normalize=data=>data.result.map(series=>({metric:Object.fromEntries(Object.entries(series.metric).sort()),values:series.values})).sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric)))
  const range='{__name__=~"synthetic_.*"}[2m]',reference=await query(referenceOrigin,range,instant),targets=await query(referenceOrigin,'target_info[2m]',instant)
  const expectations=new Map()
  for(const expression of expressions){
   const expected=await query(referenceOrigin,expression,instant)
   assert.ok(expected.result.length>0,'reference has actual source data for '+expression)
   expectations.set(expression,expected)
  }
  const verify=async()=>{
   for(const expression of expressions){
    const actual=await query(remoteOrigin,expression,instant)
    const sort=data=>({...data,result:data.result.slice().sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric)))})
    assert.deepEqual(sort(actual),sort(expectations.get(expression)),'stock evaluation parity: '+expression)
   }
   const actual=await query(remoteOrigin,range,instant)
   assert.deepEqual(normalize(actual),normalize(reference),'every original label, timestamp and value survives stock remote-read')
   assert.ok(actual.result.reduce((n,s)=>n+s.values.length,0)>1000,'every actual scrape and OTLP series crosses multiple pages')
   assert.deepEqual(normalize(await query(remoteOrigin,'target_info[2m]',instant)),normalize(targets),'resource target series also preserve every original label, timestamp and value')
  }
  await verify()
  if(compareBackend)await compareBackend(verify)
  assert.ok(sourceSamples.length>=5);assert.equal(otlpPackets.length,7,'six stock SDK collections and one explicit official-schema edge packet')
  console.log('PROBE PORT-061 standard metrics: stock Prometheus 3.5.0 remote_read evaluates '+expressions.length+' fixed expressions over real scrape, stock OTLP and official-schema summary input -> exact reference series, labels, timestamps and values'+(compareBackend?' on both analytical configurations':''))
  const generations=[...new Set(sourceSamples.map(sample=>sample.time))]
  assert.equal(generations.length,5,'all five actual producer generations were scraped')
  const split=BigInt(generations[3]),windows=[{from:0n,through:split-1n},{from:split,through:18446744073709n}]
  return {otlpPackets,instant,sourceSamples,windows,referenceSamples:normalize(reference).map(series=>({...series,values:series.values.map(([time,value])=>[time,Number(value)])})),referenceOrigin,readerOrigin:remoteOrigin}
 }finally{
  if(provider)await provider.shutdown()
  for(const child of children)if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped}
  await close(relay);await close(producer)
 }
}

export async function standardReadJourney({origin,cookie,call=(path,options)=>fetch(origin+path,options),freshOwner,restartWorker,sql,withEmptyDestination,withPinnedClock,compareBackend}){
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
  const metrics=await stockMetrics({origin,cookie,call,reader,source,scratch,compareBackend})
  let settled
  for(let pass=0;pass<20;pass++){settled=await value(await post(api+'/ingest/drain',{}));if(!settled.pendingBatches&&settled.analytical.complete)break}
  assert.equal(settled.pendingBatches,0);assert.equal(settled.analytical.complete,true,'the stock exporter shutdown flush is retained before snapshot comparison')
  const all=await remoteWindows(call,reader.secret,metrics.windows)
  assert.ok(all.length>24)
  assert.deepEqual(all,metrics.referenceSamples,'disjoint native windows reconcile the complete stock reference capture')
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
  let traceDrain
  for(let pass=0;pass<20;pass++){traceDrain=await value(await post(api+'/ingest/drain',{}));if(!traceDrain.pendingBatches&&traceDrain.analytical.complete)break}
  assert.equal(traceDrain.pendingBatches,0);assert.equal(traceDrain.analytical.complete,true,'real analytical replicas cover all stock trace batches')
  const selected=estate.spans[0].traceId,expected=estate.spans.filter(span=>span.traceId===selected)
  assert.ok(expected.length>2)
  const traceReader=await mint('read',{scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}})
  const traceResponse=await call('/api/traces/'+selected,{headers:{...auth(traceReader.secret),accept:'application/protobuf'}})
  assert.equal(traceResponse.status,200,await traceResponse.clone().text());assert.equal(traceResponse.headers.get('x-porthole-trace-completeness'),'partial')
  const file=join(scratch,'trace.pb');await writeFile(file,Buffer.from(await traceResponse.arrayBuffer()))
  const python=process.env.PORTHOLE_EXPORT_PYTHON??resolve('.cache/export-readers/bin/python')
  const original=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',file])).stdout)
  const spans=original.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans))
  const grouped=document=>document.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans.map(span=>({resource:r.resource??{},resourceSchemaUrl:r.schemaUrl??'',scope:s.scope??{},scopeSchemaUrl:s.schemaUrl??'',span}))))
  const captured=[],allCaptured=[]
  for(let index=0;index<estate.packets.length;index++){
   const packetPath=join(scratch,'capture-'+index+'.pb');await writeFile(packetPath,estate.packets[index].body)
   const packet=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',packetPath])).stdout)
   const items=grouped(packet);allCaptured.push(...items);captured.push(...items.filter(item=>item.span.traceId===selected))
  }
  const canonical=item=>JSON.stringify(item,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)
  assert.deepEqual(spans.map(s=>s.spanId).sort(),captured.map(s=>s.span.spanId).sort(),'every captured stock span identity survives standard retrieval')
  // PORT-016's mandatory intake privacy normalizes the actual parameterized
  // database statement before any retained wire. The standard reader must
  // preserve that approved representation rather than recover source SQL.
  for(const item of allCaptured)for(const attribute of item.span.attributes??[])if(['db.statement','db.query.text','db.operation.text','sql.query'].includes(attribute.key)){
   assert.equal(attribute.value.stringValue,'SELECT $1::text AS request_id')
   attribute.value.stringValue='select ? : : text as request_id'
  }
  assert.deepEqual(grouped(original).map(canonical).sort(),captured.map(canonical).sort(),'official generated OTLP reader preserves every authorized stock span field, resource and scope after mandatory intake privacy')
  assert.deepEqual(spans.map(s=>s.spanId).sort(),expected.map(s=>s.spanId).sort(),'stock SDK receipts independently account for every returned span')
  const errorId=estate.spans.find(span=>span.status.code===2)?.traceId
  const slowId=estate.spans.find(span=>Object.values(span.attributes).some(value=>typeof value==='string'&&value.includes('mode=slow')))?.traceId
  const traceIds=[...new Set([selected,errorId,slowId])];assert.equal(traceIds.length,3,'real healthy, failed and slow source requests have distinct traces')
  for(const id of traceIds.slice(1)){
   const response=await call('/api/traces/'+id,{headers:{...auth(traceReader.secret),accept:'application/protobuf'}})
   assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('x-porthole-trace-completeness'),'partial')
   const path=join(scratch,id+'.pb');await writeFile(path,Buffer.from(await response.arrayBuffer()))
   const document=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',path])).stdout)
   assert.deepEqual(grouped(document).map(canonical).sort(),allCaptured.filter(item=>item.span.traceId===id).map(canonical).sort(),'failed and slow HTTP and Kafka traces preserve all permitted fields')
  }

  const proxy=createServer(async(req,res)=>{const response=await call(req.url,{headers:{...auth(traceReader.secret),accept:req.headers.accept??'application/json'}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))})
  const endpoint=await listen(proxy)
  try{
   const cli=process.env.PORTHOLE_TEMPO_CLI_BIN??resolve('.cache/standard-clients/tempo-cli')
   const verify=async()=>{
    const output=await execute(cli,['query','api','trace-id',endpoint,selected,'--v1'],{timeout:30000})
    const clientPath=join(scratch,'tempo-client.json');await writeFile(clientPath,output.stdout)
    const clientTrace=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace-json',clientPath])).stdout)
    assert.deepEqual(grouped(clientTrace).map(canonical).sort(),grouped(original).map(canonical).sort(),'the pinned stock Tempo client decodes every permitted span field, resource and scope')
   }
   await verify()
   if(compareBackend)await compareBackend(verify)
  }finally{await close(proxy)}
  const restricted=await mint('read',{scope:{...scope,services:['fulfillment'],teams:['fulfillment']}})
  const limited=await value(await call('/api/traces/'+selected,{headers:auth(restricted.secret)}))
  const decodedIds=limited.batches.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).map(s=>Buffer.from(s.spanId,'base64').toString('hex'))
  assert.ok(decodedIds.length>0&&decodedIds.length<expected.length)
  assert.deepEqual(decodedIds.sort(),expected.filter(s=>s.resource?.['team.name']==='fulfillment').map(s=>s.spanId).sort())
  const traceQuota=await mint('read',{scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']},scannedBytesPerDay:1})
  const traceBudget=await call('/api/traces/'+selected,{headers:auth(traceQuota.secret)})
  assert.equal(traceBudget.status,429);assert.ok(Number(traceBudget.headers.get('retry-after'))>0)
  assert.deepEqual(await traceBudget.json(),{error:'credential_quota_exceeded'},'trace quota exhaustion releases no spans')
  const narrowedTrace=await mint('read',{scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}})
  await value(await post(credential+'/rescope',{id:narrowedTrace.credential.id,scope:{...scope,services:['fulfillment'],teams:['fulfillment']}}))
  const narrowedBody=await value(await call('/api/traces/'+selected,{headers:auth(narrowedTrace.secret)}))
  assert.deepEqual(narrowedBody.batches.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).map(s=>Buffer.from(s.spanId,'base64').toString('hex')).sort(),decodedIds,'next-request narrowing releases only the newly permitted spans')
  await value(await post(credential+'/revoke',{id:narrowedTrace.credential.id}))
  assert.equal((await call('/api/traces/'+selected,{headers:{cookie,...auth(narrowedTrace.secret)}})).status,401)
  if(withPinnedClock){
   const expiringTrace=await mint('read',{scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']},expiresAt:Date.now()+60000})
   await withPinnedClock(Date.now()+120000,async()=>assert.equal((await call('/api/traces/'+selected,{headers:auth(expiringTrace.secret)})).status,401))
  }

  const before=all
  await restartWorker();cookie=await freshOwner()
  assert.deepEqual(await remoteWindows(call,reader.secret,metrics.windows),before,'restart preserves exact standard samples')
  if(withEmptyDestination){const {standardArchiveJourney}=await import('./archive.mjs');await standardArchiveJourney({origin,freshOwner,withEmptyDestination,reader,traceReader,scope,windows:metrics.windows,expected:before,traceId:selected})}
  if(withEmptyDestination){
   // The independent restore can outlast the native owner's step-up proof.
   // Reauthenticate before the next owner-only credential and erasure actions.
   cookie=await freshOwner()
   await standardSchemaProof({origin,cookie,call,source,reader,post,restartWorker,sql})
  }
  cookie=await freshOwner()
  const auditResponse=await call('/api/v1/audit/export',{headers:{cookie}})
  assert.equal(auditResponse.status,200)
  const auditText=await auditResponse.text(),auditRows=JSON.parse(auditText).records.map(row=>row.entry)
  for(const id of [reader.credential.id,traceReader.credential.id])assert.ok(auditRows.some(row=>row.action==='telemetry.standard-read'&&row.phase==='succeeded'&&row.actorRef===id&&row.entityRef),'private audit links each standard reader to its opaque native snapshot')
  assert.ok(auditRows.some(row=>row.action==='telemetry.standard-read'&&row.phase==='denied'&&row.status===401),'private audit retains standard read refusal')
  for(const secret of [source.secret,reader.secret,traceReader.secret,quota.secret,foreign.secret,clone.secret])assert.ok(!auditText.includes(secret),'standard read credentials stay out of private audit contents')
  console.log('STANDARD_READ_RESULT '+JSON.stringify({metricSeries:all.length,metricSamples:all.reduce((n,series)=>n+series.values.length,0),traceIds:traceIds.length,selectedTraceSpans:spans.length,prometheus:'3.5.0',tempoClient:'2.8.2',result:'passed'}))
  console.log('PROBE PORT-061 standard traces: captured stock HTTP and Kafka spans -> official OTLP binary reader exact spans and stock Tempo CLI; restricted span set and explicit partial evidence; restart and inactive restore')
  return {metrics,estate,reader,source,scope,traceDocument:original}
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
  const compareBackend=async probe=>{await connect('standby');try{await probe()}finally{await connect('primary')}}
  const result=await standardReadJourney({origin,call,cookie,restartWorker,...helpers,compareBackend})
  cookie=await helpers.freshOwner()
  const original=await remoteWindows(call,result.reader.secret,result.metrics.windows)
  const window=result.metrics.windows[1]
  const windowSamples=await remoteSeries(await remoteRead(call,result.reader.secret,window))
  assert.ok(windowSamples.reduce((n,item)=>n+item.values.length,0)>200,'the authority probes scan more than one native page')
  await connect('standby')
  assert.deepEqual(await remoteWindows(call,result.reader.secret,result.metrics.windows),original,'both real analytical configurations return identical standard samples')
  const traceId=result.estate.spans[0].traceId
  const allTrace=await value(await post(credential+'/mint',{name:'Live trace reader',class:'read',scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}}),201)
  const trace=await call('/api/traces/'+traceId,{headers:auth(allTrace.secret)})
  assert.equal(trace.status,200);assert.equal(trace.headers.get('x-porthole-trace-completeness'),'partial')
  const jsonTrace=await trace.json()
  assert.deepEqual(jsonTrace.batches.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).map(s=>Buffer.from(s.spanId,'base64').toString('hex')).sort(),result.traceDocument.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).map(s=>s.spanId).sort(),'both analytical stores return every authorized stock span')
  const midTrace=await value(await post(credential+'/mint',{name:'Mid-read trace credential',class:'read',scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}}),201)
  estate.afterQuery(async()=>{await value(await post(credential+'/revoke',{id:midTrace.credential.id}))})
  const revokedTrace=await call('/api/traces/'+traceId,{headers:auth(midTrace.secret)})
  assert.equal(revokedTrace.status,401);assert.deepEqual(await revokedTrace.json(),{error:'invalid_credential'},'a revoked trace read releases no accumulated spans')
  for(const change of ['narrow','expire']){
   const key=await value(await post(credential+'/mint',{name:'Changing trace authority',class:'read',scope:{...scope,services:['checkout','fulfillment'],teams:['commerce','fulfillment']}}),201)
   estate.afterQuery(async()=>{
    if(change==='narrow')await value(await post(credential+'/rescope',{id:key.credential.id,scope:{...scope,services:['fulfillment'],teams:['fulfillment']}}))
    else await getDb().prepare('UPDATE porthole_credentials SET expires_at=created_at+1 WHERE id=?').bind(key.credential.id).run()
   })
   const response=await call('/api/traces/'+traceId,{headers:auth(key.secret)})
   assert.equal(response.status,change==='narrow'?409:401)
   assert.deepEqual(await response.json(),{error:change==='narrow'?'authority_changed':'invalid_credential'},'a changed trace credential releases no accumulated spans')
  }
  const root=await getDb().prepare("SELECT id,span_id FROM porthole_telemetry_records WHERE trace_id=? AND json_extract(payload,'$.record.parentSpanId') IS NULL LIMIT 1").bind(traceId).first()
  assert.ok(root)
  await value(await post(api+'/export-exclusions',{confirm:'apply-exclusions',journal:{format:'porthole.export-exclusions.v1',records:[{recordId:root.id,excludedAt:Date.now()}]}}))
  const excludedTrace=await call('/api/traces/'+traceId,{headers:auth(allTrace.secret)})
  assert.equal(excludedTrace.status,200);assert.equal(excludedTrace.headers.get('x-porthole-trace-completeness'),'partial')
  const excludedBody=await excludedTrace.json()
  assert.ok(excludedBody.batches.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)).every(s=>Buffer.from(s.spanId,'base64').toString('hex')!==root.span_id),'portable trace exclusions suppress the actual parent span')
  const mint=async()=>value(await post(credential+'/mint',{name:'Live metric reader',class:'read',scope}),201)
  const afterLast=action=>{
   const run=async response=>{assert.equal(response.status,200);const page=await response.json();if(page.cursor)estate.afterQuery(run);else await action()}
   estate.afterQuery(run)
  }
  const revoked=await mint()
  afterLast(async()=>value(await post(credential+'/revoke',{id:revoked.credential.id})))
  const refusal=await remoteRead(call,revoked.secret,window);assert.equal(refusal.status,401);assert.deepEqual(await refusal.json(),{error:'invalid_credential'})
  const narrowed=await mint()
  afterLast(async()=>value(await post(credential+'/rescope',{id:narrowed.credential.id,scope:{...scope,teams:['synthetic-porthole-6199']}})))
  assert.equal((await remoteRead(call,narrowed.secret,window)).status,409,'final-page narrowing prevents accumulated result release')
  const expired=await mint()
  afterLast(()=>getDb().prepare('UPDATE porthole_credentials SET expires_at=created_at+1 WHERE id=?').bind(expired.credential.id).run())
  assert.equal((await remoteRead(call,expired.secret,window)).status,401,'expiry during a real analytical scan refuses the result')
  const row=await getDb().prepare("SELECT * FROM porthole_telemetry_records WHERE service=? AND signal=? AND json_extract(payload,'$.metric.name')=? AND event_time_ns>=? LIMIT 1").bind(scope.services[0],'metrics','synthetic.otel.gauge',String(window.from*1000000n).padStart(20,'0')).first()
  afterLast(()=>getDb().prepare('DELETE FROM porthole_telemetry_records WHERE id=?').bind(row.id).run())
  const custody=await remoteRead(call,result.reader.secret,window);assert.equal(custody.status,409);assert.deepEqual(await custody.json(),{error:'standard_read_custody_changed'})
  const columns=Object.keys(row);await getDb().prepare('INSERT INTO porthole_telemetry_records('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...columns.map(k=>row[k])).run()
  afterLast(async()=>value(await post(api+'/export-exclusions',{confirm:'apply-exclusions',journal:{format:'porthole.export-exclusions.v1',records:[{recordId:row.id,excludedAt:Date.now()}]}})))
  const excluded=await remoteSeries(await remoteRead(call,result.reader.secret,window))
  assert.ok(excluded.reduce((n,s)=>n+s.values.length,0)<windowSamples.reduce((n,s)=>n+s.values.length,0),'portable exclusions applied after last analytical page suppress the actual sample')
  await estate.stop('standby')
  try{assert.equal((await remoteRead(call,result.reader.secret,window)).status,503)}finally{await estate.start('standby')}
  await connect('primary')
  await standardAnalyticalSchemaProof({origin,cookie,call,source:result.source,reader:result.reader,post,restartWorker,sql,seedErasureJournal:async batches=>{
   for(const batch of batches)await getDb().prepare('INSERT INTO porthole_erased_batches(id,content_digest,erased_at) SELECT id,digest,? FROM porthole_ingest_batches WHERE id=?').bind(Date.now(),batch.id).run()
  },compareBackend:async probe=>{
   await connect('standby');try{await probe()}finally{await connect('primary')}
  }})
  console.log('PROBE PORT-061 authority: both real analytical backends -> same stock samples; mid-read revoke and expiry -> 401; narrowing and custody change -> 409; quota -> 429; excluded records absent; unavailable backend -> 503')
 }})}finally{await estate.dispose()}
}

/** Official-schema edges complement the stock producers, including wire forms
 * those producers cannot emit (summary and stale float bit patterns). */
export async function standardSchemaProof(context) {
 const proof=await standardMappingProof(context)
 const {post,call,source,reader,restartWorker}=context,{query,wire,traceId,traceWire}=proof
 const preview=await value(await post(api+'/subject-erasure',{identifier:'synthetic-porthole-6110'}))
 assert.equal(preview.canApply,true)
 await value(await post(api+'/subject-erasure/apply',{identifier:'synthetic-porthole-6110',digest:preview.digest,confirm:'erase-exact-batches'}))
 assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,query)),[],'erased original metric batch never appears in standard reads')
 assert.equal((await call('/api/traces/'+traceId,{headers:auth(reader.secret)})).status,404,'erased spans never appear through trace-by-ID')
 await restartWorker()
 assert.equal((await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:traceWire})).status,409,'erased trace capture cannot resurrect')
 assert.equal((await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:wire})).status,409,'replayed erased wire cannot resurrect a standard sample')
 await standardBudgetProof({...context,...proof})
 console.log('PROBE PORT-061 schema and erasure: cumulative gauges, sums, buckets and summaries map exactly; raw float bits survive; delta and exponential inputs refuse; native erased subject and replay remain absent after restart')
}

/** Analytical deletion remains held by PORT-035. A pre-existing journal fixture
 * proves only the read fence against stale copies, never physical deletion. */
async function standardAnalyticalSchemaProof(context) {
 const proof=await standardMappingProof(context)
 const {post,call,source,reader,restartWorker,seedErasureJournal,compareBackend}=context,{query,rows,wire,traceId,traceWire}=proof
 const preview=await value(await post(api+'/subject-erasure',{identifier:'synthetic-porthole-6110'}))
 assert.equal(preview.canApply,true)
 const applied=await post(api+'/subject-erasure/apply',{identifier:'synthetic-porthole-6110',digest:preview.digest,confirm:'erase-exact-batches'})
 assert.equal(applied.status,409);assert.deepEqual(await applied.json(),{error:'analytical_erasure_not_supported'})
 assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,query)),rows,'unsupported erasure changes no metric custody')
 assert.equal((await call('/api/traces/'+traceId,{headers:auth(reader.secret)})).status,200,'unsupported erasure changes no trace custody')
 await seedErasureJournal(preview.batches)
 const journalFence=async()=>{
  for(const refusal of [await remoteRead(call,reader.secret,query),await call('/api/traces/'+traceId,{headers:auth(reader.secret)})]){
   assert.equal(refusal.status,409);assert.deepEqual(await refusal.json(),{error:'standard_read_custody_changed'},'journaled stale copies release no telemetry')
  }
 }
 await journalFence();await compareBackend(journalFence)
 await restartWorker();await journalFence()
 assert.equal((await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:traceWire})).status,409,'journaled trace replay refuses')
 assert.equal((await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:wire})).status,409,'journaled metric replay refuses')
 await standardBudgetProof({...context,...proof})
 console.log('PROBE PORT-061 analytical schema: exact mappings and legacy quotas; analytical erasure refuses unchanged; prior-journal fixture fences both stores and replay; complete row and byte budget refusals')
}

async function standardMappingProof({origin,cookie,call,source,reader,post,restartWorker,sql,compareBackend}) {
 const drain=async()=>{
  let result
  for(let pass=0;pass<20;pass++){
   result=await value(await post(api+'/ingest/drain',{}))
   if(!result.pendingBatches&&result.analytical.complete)break
  }
  assert.equal(result.pendingBatches,0);assert.equal(result.analytical.complete,true)
 }

 const attributes=[['service.name',scope.services[0]],['deployment.environment.name','production'],['team.name','commerce']].map(([key,stringValue])=>({key,value:{stringValue}}))
 const at=1000000000123456n,through=at+1000000n
 const point={timeUnixNano:String(at),attributes:[{key:'privacy.subject',value:{stringValue:'synthetic-porthole-6110'}},{key:'structured',value:{kvlistValue:{values:[{key:'sequence',value:{intValue:'9007199254740993'}},{key:'nested',value:{arrayValue:{values:[{boolValue:false},{bytesValue:'AQID'},{arrayValue:{}},{}]}}},{key:'text',value:{stringValue:'<>&'}}]}}}]}
 const metrics=[
  {name:'synthetic.edge.gauge',unit:'ms',gauge:{dataPoints:[{...point,asDouble:24.5}]}},
  {name:'synthetic.edge.counter',sum:{aggregationTemporality:2,isMonotonic:true,dataPoints:[{...point,asInt:'17'}]}},
  {name:'synthetic.edge.nonmonotonic',sum:{aggregationTemporality:2,isMonotonic:false,dataPoints:[{...point,asInt:'-3'}]}},
  {name:'synthetic.edge.histogram',unit:'s',histogram:{aggregationTemporality:2,dataPoints:[{...point,count:'6',sum:2,explicitBounds:[0.0000001,0.5],bucketCounts:['1','2','3']}]}},
  {name:'synthetic.edge.summary',summary:{dataPoints:[{...point,count:'8',sum:4,quantileValues:[{quantile:0.0000001,value:0.2},{quantile:0.9,value:0.8}]}]}},
 ]
 const wire=JSON.stringify({resourceMetrics:[{resource:{attributes},scopeMetrics:[{scope:{name:'synthetic-porthole-6111'},metrics}]}]})
 await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:wire}))
 await drain()
 const query={from:at/1000000n,through:through/1000000n,matchers:[['__name__','synthetic_edge_.*',2]]}
 const rows=await remoteSeries(await remoteRead(call,reader.secret,query)),byName=name=>rows.filter(s=>s.metric.__name__===name)
 assert.deepEqual(byName('synthetic_edge_gauge_milliseconds')[0].values,[[1000000,24.5]])
 assert.equal(byName('synthetic_edge_gauge_milliseconds')[0].metric.structured,String.raw`{"nested":[false,"AQID",[],null],"sequence":9007199254740993,"text":"\u003c\u003e\u0026"}`,'logical nested attributes retain byte values and exact int64 JSON labels')
 assert.deepEqual(byName('synthetic_edge_counter_total')[0].values,[[1000000,17]])
 assert.deepEqual(byName('synthetic_edge_nonmonotonic')[0].values,[[1000000,-3]])
 assert.deepEqual(byName('synthetic_edge_histogram_seconds_bucket').map(s=>[s.metric.le,s.values[0][1]]).sort(),[['+Inf',6],['0.0000001',1],['0.5',3]].sort())
 assert.deepEqual(byName('synthetic_edge_summary').map(s=>[s.metric.quantile,s.values[0][1]]).sort(),[['0.0000001',0.2],['0.9',0.8]])
 if(compareBackend)await compareBackend(async()=>assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,query)),rows,'both analytical configurations preserve the entire supported OTLP mapping'))
 const atMillis=at/1000000n
 const orderedQueries=async()=>{
  const response=await remoteRead(call,reader.secret,{types:[1,0],queries:[
   {from:atMillis,through:atMillis,matchers:[['__name__','synthetic_edge_.*',2],['__name__','synthetic_edge_(counter_total|nonmonotonic|histogram_seconds_.*|summary.*)',3]]},
   {from:atMillis+1n,through:atMillis+1n,matchers:[['__name__','synthetic_edge_gauge_milliseconds']]},
   {from:atMillis,through:atMillis,matchers:[['__name__','synthetic_edge_summary'],['privacy_subject','synthetic-porthole-[0-9]+',2]]},
  ]})
  assert.equal(response.status,200,await response.clone().text())
  const results=fields(unpack(Buffer.from(await response.arrayBuffer()))).map(([,result])=>fields(result))
  assert.deepEqual(results.map(result=>result.length),[1,0,2],'batched queries retain order and empty results, inclusive millisecond bounds and positive and negative regex matchers')
  const names=result=>result.map(([,series])=>fields(series).filter(([number])=>number===1).map(([,label])=>fields(label)).find(label=>get(label,1).toString()==='__name__')).map(label=>get(label,2).toString())
  assert.deepEqual(names(results[0]),['synthetic_edge_gauge_milliseconds'])
  assert.deepEqual(names(results[2]),['synthetic_edge_summary','synthetic_edge_summary'])
 }
 await orderedQueries()
 if(compareBackend)await compareBackend(orderedQueries)
 for(const label of ['absent','constructor']){
  const missing=await remoteSeries(await remoteRead(call,reader.secret,{...query,matchers:[['__name__','synthetic_edge_gauge_milliseconds'],[label,'',0]]}))
  assert.equal(missing.length,1,'absent label equals empty string, including inherited object names')
 }
 assert.deepEqual(await remoteSeries(await remoteRead(call,reader.secret,{...query,matchers:[['__name__','synthetic_edge_gauge_milliseconds'],['privacy_subject','synthetic-porthole-6110',1]]})),[])
 const staleAt=2000000n,bits=['0000000000000080','020000000000f07f','000000000000f07f'],floatWire=timestamp=>packed(cat(...bits.map((hex,index)=>{
  const labels={__name__:'synthetic_edge_float',service:scope.services[0],environment:'production',team:'commerce',edge:'synthetic-porthole-'+(6112+index)}
  return msg(1,cat(...Object.entries(labels).map(([k,v])=>msg(1,cat(text(1,k),text(2,v)))),msg(2,cat(vint(9),Buffer.from(hex,'hex'),integer(2,timestamp)))))
 })))
 const write=floatWire(staleAt)
 assert.equal((await call('/api/v1/write',{method:'POST',headers:{...auth(source.secret),'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'},body:write})).status,204)
 await drain()
 const read=await remoteRead(call,reader.secret,{from:staleAt,through:staleAt,matchers:[['__name__','synthetic_edge_float']]})
 assert.equal(read.status,200)
 const response=unpack(Buffer.from(await read.arrayBuffer())),actual=fields(get(fields(response),1)).map(([,s])=>get(fields(get(fields(s),2)),1).toString('hex')).sort()
 assert.deepEqual(actual,bits.slice().sort(),'negative zero, stale NaN and infinity round-trip bit-exact')
 // Model the older decoder before indexing: the original wire retains exact
 // bits, while its normalized envelope has no valueBits field. Real indexing
 // and replication must carry that same legacy payload into every copy.
 if(sql){
  const legacyAt=staleAt+1n,legacyWire=floatWire(legacyAt)
  const legacyIntake=await call('/api/v1/write',{method:'POST',headers:{...auth(source.secret),'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'},body:legacyWire})
  assert.equal(legacyIntake.status,204)
  const batch=legacyIntake.headers.get('x-porthole-batch');assert.match(batch,/^[a-f0-9-]{36}$/)
  await sql("UPDATE porthole_ingest_batches SET records=(SELECT json_group_array(json_remove(value,'$.payload.record.valueBits')) FROM json_each(porthole_ingest_batches.records)) WHERE state='pending' AND id="+literal(batch))
  const pending=await sql('SELECT state,records FROM porthole_ingest_batches WHERE id='+literal(batch))
  assert.equal(pending[0].state,'pending');assert.ok(JSON.parse(pending[0].records).every(row=>!Object.hasOwn(row.payload.record,'valueBits')))
  await drain()
  const retained=await value(await call(api+'/ingest/records?'+new URLSearchParams({signal:'metrics',metric:'synthetic_edge_float',from:String(legacyAt*1000000n),through:String(legacyAt*1000000n)}),{headers:auth(reader.secret)}))
  const payloadBytes=retained.records.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row.payload)),0)
  assert.equal(retained.records.length,3)
  const recoveryQuota=await value(await post(credential+'/mint',{name:'Legacy wire scan budget',class:'read',scope,scannedBytesPerDay:payloadBytes+Math.floor(legacyWire.length/2)}),201)
  const refusedRecovery=await remoteRead(call,recoveryQuota.secret,{from:legacyAt,through:legacyAt,matchers:[['__name__','synthetic_edge_float']]})
  assert.equal(refusedRecovery.status,429);assert.deepEqual(await refusedRecovery.json(),{error:'credential_quota_exceeded'},'legacy envelope recovery is metered in addition to retained payload scans')
  const legacy=await remoteRead(call,reader.secret,{from:legacyAt,through:legacyAt,matchers:[['__name__','synthetic_edge_float']]})
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
  await drain()
  const response=await remoteRead(call,reader.secret,{from:3000000n+BigInt(index),through:3000000n+BigInt(index)})
  assert.equal(response.status,422);assert.ok((await response.json()).error.startsWith('unmappable_metric_'))
 }
 const traceId='61000000000000000000000000000001',traceWire=JSON.stringify({resourceSpans:[{resource:{attributes},scopeSpans:[{spans:[{traceId,spanId:'6100000000000001',name:'synthetic-porthole-6119',startTimeUnixNano:String(at),endTimeUnixNano:String(at+100n),attributes:point.attributes}]}]}]})
 await value(await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:traceWire}))
 await drain()
 const maskedTrace=await value(await call('/api/traces/'+traceId,{headers:auth(reader.secret)}))
 const maskedSpan=maskedTrace.batches[0].scopeSpans[0].spans[0]
 assert.deepEqual(maskedSpan.attributes.find(item=>item.key==='structured').value.kvlistValue.values.find(item=>item.key==='sequence').value,{stringValue:'[REDACTED]'},'mandatory scalar masks remain valid OTLP values')
 assert.ok(!JSON.stringify(maskedTrace).includes('9007199254740993'),'trace retrieval never recovers masked source values')
 const maskedBinary=await call('/api/traces/'+traceId,{headers:{...auth(reader.secret),accept:'application/protobuf'}})
 assert.equal(maskedBinary.status,200,await maskedBinary.clone().text())
 const maskedDirectory=await mkdtemp(join(tmpdir(),'porthole-masked-trace-'))
 try{
  const file=join(maskedDirectory,'trace.pb');await writeFile(file,Buffer.from(await maskedBinary.arrayBuffer()))
  const python=process.env.PORTHOLE_EXPORT_PYTHON??resolve('.cache/export-readers/bin/python')
  const decoded=JSON.parse((await execute(python,['tests/porthole/export-otlp-reader.py','--trace',file])).stdout)
  assert.deepEqual(decoded.resourceSpans[0].scopeSpans[0].spans[0].attributes,maskedSpan.attributes,'official generated OTLP reader decodes every retained mask and compound attribute')
 }finally{await rm(maskedDirectory,{recursive:true,force:true})}
 return {attributes,query,rows,wire,traceId,traceWire,drain}
}

async function standardBudgetProof({attributes,call,source,reader,post,drain,compareBackend}) {
 for(let offset=0;offset<2001;offset+=100){
  const budgetWire=JSON.stringify({resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics:[{name:'synthetic.edge.budget',gauge:{dataPoints:Array.from({length:Math.min(100,2001-offset)},(_,index)=>({timeUnixNano:String(4000000000000n+BigInt(offset+index)*1000000n),asInt:String(offset+index)}))}}]}]}]})
  await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:budgetWire}))
 }
 await drain()
 const exhausted=await remoteRead(call,reader.secret,{from:4000000n,through:4002000n})
 assert.equal(exhausted.status,422);assert.deepEqual(await exhausted.json(),{error:'standard_read_budget_exceeded'})
 const largeAt=5000000000000n
 for(let batch=0;batch<6;batch++){
  const payload={resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics:[{name:'synthetic.edge.bytes',gauge:{dataPoints:Array.from({length:10},(_,index)=>({timeUnixNano:String(largeAt+BigInt(batch*10+index)*1000000n),asInt:String(index),attributes:[{key:'synthetic.payload',value:{stringValue:'x'.repeat(20000)}}]}))}}]}]}]}
  await value(await call('/v1/metrics',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:JSON.stringify(payload)}))
 }
 await drain()
 const nativeBytes=await value(await call(api+'/ingest/records?'+new URLSearchParams({signal:'metrics',metric:'synthetic.edge.bytes',limit:'200'}),{headers:auth(reader.secret)}))
 assert.equal(nativeBytes.records.length,60);assert.equal(nativeBytes.cursor,null)
 assert.ok(nativeBytes.records.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row.payload)),0)>1024*1024,'the byte refusal is exercised below the row cap')
 const byteRefusal=await remoteRead(call,reader.secret,{from:largeAt/1000000n,through:largeAt/1000000n+59n})
 assert.equal(byteRefusal.status,422);assert.deepEqual(await byteRefusal.json(),{error:'standard_read_budget_exceeded'})
 const unchanged=await value(await call(api+'/ingest/records?'+new URLSearchParams({signal:'metrics',metric:'synthetic.edge.bytes',limit:'200'}),{headers:auth(reader.secret)}))
 assert.deepEqual(unchanged.records,nativeBytes.records,'a budget refusal changes no retained sample')
 const traceBudgetId='61000000000000000000000000000002'
 for(let offset=0;offset<2001;offset+=100){
  const spans=Array.from({length:Math.min(100,2001-offset)},(_,index)=>({traceId:traceBudgetId,spanId:(offset+index+1).toString(16).padStart(16,'0'),name:'synthetic-porthole-6120',startTimeUnixNano:String(largeAt),endTimeUnixNano:String(largeAt+100n)}))
  await value(await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:JSON.stringify({resourceSpans:[{resource:{attributes},scopeSpans:[{spans}]}]})}))
 }
 await drain()
 const traceExhausted=await call('/api/traces/'+traceBudgetId,{headers:auth(reader.secret)})
 assert.equal(traceExhausted.status,422);assert.deepEqual(await traceExhausted.json(),{error:'standard_read_budget_exceeded'},'oversized traces refuse instead of silently returning the first page')
 const byteTraceId='61000000000000000000000000000003'
 for(let batch=0;batch<6;batch++){
  const spans=Array.from({length:10},(_,index)=>({traceId:byteTraceId,spanId:(batch*10+index+1).toString(16).padStart(16,'0'),name:'synthetic-porthole-6121',startTimeUnixNano:String(largeAt),endTimeUnixNano:String(largeAt+100n),attributes:[{key:'synthetic.payload',value:{stringValue:'x'.repeat(20000)}}]}))
  await value(await call('/v1/traces',{method:'POST',headers:{...auth(source.secret),'content-type':'application/json'},body:JSON.stringify({resourceSpans:[{resource:{attributes},scopeSpans:[{spans}]}]})}))
 }
 await drain()
 const traceByteExhausted=await call('/api/traces/'+byteTraceId,{headers:auth(reader.secret)})
 assert.equal(traceByteExhausted.status,422);assert.deepEqual(await traceByteExhausted.json(),{error:'standard_read_budget_exceeded'},'trace bytes below the row cap still refuse the entire response')
 if(compareBackend)await compareBackend(async()=>{
  assert.equal((await call('/api/traces/'+traceBudgetId,{headers:auth(reader.secret)})).status,422)
  assert.equal((await call('/api/traces/'+byteTraceId,{headers:auth(reader.secret)})).status,422)
  assert.equal((await remoteRead(call,reader.secret,{from:4000000n,through:4002000n})).status,422)
 })
}
