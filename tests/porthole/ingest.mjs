import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { literal } from './fixture.mjs'

const root='/api/porthole/v1/ingest'
export const ingestScope={services:['synthetic-porthole-200'],environments:['synthetic-porthole-201'],teams:['synthetic-porthole-202'],signals:['logs','metrics','traces','profiles'],actions:['telemetry.write']}
const text=value=>Buffer.from(value)
const varint=value=>{let n=BigInt(value),bytes=[];while(n>127n){bytes.push(Number(n&127n)|128);n>>=7n}bytes.push(Number(n));return Buffer.from(bytes)}
const concat=(...values)=>Buffer.concat(values)
const message=(number,value)=>concat(varint((number<<3)|2),varint(value.length),value)
const string=(number,value)=>message(number,text(value))
const uint=(number,value)=>concat(varint(number<<3),varint(value))
const fixed=(number,value)=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(value));return concat(varint((number<<3)|1),data)}
const double=(number,value)=>{const data=Buffer.alloc(8);data.writeDoubleLE(value);return concat(varint((number<<3)|1),data)}
const hash=value=>createHash('sha256').update(value).digest('hex')
const traceId=hash('synthetic-porthole-203').slice(0,32),spanId=hash('synthetic-porthole-204').slice(0,16)
const attributes=()=>[
 {key:'service.name',value:{stringValue:ingestScope.services[0]}},
 {key:'deployment.environment.name',value:{stringValue:ingestScope.environments[0]}},
 {key:'team.name',value:{stringValue:ingestScope.teams[0]}},
]
export function otlpLogBatch(times,marker='synthetic-porthole-205') {
 return {resourceLogs:[{resource:{attributes:attributes()},schemaUrl:'https://opentelemetry.io/schemas/1.31.0',scopeLogs:[{scope:{name:'synthetic-porthole-206',version:'1.0.0'},schemaUrl:'https://opentelemetry.io/schemas/1.31.0',logRecords:times.map((time,index)=>({timeUnixNano:String(time),observedTimeUnixNano:String(time),severityNumber:9,body:{stringValue:marker+' '+index},traceId,spanId,attributes:[{key:'synthetic-porthole-207',value:{intValue:String(index)}}]}))}]}]}
}
function snappyLiteral(input){
 const length=input.length-1
 if(length<60)return concat(varint(input.length),Buffer.from([length<<2]),input)
 const bytes=[];let n=length;while(n){bytes.push(n&255);n>>>=8}
 return concat(varint(input.length),Buffer.from([(59+bytes.length)<<2,...bytes]),input)
}
const label=(name,value)=>concat(string(1,name),string(2,value))
export function remoteWriteBatch(time) {
 const labels=[['__name__','synthetic_porthole_208'],['service',ingestScope.services[0]],['environment',ingestScope.environments[0]],['team',ingestScope.teams[0]]]
 const series=concat(...labels.map(pair=>message(1,label(...pair))),message(2,concat(double(1,12.5),uint(2,time))),message(2,concat(double(1,13.5),uint(2,time+1))))
 return snappyLiteral(message(1,series))
}
export function otlpProtoBatch(signal,time) {
 const resource=concat(...attributes().map(entry=>message(1,concat(string(1,entry.key),message(2,string(1,entry.value.stringValue))))))
 let record
 if(signal==='logs')record=concat(fixed(1,time),uint(2,9),message(5,string(1,'synthetic-porthole-209')),message(9,Buffer.from(traceId,'hex')),message(10,Buffer.from(spanId,'hex')))
 else if(signal==='traces')record=concat(message(1,Buffer.from(traceId,'hex')),message(2,Buffer.from(spanId,'hex')),string(5,'synthetic-porthole-210'),uint(6,2),fixed(7,time),fixed(8,time+12345n),message(15,uint(3,2)))
 else record=concat(string(1,'synthetic_porthole_211'),string(3,'ms'),message(5,message(1,concat(fixed(3,time),double(4,24.5)))))
 const scope=concat(message(1,string(1,'synthetic-porthole-212')),message(2,record),string(3,'https://opentelemetry.io/schemas/1.31.0'))
 return message(1,concat(message(1,resource),message(2,scope)))
}
export function lokiProtoBatch(time) {
 const labels=`{service="${ingestScope.services[0]}",environment="${ingestScope.environments[0]}",team="${ingestScope.teams[0]}"}`
 const timestamp=concat(uint(1,time/1000000000n),uint(2,time%1000000000n))
 const entry=concat(message(1,timestamp),string(2,'synthetic-porthole-213 Ελληνικά'),message(3,label('synthetic_porthole_214','synthetic-porthole-215')))
 return snappyLiteral(message(1,concat(string(1,labels),message(2,entry))))
}
/** Official-schema synthetic wire captures, sent over the real public routes.
 * This journey does not stand in for the six-language/stock Collector estate. */
