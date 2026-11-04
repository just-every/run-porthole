import assert from 'node:assert/strict'
import {gzipSync} from 'node:zlib'
import {ingestScope} from './ingest.mjs'

export const lokiScope={...ingestScope,services:['synthetic-porthole-18700'],signals:['logs']}
const root='/api/porthole/v1/ingest'
const v=n=>{n=BigInt(n);const b=[];while(n>127n){b.push(Number(n&127n)|128);n>>=7n}return Buffer.from([...b,Number(n)])}
const msg=(n,b)=>Buffer.concat([v(n*8+2),v(b.length),b])
const str=(n,s)=>msg(n,Buffer.from(s))
const uint=(n,x)=>Buffer.concat([v(n*8),v(x)])
const snappy=b=>{let n=b.length-1;const size=[];while(n){size.push(n&255);n>>>=8}return Buffer.concat([v(b.length),Buffer.from(b.length<61?[(b.length-1)*4]:[(59+size.length)*4,...size]),b])}
// Loki v3.5.0 pkg/push/push.proto: PushRequest, StreamAdapter,
// EntryAdapter and LabelPairAdapter. This is a schema edge, never a stock shipper.
export function lokiWire(streams){return snappy(Buffer.concat(streams.map(({stream,values})=>msg(1,Buffer.concat([
 str(1,typeof stream==='string'?stream:'{'+Object.entries(stream).map(([k,value])=>k+'='+JSON.stringify(value)).join(',')+'}'),
 ...values.map(([at,line,metadata={}])=>msg(2,Buffer.concat([
  msg(1,Buffer.concat([uint(1,BigInt(at)/1000000000n),uint(2,BigInt(at)%1000000000n)])),str(2,line),
  ...(Array.isArray(metadata)?metadata:Object.entries(metadata)).map(([key,value])=>msg(3,Buffer.concat([str(1,key),...(value?[str(2,value)]:[])]))),
 ]))),
])))))}
export const streamLabels=extra=>({service:lokiScope.services[0],environment:lokiScope.environments[0],team:lokiScope.teams[0],...extra})
const escapedLabel='\ufeffbell:\x07 vertical:\x0b byte:\x01 emoji:😀 bytes:é quote:" slash:\\'
const quotedLabels=labels=>'{'+Object.entries(labels).map(([key,value])=>key+'='+JSON.stringify(value)).join(',')+String.raw`,escaped="\uFEFFbell:\a vertical:\v byte:\x01 emoji:\U0001F600 bytes:\303\251 quote:\" slash:\\"}`
export async function readLokiPages({origin,cookie,service=lokiScope.services[0],archive=false}){
 const records=[];let cursor,snapshot
 do {
  const params=new URLSearchParams({signal:'logs',service,limit:'137',...(cursor?{cursor,snapshot:String(snapshot)}:{})})
  const response=await fetch(origin+root+(archive?'/archive':'/records')+'?'+params,{headers:{cookie}})
  assert.equal(response.status,200,await response.clone().text())
  const page=await response.json();snapshot??=page.snapshot;assert.equal(page.snapshot,snapshot)
  // Check the public ordering contract across page boundaries as well as
  // within a page, including distinct records sharing an original nanosecond.
  let previous=records.at(-1)
  for(const row of page.records){
   if(previous){
    const before=BigInt(previous.event_time_ns),after=BigInt(row.event_time_ns)
    assert.ok(before<after||before===after&&previous.id<row.id,'native pages retain strict nanosecond and record-ID order')
   }
   previous=row
  }
  if(page.cursor)assert.notEqual(page.cursor,cursor,'native cursor advances even across tied nanoseconds')
  records.push(...page.records);cursor=page.cursor
 }while(cursor)
 return records
}
export const logProjection=row=>({at:String(BigInt(row.event_time_ns)),line:row.payload.record.body.stringValue,labels:row.payload.resource.attributes,metadata:row.payload.record.structuredMetadata})
export async function lokiSchemaJourney({origin,freshOwner,restartWorker}){
 let cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-18701',class:'ingest',scope:lokiScope});assert.equal(minted.status,201)
 const source=await minted.json(),now=BigInt(Date.now())*1000000n,at=now-1000000000n
 const send=(body,headers={})=>fetch(origin+'/loki/api/v1/push',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-scope-orgid':lokiScope.teams[0],...headers},body:Buffer.isBuffer(body)?body:JSON.stringify(body)})
 const entry=(time,line,extra={})=>({streams:[{stream:streamLabels(),values:[[String(time),line,extra]]}]})
 const packets=[entry(at,'synthetic-porthole-18702 日本語 Ελληνικά 😀',{empty:'',detail:'Δ 日本語'}),entry(at,'synthetic-porthole-18703'),entry(at-1n,'synthetic-porthole-18704'),entry(now-7140n*1000000000n,'synthetic-porthole-18705')]
 const wires=[JSON.stringify(packets[0]),gzipSync(JSON.stringify(packets[1])),lokiWire(packets[2].streams),lokiWire(packets[3].streams)]
 const formats=[{}, {'content-encoding':'gzip'}, {'content-type':'application/x-protobuf','content-encoding':'snappy'}, {'content-type':'application/x-protobuf'}]
 packets.push(entry(at+2n,'synthetic-porthole-18714'));packets.at(-1).streams[0].stream.large='x'.repeat(4000)
 wires.push(Buffer.from(JSON.stringify(packets.at(-1))));formats.push({})
 // One equal-nanosecond pair crosses wire encodings and separate envelopes.
 wires[0]=Buffer.from(wires[0]);packets[2].streams[0].values[0][2]={empty:''};wires[2]=lokiWire(packets[2].streams)
 // The official protobuf stream carries a Go quoted label set. These valid
 // byte, octal, short-control and wide Unicode escapes are not JSON escapes.
 const escaped=entry(at+3n,'\ufeffsynthetic-porthole-18716',{detail:'\ufeffquoted label edge'})
 escaped.streams[0].stream.escaped=escapedLabel
 const quoted=quotedLabels(streamLabels())
 packets.push(escaped);wires.push(lokiWire([{stream:quoted,values:escaped.streams[0].values}]));formats.push({'content-type':'application/x-protobuf'})
 for(let i=0;i<wires.length;i++){const r=await send(wires[i],formats[i]);assert.equal(r.status,204,await r.text());assert.equal(r.headers.get('x-porthole-accepted'),'1')}
 await restartWorker();cookie=await freshOwner()
 for(let i=wires.length-1;i>=0;i--){const r=await send(wires[i],formats[i]);assert.equal(r.status,204);assert.equal(r.headers.get('x-porthole-duplicate'),'true')}
 assert.equal((await post(root+'/drain',{})).status,200)
 const before=await readLokiPages({origin,cookie})
 const expected=packets.flatMap(p=>p.streams.flatMap(({stream,values})=>values.map(([at,line,metadata={}])=>({at,line,labels:stream,metadata}))))
 assert.deepEqual(before.map(logProjection).sort((a,b)=>a.line.localeCompare(b.line)),expected.sort((a,b)=>a.line.localeCompare(b.line)))
 const ties=before.filter(row=>BigInt(row.event_time_ns)===at);assert.equal(ties.length,2);assert.deepEqual(ties.map(row=>row.id),ties.map(row=>row.id).sort())
 assert.ok(before.some(row=>row.out_of_order===1),'earlier source batches remain explicitly reordered')
 assert.deepEqual((await readLokiPages({origin,cookie,archive:true})).map(logProjection),before.map(logProjection))
 for(const tenant of ['synthetic-porthole-18799',lokiScope.teams[0]+'|synthetic-porthole-18799',lokiScope.teams[0]+',synthetic-porthole-18799'])assert.equal((await send(entry(at+10n,'synthetic-porthole-18706'),{'x-scope-orgid':tenant})).status,403)
 const readMint=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-18713',class:'read',scope:{...lokiScope,actions:['telemetry.read']}});assert.equal(readMint.status,201)
 const reader=await readMint.json()
 const foreignRead=await fetch(origin+root+'/records?signal=logs&team=synthetic-porthole-18799',{headers:{authorization:'Bearer '+reader.secret,'x-scope-orgid':lokiScope.teams[0]+'|synthetic-porthole-18799'}})
 assert.equal(foreignRead.status,403,'a combined tenant header cannot widen native read scope')
 const old={streams:[{stream:streamLabels(),values:[[String(now-7201n*1000000000n),'synthetic-porthole-18707'],[String(at),'synthetic-porthole-18708']]}]}
 assert.equal((await send(old)).status,400,'whole stale batch refuses both lines')
 assert.equal((await send(entry(BigInt(Date.now())*1000000n+601n*1000000000n,'synthetic-porthole-18709'))).status,400)
 const large=entry(at,'synthetic-porthole-18710');large.streams[0].stream.large='x'.repeat(4097)
 assert.equal((await send(large)).status,400)
 assert.equal((await send(Buffer.from('synthetic-porthole-18711'),{'content-encoding':'gzip'})).status,400)
 assert.equal((await send(Buffer.from([255]),{'content-type':'application/x-protobuf'})).status,400)
 assert.equal((await send(packets[0],{'content-encoding':'snappy'})).status,415)
 for(const escape of [String.raw`\xGG`,String.raw`\uD800`,String.raw`\U00110000`,String.raw`\400`,String.raw`\xff`]){
  const invalidLabels='{'+Object.entries(streamLabels()).map(([key,value])=>key+'='+JSON.stringify(value)).join(',')+',escaped="'+escape+'"}'
  assert.equal((await send(lokiWire([{stream:invalidLabels,values:[[String(at),'synthetic-porthole-18717']]}]),{'content-type':'application/x-protobuf'})).status,400,'malformed Go label escape refuses without persistence')
 }
 const repeated=lokiWire([{stream:streamLabels(),values:[[String(at),'synthetic-porthole-18715',[['detail','first'],['detail','second']]]]}])
 const repeatedReply=await send(repeated,{'content-type':'application/x-protobuf'});assert.equal(repeatedReply.status,400);assert.equal((await repeatedReply.json()).error,'duplicate_loki_metadata')
 assert.equal((await post(root+'/control',{paused:true,maxPendingBytes:1})).status,200)
 const pressure=await send(entry(at+20n,'synthetic-porthole-18712'));assert.equal(pressure.status,429);assert.ok(Number(pressure.headers.get('retry-after'))>0)
 assert.equal((await post(root+'/control',{paused:false,maxPendingBytes:33554432})).status,200)
 assert.deepEqual((await readLokiPages({origin,cookie})).map(row=>row.id),before.map(row=>row.id),'all refused writes change no retained data')
 const status=await (await fetch(origin+root+'/status',{headers:{cookie}})).json(),rows=status.sources.filter(row=>row.sourceId===source.credential.id)
 assert.equal(rows.reduce((n,row)=>n+row.accepted,0),6)
 const reasons=rows.flatMap(row=>row.reasons)
 assert.ok(reasons.some(row=>row.reason==='loki_timestamp_older_than_two_hours'&&row.count===2),JSON.stringify(reasons))
 assert.ok(reasons.some(row=>row.reason==='queue_pressure'&&row.count===1))
 assert.ok(reasons.some(row=>row.reason==='invalid_compressed_body'&&row.unknownBatches===1),'malformed compression is an explicitly unknown line count: '+JSON.stringify(reasons))
 assert.equal((await post('/app/settings/credentials/revoke',{id:source.credential.id})).status,200)
 assert.equal((await send(wires[0],formats[0])).status,401,'next request cannot replay a revoked source')
 assert.deepEqual((await readLokiPages({origin,cookie})).map(row=>row.id),before.map(row=>row.id))
 console.log('PROBE PORT-087 schema: JSON, gzip JSON and Snappy protobuf -> exact Unicode, Go quoted labels, empty metadata, ns ties, delayed input, reordered retries, refusal accounting and next-request revocation')
}

const jsonText=value=>JSON.stringify(value)
export function shipperConfig(kind,{file,state,ports,endpoints}){
 const labels=streamLabels()
 if(kind==='alloy')return `logging { level = "warn" }
local.file_match "logs" {
 path_targets = [{ "__path__" = ${jsonText(file)}, ${Object.entries(labels).map(([k,v])=>jsonText(k)+' = '+jsonText(v)).join(', ')} }]
}
loki.source.file "logs" {
 targets = local.file_match.logs.targets
 forward_to = [loki.process.logs.receiver]
}
loki.process "logs" {
 stage.json { expressions = { ts = "ts", line = "line", lane = "lane", detail = "detail" } }
 stage.timestamp { source = "ts"
 format = "RFC3339Nano" }
 stage.labels { values = { lane = "" } }
 stage.structured_metadata { values = { detail = "" } }
 stage.output { source = "line" }
 forward_to = [loki.write.logs.receiver]
}
loki.write "logs" {
${endpoints.map(url=>` endpoint {
 url = ${jsonText(url+'/loki/api/v1/push')}
 bearer_token = sys.env("PORTHOLE_STOCK_TOKEN")
 tenant_id = ${jsonText(lokiScope.teams[0])}
 batch_size = "32KiB"
 batch_wait = "1s"
 }`).join('\n')}
}
`
 if(kind==='promtail')return `server:
  http_listen_address: 127.0.0.1
  http_listen_port: ${ports.http}
  grpc_listen_port: 0
positions:
  filename: ${state}/positions.yaml
clients:
${endpoints.map(url=>`  - url: ${url}/loki/api/v1/push
    bearer_token: \${PORTHOLE_STOCK_TOKEN}
    tenant_id: ${lokiScope.teams[0]}
    batchsize: 32768
    batchwait: 1s`).join('\n')}
scrape_configs:
  - job_name: local-producer
    static_configs:
      - targets: [localhost]
        labels:
          __path__: ${file}
${Object.entries(labels).map(([k,v])=>'          '+k+': '+v).join('\n')}
    pipeline_stages:
      - json:
          expressions: {ts: ts, line: line, lane: lane, detail: detail}
      - timestamp: {source: ts, format: RFC3339Nano}
      - labels: {lane: null}
      - structured_metadata: {detail: null}
      - output: {source: line}
`
 return `[SERVICE]
    Flush 1
    Log_Level warn
    Parsers_File ${state}/parsers.conf
[INPUT]
    Name tail
    Path ${file}
    Tag local-producer
    Read_from_Head On
    DB ${state}/tail.db
    Parser producer
${endpoints.map(url=>{const target=new URL(url);return `[OUTPUT]
    Name loki
    Match *
    Host ${target.hostname}
    Port ${target.port}
    URI /loki/api/v1/push
    Bearer_Token \${PORTHOLE_STOCK_TOKEN}
    Tenant_ID ${lokiScope.teams[0]}
    Labels ${Object.entries(labels).map(([k,v])=>k+'='+v).join(',')},lane=$lane
    Structured_Metadata detail=$detail
    Remove_Keys ts,lane,detail
    Drop_Single_Key raw
    Line_Format json
    Retry_Limit no_limits
`}).join('\n')}`
}
export async function lokiShipperJourney({origin,freshOwner,restartWorker,withEmptyDestination,configureAnalytical}){
 const fetch=(url,options={})=>globalThis.fetch(url,{...options,signal:AbortSignal.timeout(30000)})
 const {spawn,execFileSync}=await import('node:child_process'),{once}=await import('node:events'),{mkdtemp,writeFile,readFile,mkdir,rm}=await import('node:fs/promises')
 const {createServer}=await import('node:http'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{setTimeout:delay}=await import('node:timers/promises')
 const {createServer:socket}=await import('node:net')
 console.log('LOKI_SCALE_HEAD '+execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())
 const scratch=await mkdtemp(join(tmpdir(),'porthole-loki-')),children=[],captures=[],expected=[],versions={alloy:'1.10.2',promtail:'3.5.0',loki:'3.7.9',fluent:'4.0.0'}
 let cookie=await freshOwner(),bridge
 const port=async()=>{const s=socket();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const run=(binary,args,env={})=>{let output='';const child=spawn(binary,args,{env:{...process.env,GOMAXPROCS:'2',...env},stdio:['pipe','pipe','pipe']});children.push(child);child.stdout.on('data',b=>output=(output+b).slice(-12000));child.stderr.on('data',b=>output=(output+b).slice(-12000));child.on('error',error=>output=error.message);return {child,output:()=>output.replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]')}}
 const stop=async child=>{if(child.pid&&child.exitCode===null){const end=once(child,'exit');child.kill('SIGTERM');if(!await Promise.race([end.then(()=>true),delay(10000).then(()=>false)])){child.kill('SIGKILL');await end}}}
 const until=async(check,message,process,ms=120000)=>{const end=Date.now()+ms;while(Date.now()<end){if(process&&process.child.exitCode!==null)assert.fail(message+': '+process.output());if(await check())return;await delay(200)}assert.fail(message+(process?': '+process.output():''))}
 try {
  for(const key of ['LOKI','ALLOY','PROMTAIL','FLUENT_BIT'])assert.ok(process.env['PORTHOLE_'+key+'_BIN'],'provide verified stock '+key+' binary')
  // Read the supplied executables, rather than reporting the expected pins as
  // observed source versions. A different binary cannot qualify this corpus.
  const actual={}
  for(const [key,flag,pattern]of [['loki','-version',/^loki, version (\S+)/m],['alloy','--version',/^alloy, version v(\S+)/m],['promtail','-version',/^promtail, version (\S+)/m],['fluent','--version',/^Fluent Bit v(\S+)/m]]){
   const binary=process.env['PORTHOLE_'+(key==='fluent'?'FLUENT_BIT':key.toUpperCase())+'_BIN']
   const output=execFileSync(binary,[flag],{encoding:'utf8',timeout:30000})
   actual[key]=pattern.exec(output)?.[1];assert.equal(actual[key],versions[key],'stock '+key+' version must match the declared qualification target')
  }
  console.log('LOKI_SOURCE_VERSIONS '+JSON.stringify(actual))
  const lokiPort=await port(),grpc=await port(),reference='http://127.0.0.1:'+lokiPort
  await mkdir(join(scratch,'loki'))
  const config=`auth_enabled: true
server:
  http_listen_address: 127.0.0.1
  http_listen_port: ${lokiPort}
  grpc_listen_address: 127.0.0.1
  grpc_listen_port: ${grpc}
common:
  instance_addr: 127.0.0.1
  path_prefix: ${scratch}/loki
  replication_factor: 1
  ring:
    kvstore: {store: inmemory}
  storage:
    filesystem:
      chunks_directory: ${scratch}/loki/chunks
      rules_directory: ${scratch}/loki/rules
ingester:
  max_chunk_age: 4h
  wal:
    enabled: true
    dir: ${scratch}/loki/wal
    flush_on_shutdown: true
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index: {prefix: index_, period: 24h}
limits_config:
  discover_service_name: []
  discover_log_levels: false
  allow_structured_metadata: true
  unordered_writes: true
  reject_old_samples_max_age: 2h
  ingestion_rate_mb: 32
  ingestion_burst_size_mb: 64
  max_query_series: 10000
  max_entries_limit_per_query: 10000
  increment_duplicate_timestamp: false
analytics: {reporting_enabled: false}
`
  await writeFile(join(scratch,'loki.yaml'),config)
  const loki=run(process.env.PORTHOLE_LOKI_BIN,['-config.file='+join(scratch,'loki.yaml')])
  await until(()=>fetch(reference+'/ready').then(r=>r.ok).catch(()=>false),'Loki readiness',loki)
  // Independently confirm the escaped-label wire fixture against the stock
  // source parser before comparing its native retained result in the edge run.
  const edgeAt=String(BigInt(Date.now())*1000000n-1000000n),edgeLabels=streamLabels({service:'synthetic-porthole-18720'})
  const edgeLine='\ufeffsynthetic-porthole-18721',edgeMetadata={detail:'\ufeffsource metadata'}
  const edge=await fetch(reference+'/loki/api/v1/push',{method:'POST',headers:{'content-type':'application/x-protobuf','x-scope-orgid':lokiScope.teams[0]},body:lokiWire([{stream:quotedLabels(edgeLabels),values:[[edgeAt,edgeLine,edgeMetadata]]}])})
  assert.equal(edge.status,204,await edge.text())
  const edgeQuery=new URLSearchParams({query:'{service="synthetic-porthole-18720"}',start:edgeAt,end:String(BigInt(edgeAt)+1000000n),direction:'forward'})
  const edgeRead=await fetch(reference+'/loki/api/v1/query_range?'+edgeQuery,{headers:{'x-scope-orgid':lokiScope.teams[0],'X-Loki-Response-Encoding-Flags':'categorize-labels'}});assert.equal(edgeRead.status,200)
  const edgeResult=(await edgeRead.json()).data.result;assert.equal(edgeResult.length,1)
  assert.deepEqual(edgeResult[0].stream,{...edgeLabels,escaped:escapedLabel});assert.equal(edgeResult[0].values.length,1)
  const [sourceAt,sourceLine,sourceMetadata]=edgeResult[0].values[0]
  assert.equal(sourceAt,edgeAt);assert.equal(sourceLine,edgeLine);assert.deepEqual(sourceMetadata.structuredMetadata,edgeMetadata)
  console.log('PROBE PORT-087 source schema: Go quoted protobuf labels -> stock Loki retains exact control bytes, Unicode and nanoseconds')
  const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-18800',class:'ingest',scope:lokiScope,acceptedBytesPerMinute:100*1024*1024,requestsPerMinute:10000});assert.equal(minted.status,201)
  const source=await minted.json()
  assert.equal((await post(root+'/control',{paused:true,maxPendingBytes:128*1024*1024})).status,200)
  let rejectNext=true
  // A destination edge only: preserve every source byte, change no parser or
  // pipeline, and make the stock exporter exercise its configured retry path.
  bridge=createServer((incoming,outgoing)=>{(async()=>{
   const wire=Buffer.concat(await Array.fromAsync(incoming)),headers={...incoming.headers};delete headers.host;delete headers.connection;delete headers['content-length']
   if(rejectNext){rejectNext=false;outgoing.writeHead(429,{'retry-after':'1'});outgoing.end();return}
   const response=await fetch(origin+incoming.url,{method:'POST',headers,body:wire})
   const body=Buffer.from(await response.arrayBuffer())
   if(response.ok)captures.push({wire,headers,path:incoming.url,batch:response.headers.get('x-porthole-batch')})
   outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(body)
  })().catch(error=>{outgoing.writeHead(503);outgoing.end('forwarding_failed')})})
  bridge.listen(0,'127.0.0.1');await once(bridge,'listening');const destination='http://127.0.0.1:'+bridge.address().port
  const base=BigInt(Date.now()-60000)*1000000n
  for(const [number,kind]of ['alloy','promtail','fluent'].entries()){
   rejectNext=true
   const state=join(scratch,kind);await mkdir(state);const file=join(state,'producer.log');await writeFile(file,'')
   const ports={http:await port()},endpoints=[reference,destination]
   const config=shipperConfig(kind,{file,state,ports,endpoints}),path=join(state,kind==='alloy'?'config.alloy':kind==='promtail'?'config.yaml':'config.conf')
   if(process.env.PORTHOLE_EVIDENCE_DIR){
    await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
    for(const [name,url]of [['reference',reference],['porthole',destination]])await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,kind+'-'+name+'.conf'),shipperConfig(kind,{file,state,ports,endpoints:[url]}),{mode:0o600})
   }
   await writeFile(path,config,{mode:0o600})
   if(kind==='fluent')await writeFile(join(state,'parsers.conf'),'[PARSER]\n    Name producer\n    Format json\n    Time_Key ts\n    Time_Format %Y-%m-%dT%H:%M:%S.%LZ\n    Time_Keep On\n')
   const binary=process.env['PORTHOLE_'+(kind==='fluent'?'FLUENT_BIT':kind.toUpperCase())+'_BIN']
   const args=kind==='alloy'?['run','--server.http.listen-addr=127.0.0.1:'+ports.http,'--storage.path='+state+'/state',path]:kind==='promtail'?['-config.expand-env=true','-config.file='+path]:['-c',path]
   const shipper=run(binary,args,{PORTHOLE_STOCK_TOKEN:source.secret})
   await delay(1500)
   const delayed=BigInt(Date.now()-110*60000)*1000000n+BigInt(number)
   const rows=Array.from({length:10000},(_,i)=>{
    const at=i===0?delayed:base+BigInt(number)*100000n+BigInt(Math.floor(i / 8)),mark=i===17?'\ufeff':'',line=mark+`synthetic-porthole-${19000+number}-${String(i).padStart(5,'0')} 日本語 Ελληνικά 😀`,lane='lane'+i%4,detail=mark+'Δ-'+String(i)
    expected.push({at:String(at),line,lane,detail})
    return {ts:new Date(Number(at/1000000n)).toISOString().slice(0,19)+'.'+String(at%1000000000n).padStart(9,'0')+'Z',line,lane,detail}
   })
   // A real separate producer process emits the corpus to the tailed file.
   const producer=run(process.execPath,['--input-type=module','-e',"import{appendFileSync,readFileSync}from'node:fs';const rows=JSON.parse(readFileSync(0,'utf8'));for(let i=0;i<rows.length;i+=64){appendFileSync(process.argv[1],rows.slice(i,i+64).map(x=>JSON.stringify(x)).join('\\n')+'\\n');await new Promise(r=>setTimeout(r,100))}",file])
   producer.child.stdin.end(JSON.stringify([...rows.slice(5000),...rows.slice(0,5000)]))
   await once(producer.child,'exit');assert.equal(producer.child.exitCode,0)
   await until(async()=>{
    const response=await fetch(origin+root+'/status',{headers:{cookie}});assert.equal(response.status,200)
    const state=await response.json();return state.sources.filter(row=>row.sourceId===source.credential.id).reduce((n,row)=>n+row.accepted,0)===(number+1)*10000
   },kind+' emits all 10000 records',shipper,180000)
   await stop(shipper.child)
   const resumed=run(binary,args,{PORTHOLE_STOCK_TOKEN:source.secret});await delay(1200);await stop(resumed.child)
   assert.equal(resumed.child.exitCode,0,kind+' resumes its durable file position')
   console.log('PROBE PORT-087 '+kind+': real file producer -> 10000 stock-emitted lines acknowledged after dual destination shipping')
  }
  await restartWorker();cookie=await freshOwner()
  // Captured batch retries are deliberately replayed in reverse delivery order.
  const unique=[...new Map(captures.map(c=>[c.batch,c])).values()]
  for(const capture of unique.reverse()){
   const retry=await fetch(origin+capture.path,{method:'POST',headers:capture.headers,body:capture.wire})
   assert.equal(retry.status,204);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')
  }
  assert.equal((await post(root+'/control',{paused:false})).status,200)
  await until(async()=>{const r=await post(root+'/drain',{});assert.equal(r.status,200);return (await r.json()).pendingBatches===0},'drain stock corpus',null,240000)
  const native=await readLokiPages({origin,cookie})
  const projected=native.map(logProjection),byLine=new Map(expected.map(row=>[row.line,row]));assert.equal(native.length,30000)
  for(const row of projected){const emitted=byLine.get(row.line);assert.ok(emitted,'native line was emitted');assert.equal(row.at,emitted.at);assert.equal(row.labels.lane,emitted.lane);assert.equal(row.metadata.detail,emitted.detail);assert.equal(Buffer.compare(Buffer.from(row.line),Buffer.from(emitted.line)),0);byLine.delete(row.line)}
  assert.equal(byLine.size,0,'every emitted producer identity is present exactly once')
  assert.ok(native.some(row=>row.out_of_order===1),'stock shippers retain reordered original times')
  assert.equal(native.filter(row=>row.late===1).length,3,'each stock shipper retains its original delayed line')
  // Read each actual Loki stream with an inclusive cursor and remove only the
  // preceding boundary identities; tied nanoseconds may span multiple pages.
  const readReferencePages=async()=>{const referenceRows=[]
  for(let lane=0;lane<4;lane++){
   let start=expected.reduce((minimum,row)=>BigInt(row.at)<minimum?BigInt(row.at):minimum,base)-1n,previous=new Set()
   for(;;){
    const query=new URLSearchParams({query:`{service="${lokiScope.services[0]}",lane="lane${lane}"}`,start:String(start),end:String(base+1000000n),direction:'forward',limit:'137'})
    const response=await fetch(reference+'/loki/api/v1/query_range?'+query,{headers:{'x-scope-orgid':lokiScope.teams[0],'X-Loki-Response-Encoding-Flags':'categorize-labels'}});assert.equal(response.status,200,await response.clone().text())
    const data=await response.json(),page=data.data.result.flatMap(s=>s.values.map(([at,line,metadata={}])=>({at,line,labels:s.stream,metadata:metadata.structuredMetadata??{}}))).sort((a,b)=>BigInt(a.at)<BigInt(b.at)?-1:BigInt(a.at)>BigInt(b.at)?1:a.line.localeCompare(b.line))
    if(!page.length)break
    const fresh=page.filter(row=>!previous.has(row.line));if(!fresh.length&&page.length<137)break;assert.ok(fresh.length,'Loki cursor advances through ties')
    referenceRows.push(...fresh);start=BigInt(page.at(-1).at);previous=new Set(page.filter(row=>BigInt(row.at)===start).map(row=>row.line))
    if(page.length<137)break
   }
  }
   return referenceRows
  }
  const referenceRows=await readReferencePages()
  assert.equal(referenceRows.length,30000)
  const sourceByLine=new Map(referenceRows.map(row=>[row.line,row]))
  for(const row of projected){const ref=sourceByLine.get(row.line);assert.ok(ref);assert.equal(row.at,ref.at);assert.deepEqual(row.labels,ref.labels);assert.deepEqual(row.metadata,ref.metadata)}
  const streamCounts=rows=>{const counts=new Map();for(const row of rows){const key=JSON.stringify(Object.entries(row.labels).sort(([a],[b])=>a.localeCompare(b)));counts.set(key,(counts.get(key)??0)+1)}return [...counts].sort(([a],[b])=>a.localeCompare(b))}
  assert.deepEqual(streamCounts(projected),streamCounts(referenceRows),'per-stream counts agree with actual source storage')
  await stop(loki.child)
  const restartedLoki=run(process.env.PORTHOLE_LOKI_BIN,['-config.file='+join(scratch,'loki.yaml')])
  await until(()=>fetch(reference+'/ready').then(r=>r.ok).catch(()=>false),'Loki restart with real filesystem storage',restartedLoki)
  assert.deepEqual(await readReferencePages(),referenceRows,'all source lines and metadata survive Loki restart')
  console.log('LOKI_STREAM_COUNTS '+JSON.stringify(streamCounts(projected).map(([,count])=>count)))
  console.log('PROBE PORT-087 reconciliation: paginated Loki and native reads -> all 30000 identities, labels, Unicode bytes, metadata and nanoseconds equal')
  const {lokiArchiveJourney}=await import('./archive.mjs')
  await lokiArchiveJourney({origin,cookie,freshOwner,restartWorker,withEmptyDestination,records:native,service:lokiScope.services[0]})
  cookie=await freshOwner()
  if(configureAnalytical)await configureAnalytical(async()=>{
   cookie=await freshOwner()
   let config=await (await fetch(origin+'/api/porthole/v1/analytics/configuration',{headers:{cookie}})).json()
   assert.equal((await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})).status,200)
   await until(async()=>{const r=await post(root+'/drain',{});assert.equal(r.status,200);return (await r.json()).analytical.complete},'replicate real stock corpus',null,240000)
   for(const role of ['primary','standby']){
    config=await (await fetch(origin+'/api/porthole/v1/analytics/configuration',{headers:{cookie}})).json()
    assert.equal((await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role,enabled:true,confirm:'connect-analytical-workers'})).status,200)
    const copy=await readLokiPages({origin,cookie});assert.deepEqual(copy.map(row=>[row.id,logProjection(row)]),native.map(row=>[row.id,logProjection(row)]))
   }
  })
  await lokiBrowser({origin,cookie,service:lokiScope.services[0]})
  assert.equal((await post('/app/settings/credentials/revoke',{id:source.credential.id})).status,200)
  for(const capture of unique){const r=await fetch(origin+capture.path,{method:'POST',headers:capture.headers,body:capture.wire});assert.equal(r.status,401)}
  console.log('PROBE PORT-087 recovery: restart, reverse exact-wire retries and source revocation -> 30000 retained records, no duplicates and every next request refused')
  return {records:30000,versions}
 }finally{
  if(bridge)await new Promise(resolve=>{bridge.close(resolve);bridge.closeAllConnections()})
  for(const child of children)await stop(child)
  await rm(scratch,{recursive:true,force:true})
 }
}
export async function lokiBrowser({origin,cookie,service}){
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox']})
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.addCookies(cookie.split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:origin})))
  const page=await context.newPage()
  for(const path of ['/app/ingest','/app/explore']){
   assert.equal((await page.goto(origin+path)).status(),200)
   if(path.endsWith('explore')){
    await page.getByLabel('Signal',{exact:true}).selectOption('logs');await page.getByLabel('Service',{exact:true}).fill(service)
    await page.getByLabel('Environment',{exact:true}).fill(lokiScope.environments[0]);await page.getByLabel('Team',{exact:true}).fill(lokiScope.teams[0])
    await page.getByRole('button',{name:'Run query',exact:true}).click();await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
    if(width===1440)assert.match(await page.locator('pre').textContent(),/synthetic-porthole-19000/)
   }
   if(width===1440){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()&&!node.title&&!node.getAttribute('aria-label')).length),0)}
   if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'loki-'+path.split('/').at(-1)+'-'+width+'.png'),fullPage:path.endsWith('ingest')})}
  }
  await context.close()
 }}finally{await browser.close()}
}