export async function ingestJourney({origin,cookie,sql,restartWorker,freshOwner,mutate}) {
 cookie=await freshOwner()
 const change=mutate??(statement=>restartWorker(()=>sql(statement)))
 const post=(path,data,actingCookie=cookie)=>fetch(origin+path,{method:'POST',headers:{origin,cookie:actingCookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const mint=async(extra={})=>{
  cookie=await freshOwner()
  const response=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-216',class:'ingest',scope:ingestScope,...extra})
  assert.equal(response.status,201,'real native mint');return response.json()
 }
 const source=await mint()
 const send=(path,body,id,options={})=>fetch(origin+path,{method:'POST',headers:{authorization:`Bearer ${source.secret}`,'content-type':'application/json',...(id?{'x-porthole-batch-id':id}:{}),...options.headers},body:Buffer.isBuffer(body)?body:JSON.stringify(body)})
 const status=async()=>{const response=await fetch(origin+root+'/status',{headers:{cookie}});assert.equal(response.status,200);return response.json()}
 const sourceStatus=async id=>(await status()).sources.filter(row=>row.sourceId===(id??source.credential.id))
 const read=async(signal='logs',extra='',archive=false)=>{
  const response=await fetch(origin+root+(archive?'/archive':'/records')+'?signal='+signal+extra,{headers:{cookie}})
  assert.equal(response.status,200);return response.json()
 }
 const pause=async(paused,extra={})=>assert.equal((await post(root+'/control',{paused,...extra})).status,200)
 const drain=async()=>{const response=await post(root+'/drain',{});assert.equal(response.status,200);return response.json()}
 const sum=(rows,key)=>rows.reduce((n,row)=>n+Number(row[key]??0),0)
 const now=BigInt(Date.now())*1000000n,time=now-1000000000n
 for(const path of ['/v1/logs',root+'/status',root+'/records?signal=logs',root+'/control',root+'/drain']){
  const response=await fetch(origin+path,{method:path.endsWith('/logs')||path.endsWith('/control')||path.endsWith('/drain')?'POST':'GET',headers:{origin,'content-type':'application/json'},body:path.endsWith('/logs')||path.endsWith('/control')||path.endsWith('/drain')?'{}':undefined})
  assert.equal(response.status,401,'no anonymous ingest or control')
 }
 // Intake refuses a body without a credential before decoding it, and
 // decodes a source's export of many repeated messages promptly.
 const emptyResources=Buffer.alloc(512*1024,Buffer.from([10,0])),protobuf=(headers={})=>({method:'POST',headers:{'content-type':'application/x-protobuf',...headers},body:emptyResources,signal:AbortSignal.timeout(10000)})
 assert.equal((await fetch(origin+'/v1/logs',protobuf())).status,401,'anonymous intake is refused before its body is decoded')
 const emptyExport=await fetch(origin+'/v1/logs',protobuf({authorization:`Bearer ${source.secret}`,'x-porthole-batch-id':'synthetic-porthole-1700'}))
 assert.equal(emptyExport.status,200,'a source export of many empty resources decodes promptly');assert.equal(emptyExport.headers.get('x-porthole-accepted'),'0')
 await pause(true)
 const first=otlpLogBatch([time,time+1n,time+1n])
 const accepted=await send('/v1/logs',first,'synthetic-porthole-217')
 assert.equal(accepted.status,200);assert.equal(accepted.headers.get('x-porthole-accepted'),'3');assert.equal(accepted.headers.get('x-porthole-duplicate'),'false')
 assert.deepEqual(await accepted.json(),{},'stock OTLP response')
 const batchId=accepted.headers.get('x-porthole-batch')
 assert.equal((await sql(`SELECT record_count FROM porthole_ingest_batches WHERE id=${literal(batchId)}`))[0].record_count,3,'ack follows durable envelope')
 assert.equal(sum(await sourceStatus(),'pending'),3)
 await restartWorker()
 assert.equal(sum(await sourceStatus(),'accepted'),3,'acknowledged input survives restart')
 const retry=await send('/v1/logs',first,'synthetic-porthole-217')
 assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-batch'),batchId);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')
 assert.equal((await send('/v1/logs',otlpLogBatch([time],'synthetic-porthole-218'),'synthetic-porthole-217')).status,409,'identity reuse cannot change acknowledged bytes')
 await pause(false)
 await drain()
 let rows=await read()
 const original=rows.records.filter(row=>row.source_id===source.credential.id)
 assert.equal(original.length,3);assert.deepEqual(original.map(row=>row.event_time_ns),[time,time+1n,time+1n].map(value=>String(value).padStart(20,'0')))
 assert.ok(original.every(row=>row.trace_id===traceId&&row.span_id===spanId))
 assert.equal((await read('logs','',true)).records.filter(row=>row.source_id===source.credential.id).length,3)
 const frozen=rows.snapshot
 assert.equal((await send('/v1/logs',otlpLogBatch([time-1n]),'synthetic-porthole-219')).status,200)
 await drain()
 assert.equal((await read('logs','&snapshot='+frozen)).records.filter(row=>row.source_id===source.credential.id).length,3,'snapshot cannot admit later indexed records')
 rows=await read()
 assert.equal(rows.records.filter(row=>row.source_id===source.credential.id).length,4)
 assert.ok(rows.records.some(row=>row.source_id===source.credential.id&&row.out_of_order===1),'reordering retained explicitly')
 const binaryHeaders={'content-type':'application/x-protobuf'}
 for(const signal of ['logs','traces','metrics']){
  const response=await send('/v1/'+signal,otlpProtoBatch(signal,time+10n),'synthetic-porthole-220-'+signal,{headers:binaryHeaders})
  assert.equal(response.status,200,signal+' protobuf intake');assert.equal((await response.arrayBuffer()).byteLength,0)
 }
 assert.equal((await send('/api/v1/write',remoteWriteBatch(Number(time/1000000n)),'synthetic-porthole-221',{headers:{...binaryHeaders,'content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'}})).status,204)
 assert.equal((await send('/loki/api/v1/push',lokiProtoBatch(time+20n),'synthetic-porthole-222',{headers:{...binaryHeaders,'content-encoding':'snappy'}})).status,204)
 const loki={streams:[{stream:{service:ingestScope.services[0],environment:ingestScope.environments[0],team:ingestScope.teams[0]},values:[[String(time+21n),'synthetic-porthole-223 日本語',{synthetic_porthole_224:'synthetic-porthole-225'}]]}]}
 assert.equal((await send('/loki/api/v1/push',gzipSync(JSON.stringify(loki)),'synthetic-porthole-226',{headers:{'content-encoding':'gzip'}})).status,204)
 await drain()
 assert.equal((await read('metrics')).records.filter(row=>row.source_id===source.credential.id).length,3)
 const readCredential=await mint({class:'read',scope:{...ingestScope,actions:['telemetry.read']}})
 const scopedRead=await fetch(origin+root+'/records?signal=logs',{headers:{authorization:`Bearer ${readCredential.secret}`}})
 assert.equal(scopedRead.status,200,'read credential uses its own scoped door')
 assert.ok((await scopedRead.json()).records.every(row=>row.service===ingestScope.services[0]&&row.environment===ingestScope.environments[0]&&row.team===ingestScope.teams[0]))
 assert.equal((await fetch(origin+root+'/records?signal=logs&service=synthetic-porthole-249',{headers:{authorization:`Bearer ${readCredential.secret}`}})).status,403)
 const trace=(await read('traces')).records.find(row=>row.source_id===source.credential.id)
 assert.equal(trace.payload.record.endTimeUnixNano,String(time+10n+12345n));assert.equal(trace.payload.record.status.code,2)
 const logRows=(await read()).records.filter(row=>row.source_id===source.credential.id)
 assert.equal(logRows.length,7);assert.ok(logRows.some(row=>row.payload.record.structuredMetadata?.synthetic_porthole_214==='synthetic-porthole-215'))
 const wrong={...first,resourceLogs:[{...first.resourceLogs[0],resource:{attributes:attributes().map(entry=>entry.key==='service.name'?{...entry,value:{stringValue:'synthetic-porthole-227'}}:entry)}}]}
 assert.equal((await send('/v1/logs',wrong,'synthetic-porthole-228')).status,403)
 assert.equal((await send('/v1/logs',first,'synthetic-porthole-229',{headers:{'x-scope-orgid':'synthetic-porthole-230'}})).status,403)
 assert.equal((await send('/v1/logs',Buffer.from('{'),'synthetic-porthole-231')).status,400)
 assert.equal((await send('/v1/logs',Buffer.from('synthetic-porthole-232'),'synthetic-porthole-233',{headers:{'content-encoding':'gzip'}})).status,400)
 const expansion=otlpLogBatch(Array.from({length:100},(_,index)=>time+BigInt(index)))
 expansion.resourceLogs[0].resource.attributes.push({key:'synthetic-porthole-306',value:{stringValue:'x'.repeat(16000)}})
 assert.equal((await send('/v1/logs',expansion,'synthetic-porthole-307')).status,413,'resource expansion refuses before durable acknowledgement')
 assert.equal((await sql("SELECT COUNT(*) AS count FROM porthole_ingest_batches WHERE identity='synthetic-porthole-307'"))[0].count,0)
 const old=structuredClone(loki);old.streams[0].values[0][0]=String(now-7201n*1000000000n)
 assert.equal((await send('/loki/api/v1/push',old,'synthetic-porthole-234')).status,400)
 const {intakeInterruptJourney}=await import('./intake-interrupt.mjs')
 await intakeInterruptJourney({origin,secret:source.secret,packet:otlpLogBatch([time+50n]),restartWorker,sql,send})
 await pause(true,{maxPendingBytes:1})
 const pressure=await send('/v1/logs',otlpLogBatch([time+30n]),'synthetic-porthole-235')
 assert.equal(pressure.status,429);assert.ok(Number(pressure.headers.get('retry-after'))>0)
 await pause(false,{maxPendingBytes:33554432})
 // A real SQLite failure before queue insertion must roll quota + accepted
 // accounting back. The same identity can safely be retried after repair.
 await change("CREATE TRIGGER synthetic_porthole_fail_accept BEFORE INSERT ON porthole_ingest_batches BEGIN SELECT RAISE(ABORT,'synthetic-porthole-236'); END;")
 try {assert.equal((await send('/v1/logs',otlpLogBatch([time+31n]),'synthetic-porthole-237')).status,503)}
 finally {await change('DROP TRIGGER synthetic_porthole_fail_accept;')}
 assert.equal((await sql("SELECT COUNT(*) AS count FROM porthole_ingest_batches WHERE identity='synthetic-porthole-237'"))[0].count,0)
 assert.equal((await send('/v1/logs',otlpLogBatch([time+31n]),'synthetic-porthole-237')).status,200)
 await change("CREATE TRIGGER synthetic_porthole_fail_archive BEFORE INSERT ON porthole_telemetry_archive BEGIN SELECT RAISE(ABORT,'synthetic-porthole-238'); END;")
 try {
  assert.equal((await post(root+'/drain',{})).status,503)
  assert.equal((await sql("SELECT COUNT(*) AS count FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE b.identity='synthetic-porthole-237'"))[0].count,0,'failed processing never leaves a partial index')
 }finally{await change('DROP TRIGGER synthetic_porthole_fail_archive;')}
 await restartWorker();await drain()
 assert.equal((await sql("SELECT state FROM porthole_ingest_batches WHERE identity='synthetic-porthole-237'"))[0].state,'complete')
 const quota=await mint({requestsPerMinute:1})
 const quotaHeaders={authorization:`Bearer ${quota.secret}`}
 assert.equal((await send('/v1/logs',otlpLogBatch([time+40n]),'synthetic-porthole-239',{headers:quotaHeaders})).status,200)
 const exhausted=await send('/v1/logs',otlpLogBatch([time+41n,time+42n]),'synthetic-porthole-240',{headers:quotaHeaders})
 assert.equal(exhausted.status,429);assert.ok(Number(exhausted.headers.get('retry-after'))>0)
 const quotaRows=await sourceStatus(quota.credential.id)
 assert.equal(sum(quotaRows,'accepted'),1);assert.equal(sum(quotaRows,'rejected'),2,'quota denial counts exact refused source records')
 await drain()
 const totals=await sourceStatus()
 assert.equal(sum(totals,'accepted'),sum(totals,'queryable')+sum(totals,'pending'))
 assert.equal(sum(totals,'archived'),sum(totals,'queryable'))
 assert.equal(sum(totals,'intentionallySampled'),0)
 assert.ok(totals.some(row=>row.reasons.some(reason=>reason.reason==='queue_pressure')))
 const loss=await post(root+'/loss',{sourceId:source.credential.id,signal:'logs',service:ingestScope.services[0],environment:ingestScope.environments[0],team:ingestScope.teams[0],kind:'source_loss',count:2,from:String(time),through:String(time+1n)})
 assert.equal(loss.status,201)
 assert.ok((await sourceStatus()).filter(row=>row.signal==='logs').every(row=>row.evaluation==='Unknown'&&!row.complete))
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 assert.equal((await send('/v1/logs',first,'synthetic-porthole-241')).status,401,'next request sees revocation')
 assert.equal((await fetch(origin+root+'/records?signal=logs',{headers:{authorization:`Bearer ${quota.secret}`}})).status,403,'ingest credential cannot read')
 console.log('Porthole ingest journey passed: durable protocol intake, scoped auth, exact delivery/archive accounting, retry identity, original ns/reorder, quota/pressure refusals, storage/queue failure and restart recovery')
 return {cookie,sourceId:source.credential.id,scope:ingestScope,traceId,spanId}
}

export async function ingestBrowserJourney({origin,cookie,profile}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:origin})))
   const page=await context.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   const response=await page.goto(origin+'/app/ingest');assert.equal(response.status(),200)
   await page.getByRole('heading',{name:'Telemetry delivery',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'delivery status reflows')
   if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`ingest-${width}.png`),fullPage:true})}
   // The touched documents contain text controls, including their navigation.
   assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).length),0,'no icon-only control lacks a tooltip')
   if(profile) {
    await page.goto(origin+'/app/explore')
    await page.getByLabel('Signal',{exact:true}).selectOption('profiles')
    for(const [label,key]of [['Service','services'],['Environment','environments'],['Team','teams']])await page.getByLabel(label,{exact:true}).fill(profile.scope[key][0])
    await page.getByRole('button',{name:'Run query',exact:true}).focus()
    assert.equal(await page.getByRole('button',{name:'Run query',exact:true}).evaluate(node=>node===document.activeElement),true)
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`profile-explore-${width}.png`),fullPage:true})
    await page.getByRole('button',{name:'Run query',exact:true}).click()
    await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
    assert.match(await page.locator('pre').textContent(),/synthetic-porthole-1601/)
    assert.match(await page.locator('pre').textContent(),/timestampsUnixNano/)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'profile results reflow')
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`profile-results-${width}.png`),fullPage:true})
    await page.goto(origin+'/app/explore')
    await page.getByLabel('Signal',{exact:true}).selectOption('profiles')
    for(const label of ['Service','Environment','Team'])await page.getByLabel(label,{exact:true}).fill('synthetic-porthole-1699')
    await page.getByRole('button',{name:'Run query',exact:true}).click()
    await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
    assert.match(await page.locator('pre').textContent(),/"records": \[\]/)
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`profile-empty-${width}.png`),fullPage:true})
    await page.goto(origin+'/app/explore')
    await page.getByLabel('Signal',{exact:true}).evaluate(node=>{const option=document.createElement('option');option.value='synthetic-porthole-1699';option.text='synthetic-porthole-1699';node.add(option);node.value=option.value})
    for(const [label,key]of [['Service','services'],['Environment','environments'],['Team','teams']])await page.getByLabel(label,{exact:true}).fill(profile.scope[key][0])
    await page.getByRole('button',{name:'Run query',exact:true}).click()
    await page.getByRole('heading',{name:'Query unavailable',exact:true}).waitFor()
    await page.getByRole('alert').waitFor()
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`profile-invalid-${width}.png`),fullPage:true})
   }
   assert.deepEqual(errors,[]);await context.close()
  }
 }finally{await browser.close()}
}

/** v1.9.0 official-schema profile capture. Schema edge only: this fixture is
 * never represented as a stock profiler, a six-language estate or capacity. */
export function profileBatch(time) {
 const dictionary={mappingTable:[{}, {memoryStart:'100',memoryLimit:'200',filenameStrindex:3}],locationTable:[{}, {mappingIndex:1,address:'120',lines:[{functionIndex:1,line:'12'}]}],functionTable:[{}, {nameStrindex:3}],linkTable:[{}, {traceId,spanId}],stringTable:['','cpu','nanoseconds','synthetic-porthole-1600'],attributeTable:[{}, {keyStrindex:3,value:{stringValue:'synthetic-porthole-1601'}}],stackTable:[{}, {locationIndices:[1]}]}
 const profile={sampleType:{typeStrindex:1,unitStrindex:2},samples:[{stackIndex:1,values:['20','30'],attributeIndices:[1],linkIndex:1,timestampsUnixNano:[String(time+1n),String(time+2n)]}],timeUnixNano:String(time),durationNano:'1000',period:'10',profileId:hash('synthetic-porthole-1602').slice(0,32)}
 return {dictionary,resourceProfiles:[{resource:{attributes:attributes()},schemaUrl:'https://opentelemetry.io/schemas/1.31.0',scopeProfiles:[{scope:{name:'synthetic-porthole-1603',version:'1.0.0'},profiles:[profile]}]}]}
}
export function profileProtoBatch(time) {
 const empty=Buffer.alloc(0),resource=concat(...attributes().map(entry=>message(1,concat(string(1,entry.key),message(2,string(1,entry.value.stringValue))))))
 const dictionary=concat(message(1,empty),message(1,concat(uint(1,100),uint(2,200),uint(4,3))),message(2,empty),message(2,concat(uint(1,1),uint(2,120),message(3,concat(uint(1,1),uint(2,12))))),message(3,empty),message(3,uint(1,3)),message(4,empty),message(4,concat(message(1,Buffer.from(traceId,'hex')),message(2,Buffer.from(spanId,'hex')))),...['','cpu','nanoseconds','synthetic-porthole-1600'].map(value=>string(5,value)),message(6,empty),message(6,concat(uint(1,3),message(2,string(1,'synthetic-porthole-1601')))),message(7,empty),message(7,message(1,varint(1))))
 const packedTimes=concat(...[time+1n,time+2n].map(value=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes}))
 const sample=concat(uint(1,1),message(2,concat(varint(20),varint(30))),message(3,varint(1)),uint(4,1),message(5,packedTimes))
 const profile=concat(message(1,concat(uint(1,1),uint(2,2))),message(2,sample),fixed(3,time),uint(4,1000),uint(6,10),message(7,Buffer.from(hash('synthetic-porthole-1602').slice(0,32),'hex')))
 return concat(message(1,concat(message(1,resource),message(2,concat(message(1,concat(string(1,'synthetic-porthole-1603'),string(2,'1.0.0'))),message(2,profile))),string(3,'https://opentelemetry.io/schemas/1.31.0'))),message(2,dictionary))
}
export async function otlpProtocolJourney({origin,cookie,sql,restartWorker,freshOwner,withEmptyDestination}) {
 const grpc=(await import('@grpc/grpc-js')).default
 const {receiver}=await import('../../scripts/porthole/otlp-grpc.mjs')
 const paths={traces:'/opentelemetry.proto.collector.trace.v1.TraceService/Export',metrics:'/opentelemetry.proto.collector.metrics.v1.MetricsService/Export',logs:'/opentelemetry.proto.collector.logs.v1.LogsService/Export',profiles:'/opentelemetry.proto.collector.profiles.v1development.ProfilesService/Export'}
 cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const mint=async(signal=ingestScope.signals,kind='ingest',scope=ingestScope)=>{
  cookie=await freshOwner()
  const response=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1604',class:kind,scope:{...scope,signals:signal,actions:[kind==='ingest'?'telemetry.write':'telemetry.read']}})
  assert.equal(response.status,201);return response.json()
 }
 const source=await mint(),readSource=await mint(['profiles'],'read'),time=BigInt(Date.now())*1000000n+123n
 const send=(signal,body,extra={})=>fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:`Bearer ${source.secret}`,'content-type':'application/x-protobuf',...extra},body})
 const value=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
 const query=()=>fetch(origin+root+'/records?signal=profiles',{headers:{authorization:`Bearer ${readSource.secret}`}}).then(value)
 await assert.rejects(()=>receiver({upstream:'https://synthetic-porthole.invalid/path'}),/origin/)
 await assert.rejects(()=>receiver({upstream:origin,listen:'0.0.0.0:4317'}),/TLS/)
 const running=await receiver({upstream:origin,listen:'127.0.0.1:0'}),clients=[]
 const rpc=(signal,wire,{secret=source.secret,headers={},compression=grpc.compressionAlgorithms.identity}={})=>new Promise((resolve,reject)=>{
  const Client=grpc.makeGenericClientConstructor({Export:{path:paths[signal],requestStream:false,responseStream:false,requestSerialize:Buffer.from,requestDeserialize:Buffer.from,responseSerialize:Buffer.from,responseDeserialize:Buffer.from}},signal),client=new Client('127.0.0.1:'+running.port,grpc.credentials.createInsecure(),{'grpc.default_compression_algorithm':compression});clients.push(client)
  const metadata=new grpc.Metadata();if(secret)metadata.set('authorization','Bearer '+secret)
  for(const [name,value]of Object.entries(headers))metadata.set(name,value)
  let receipt
  const call=client.Export(wire,metadata,{deadline:Date.now()+10000},(error,body)=>error?reject(error):resolve({body,receipt}))
  call.on('metadata',metadata=>{receipt=metadata.getMap()})
 })
 try {
  await post(root+'/control',{paused:true})
  const binary=profileProtoBatch(time)
  const http=await send('profiles',gzipSync(binary),{'content-encoding':'gzip'})
  assert.equal(http.status,200);assert.equal(http.headers.get('x-porthole-accepted'),'1')
  // Exact raw retry and gRPC gzip are both handled by the real protocol stacks.
  const repeated=await rpc('profiles',binary,{compression:grpc.compressionAlgorithms.gzip})
  assert.equal(repeated.body.length,0)
  assert.equal(repeated.receipt['x-porthole-accepted'],'1')
  assert.equal((await send('profiles',binary)).status,200)
  // Different compression bytes are different source envelopes by default;
  // a retry must keep the same encoding with an explicit batch identity.
  await rpc('profiles',binary,{headers:{'x-porthole-batch-id':'synthetic-porthole-1605'}})
  const retry=await send('profiles',gzipSync(binary),{'content-encoding':'gzip','x-porthole-batch-id':'synthetic-porthole-1605'})
  assert.equal(retry.status,409,'changed source bytes under an explicit identity refuse')
  assert.equal((await rpc('profiles',binary,{headers:{'x-porthole-batch-id':'synthetic-porthole-1605'}})).receipt['x-porthole-duplicate'],'true')
  for(const signal of ['traces','metrics','logs']) {
   const result=await rpc(signal,otlpProtoBatch(signal,time))
   assert.equal(result.body.length,0);assert.equal(result.receipt['x-porthole-accepted'],'1')
  }
  const isolated=profileBatch(time+10000n);isolated.dictionary.stringTable.push('synthetic-porthole-1608');isolated.dictionary.linkTable.push({traceId:'a'.repeat(32),spanId:'b'.repeat(16)})
  const json=await send('profiles',Buffer.from(JSON.stringify(isolated)),{'content-type':'application/json'})
  assert.equal(json.status,200)
  const badIndex=profileBatch(time);badIndex.resourceProfiles[0].scopeProfiles[0].profiles[0].samples[0].stackIndex=999
  assert.equal((await send('profiles',Buffer.from(JSON.stringify(badIndex)),{'content-type':'application/json'})).status,400)
  const badTime=profileBatch(time);badTime.resourceProfiles[0].scopeProfiles[0].profiles[0].samples[0].timestampsUnixNano=[String(time-1n),String(time+1n)]
  assert.equal((await send('profiles',Buffer.from(JSON.stringify(badTime)),{'content-type':'application/json'})).status,400)
  for(const [wire,options,status]of [[Buffer.from([255]),{},grpc.status.INVALID_ARGUMENT],[binary,{secret:''},grpc.status.UNAUTHENTICATED],[binary,{secret:'synthetic-porthole-1606'},grpc.status.UNAUTHENTICATED],[Buffer.alloc(1024*1024+1),{},grpc.status.RESOURCE_EXHAUSTED]])await assert.rejects(()=>rpc('profiles',wire,options),error=>error.code===status)
  const narrow=await mint(['logs'])
  await assert.rejects(()=>rpc('profiles',binary,{secret:narrow.secret}),error=>error.code===grpc.status.PERMISSION_DENIED)
  const foreign=profileBatch(time);foreign.resourceProfiles[0].resource.attributes[2].value.stringValue='synthetic-porthole-1607'
  assert.equal((await send('profiles',Buffer.from(JSON.stringify(foreign)),{'content-type':'application/json'})).status,403)
  await restartWorker();cookie=await freshOwner()
  await post(root+'/control',{paused:false});assert.equal((await post(root+'/drain',{})).status,200)
  const result=await query(),records=result.records.filter(row=>row.source_id===source.credential.id)
  assert.equal(records.length,4,'four distinct acknowledged source envelopes remain after retry and restart')
  for(const row of records) {
   assert.deepEqual(row.payload.dictionary,profileBatch(time).dictionary)
   assert.ok(!JSON.stringify(row.payload).includes('synthetic-porthole-1608'),'unreferenced shared dictionary contents are not exposed')
   assert.equal(row.payload.record.samples[0].values.reduce((n,value)=>n+BigInt(value),0n),50n)
   assert.equal(row.payload.record.samples[0].timestampsUnixNano[0],String(BigInt(row.event_time_ns)+1n))
   assert.equal(row.payload.resourceSchemaUrl,'https://opentelemetry.io/schemas/1.31.0')
   assert.equal(row.payload.record.profileId,hash('synthetic-porthole-1602').slice(0,32))
  }
  assert.equal((await fetch(origin+root+'/records?signal=logs',{headers:{authorization:`Bearer ${readSource.secret}`}})).status,403)
  const status=await value(await fetch(origin+root+'/status',{headers:{cookie}})),totals=status.sources.filter(row=>row.sourceId===source.credential.id&&row.signal==='profiles')
  assert.equal(totals.reduce((n,row)=>n+row.accepted,0),4);assert.equal(totals.reduce((n,row)=>n+row.queryable,0),4);assert.equal(totals.reduce((n,row)=>n+row.archived,0),4)
  const profile=records.find(row=>row.event_time_ns===String(time+10000n).padStart(20,'0'))
  const broad=await mint(['profiles'],'ingest',{...ingestScope,teams:[...ingestScope.teams,'synthetic-porthole-1611']})
  const mixed=profileBatch(time+20000n)
  mixed.dictionary.stringTable.push('synthetic-porthole-1610')
  mixed.dictionary.functionTable.push({nameStrindex:4})
  mixed.dictionary.locationTable.push({lines:[{functionIndex:2}]})
  mixed.dictionary.stackTable.push({locationIndices:[2]})
  mixed.dictionary.linkTable.push({traceId:'a'.repeat(32),spanId:'b'.repeat(16)})
  const second=structuredClone(mixed.resourceProfiles[0]);second.resource.attributes[2].value.stringValue='synthetic-porthole-1611';second.scopeProfiles[0].profiles[0].samples[0].stackIndex=2;second.scopeProfiles[0].profiles[0].samples[0].linkIndex=2
  mixed.resourceProfiles.push(second)
  const shared=await send('profiles',Buffer.from(JSON.stringify(mixed)),{'content-type':'application/json',authorization:`Bearer ${broad.secret}`});assert.equal(shared.status,200)
  assert.equal((await post(root+'/drain',{})).status,200)
  const narrowed=(await query()).records.filter(row=>row.source_id===broad.credential.id)
  assert.equal(narrowed.length,1,'read credential sees only its team in a multi-resource export')
  assert.ok(!JSON.stringify(narrowed).includes('synthetic-porthole-1610')&&!JSON.stringify(narrowed).includes('a'.repeat(32)),'other team shared dictionary strings and trace links are excluded')
  assert.equal((await fetch(origin+root+'/records?signal=profiles&team=synthetic-porthole-1611',{headers:{authorization:`Bearer ${readSource.secret}`}})).status,403)
  const rawEnvelope=(await sql(`SELECT wire_base64 FROM porthole_ingest_batches WHERE source_id=${literal(broad.credential.id)}`))[0]
  assert.ok(Buffer.from(rawEnvelope.wire_base64,'base64').toString().includes('synthetic-porthole-1610'),'owner-only original envelope keeps exact source bytes')
  await restartWorker(async()=>{await assert.rejects(()=>rpc('profiles',binary),error=>error.code===grpc.status.UNAVAILABLE)})
  cookie=await freshOwner()
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
  for(const transport of ['grpc','http/protobuf']) {
   const emitted=await promisify(execFile)(process.execPath,['tests/porthole/polyglot/otlp.cjs'],{env:{...process.env,PORTHOLE_OTLP_PROTOCOL:transport,PORTHOLE_OTLP_ENDPOINT:transport==='grpc'?'http://127.0.0.1:'+running.port:origin,PORTHOLE_OTLP_SECRET:source.secret},timeout:30000})
   const actual=JSON.parse(emitted.stdout.trim())
   assert.match(actual.traceId,/^[a-f0-9]{32}$/)
   assert.equal((await post(root+'/drain',{})).status,200)
   const read=async signal=>value(await fetch(origin+root+'/records?signal='+signal,{headers:{cookie}}))
   const spans=await read('traces'),logs=await read('logs'),metrics=await read('metrics')
   assert.ok(spans.records.some(row=>row.trace_id===actual.traceId&&row.payload.record.name==='synthetic-porthole-1622'),'official '+transport+' trace exporter writes the actual request span')
   assert.ok(logs.records.some(row=>row.trace_id===actual.traceId&&row.payload.record.body.stringValue==='synthetic-porthole-1624'),'official '+transport+' log exporter preserves actual request correlation')
   assert.ok(metrics.records.some(row=>row.source_id===source.credential.id&&row.payload.metric?.name==='synthetic_porthole_1623'&&(row.payload.record.asInt==='1'||row.payload.record.asDouble===1)),'official '+transport+' metrics exporter preserves actual request count')
  }
  const saved=await value(await post('/api/porthole/v1/query',{signal:'profiles',service:ingestScope.services[0],environment:ingestScope.environments[0],team:ingestScope.teams[0]}))
  const {profileArchiveJourney}=await import('./archive.mjs')
  await profileArchiveJourney({origin,cookie,records:saved.records,queryRef:saved.queryRef,withEmptyDestination})
  cookie=await freshOwner()
  await post('/app/settings/credentials/revoke',{id:source.credential.id})
  await assert.rejects(()=>rpc('profiles',binary),error=>error.code===grpc.status.UNAUTHENTICATED)
  await post('/app/settings/credentials/revoke',{id:readSource.credential.id})
  assert.equal((await fetch(origin+root+'/records?signal=profiles',{headers:{authorization:`Bearer ${readSource.secret}`}})).status,401)
  console.log('otlpProtocolJourney passed: real HTTP/gRPC four-signal intake, compressed transport, original profile samples/dictionaries/ns/links, per-signal auth/revocation, exact counts/retries, restart, query replay and inactive archive; official-schema edge only, no stock-profile/six-language/load claim')
  return {scope:ingestScope,profile,queryRef:saved.queryRef}
 }finally{clients.forEach(client=>client.close());await running.close()}
}
