import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {gunzipSync} from 'node:zlib'
import {setTimeout as delay} from 'node:timers/promises'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {otlpLanguageEstate} from './polyglot/estate.mjs'

const api='/api/porthole/v1/ingest',languages=['python','java','go','dotnet'],signals=['traces','logs','metrics']
const scope={services:languages,environments:['production'],teams:['commerce'],signals,actions:['telemetry.write']}
const hash=value=>createHash('sha256').update(value).digest('hex')
const attrs=list=>Object.fromEntries((list??[]).map(item=>[item.key,item.value.stringValue??item.value.intValue??item.value.doubleValue??item.value.boolValue]))
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
// Decode actual emitted protobuf using the pinned official Python SDK schema,
// independently of Porthole's decoder and normalization. No input is invented.
async function decoded(captures){
 const program=`import sys,json,base64
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
classes={'traces':ExportTraceServiceRequest,'logs':ExportLogsServiceRequest,'metrics':ExportMetricsServiceRequest}
def ids(value):
 if isinstance(value,list): return [ids(item) for item in value]
 if isinstance(value,dict): return {key:(base64.b64decode(item).hex() if key in ('traceId','spanId','parentSpanId') else ids(item)) for key,item in value.items()}
 return value
print(json.dumps([ids(MessageToDict(classes[item['signal']].FromString(base64.b64decode(item['wire'])),use_integers_for_enums=True)) for item in json.load(sys.stdin)]))`
 const child=spawn('docker',['run','--rm','-i','porthole-c7-python','python','-c',program],{stdio:['pipe','pipe','pipe']})
 let output='',errors='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>errors+=part)
 child.stdin.end(JSON.stringify(captures.map(c=>({signal:c.signal,wire:(c.headers['content-encoding']==='gzip'?gunzipSync(c.wire):c.wire).toString('base64')}))))
 const [exit]=await once(child,'exit');assert.equal(exit,0,errors);return JSON.parse(output)
}
function flatten(data,signal){
 const capital=signal==='traces'?'Spans':signal==='logs'?'Logs':'Metrics',rows=[]
 for(const resource of data['resource'+capital]??[])for(const scope of resource['scope'+capital]??[])for(const item of scope[signal==='traces'?'spans':signal==='logs'?'logRecords':'metrics']??[]){
  const common={resource:resource.resource??{},scope:scope.scope??{},resourceSchemaUrl:resource.schemaUrl??'',scopeSchemaUrl:scope.schemaUrl??''}
  if(signal==='metrics'){
   const kind=['gauge','sum','histogram','exponentialHistogram','summary'].find(key=>item[key])
   for(const point of item[kind].dataPoints??[]){const metric=structuredClone(item);delete metric[kind].dataPoints;rows.push({...common,metric,metricKind:kind,record:point})}
  }else rows.push({...common,record:item})
 }
 return rows
}
function comparable(payload){
 const result=structuredClone(payload);delete result.delivery
 // Official proto JSON omits scalar defaults. The product retains fields
 // explicitly present on the wire, including those defaults.
 const strip=value=>{
  if(Array.isArray(value))return value.map(strip)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k,v])=>!(Array.isArray(v)&&!v.length)&&!(v===''&&['name','version','schemaUrl','resourceSchemaUrl','scopeSchemaUrl','traceState','severityText','description','parentSpanId','traceId','spanId'].includes(k))&&!((v===0||v==='0'||v===false)&&['droppedAttributesCount','droppedEventsCount','droppedLinksCount','flags','severityNumber','aggregationTemporality','isMonotonic','code'].includes(k))).map(([k,v])=>[k,strip(v)]))
  return value
 }
 return strip(result)
}
// Recursive key ordering makes full payload comparison independent of JSON
// property order; attributes, events and exemplar arrays retain source order.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const fingerprint=payload=>JSON.stringify(canonical(comparable(payload)))
async function pages(origin,cookie,signal,extra={},request=path=>fetch(origin+path,{headers:{cookie}})){
 let cursor,snapshot,rows=[],count=0
 do{
  const query=new URLSearchParams({signal,limit:'31',...extra,...(cursor?{cursor,snapshot:String(snapshot)}:{})})
  const result=await value(await request(api+'/records?'+query))
  if(snapshot!==undefined)assert.equal(result.snapshot,snapshot,'pagination keeps its completion watermark')
  snapshot=result.snapshot;rows.push(...result.records);cursor=result.cursor;assert.ok(++count<500,'bounded pagination')
 }while(cursor)
 assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'no duplicate page records')
 return rows
}
function reconcile(expected,actual,sourceId){
 for(const signal of signals){
  const rows=actual[signal].filter(row=>row.source_id===sourceId)
  const actualRows=rows.map(row=>fingerprint(row.payload)).sort(),expectedRows=expected[signal].map(fingerprint).sort()
  const index=actualRows.findIndex((row,i)=>row!==expectedRows[i])
  if(index!==-1||actualRows.length!==expectedRows.length){
   const actual=JSON.parse(actualRows[index]??'{}'),wanted=expected[signal].find(p=>p.record.spanId&&p.record.spanId===actual.record?.spanId)||JSON.parse(expectedRows[index]??'{}')
   const differences=[]
   function compare(a,b,path=''){
    if(JSON.stringify(a)===JSON.stringify(b))return
    if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],path+'.'+key)}
    else differences.push({path,actual:a,expected:b})
   }
   compare(actual,canonical(comparable(wanted)))
   assert.fail(signal+' complete stock payload reconciliation: actual='+actualRows.length+' expected='+expectedRows.length+' differences='+JSON.stringify(differences.slice(0,8)))
  }
  for(const row of rows){
   const record=row.payload.record,time=signal==='traces'?record.startTimeUnixNano:record.timeUnixNano??record.observedTimeUnixNano??'0'
   assert.equal(BigInt(row.event_time_ns),BigInt(time),'original nanoseconds')
   assert.equal(row.trace_id,record.traceId??null);assert.equal(row.span_id,record.spanId??null)
  }
 }
}
function outcomes(expected,requests){
 const traces=expected.traces,logs=expected.logs,metrics=expected.metrics.filter(p=>p.metric.name==='synthetic_porthole_requests')
 for(const language of languages){
  const resource=p=>attrs(p.resource.attributes)['service.name']===language
  for(const request of requests.filter(r=>r.language===language)){
   const spans=traces.filter(p=>resource(p)&&p.record.traceId===request.traceId&&Number(p.record.kind)===2)
   assert.equal(spans.length,1,language+' independently counted request has one actual server span')
   const log=logs.filter(p=>resource(p)&&attrs(p.record.attributes)['request.id']===request.id)
   assert.equal(log.length,1,language+' request log exists once')
   assert.equal(log[0].record.traceId,request.traceId,language+' request log trace context')
   assert.equal(log[0].record.spanId,spans[0].record.spanId,language+' request log span context')
   assert.equal(Number(attrs(log[0].record.attributes)['http.response.status_code']),request.status)
   const points=metrics.filter(p=>resource(p)&&attrs(p.record.attributes)['request.id']===request.id)
   assert.ok(points.length>0,language+' actual metric exported for request')
   const latest=points.sort((a,b)=>BigInt(a.record.timeUnixNano)<BigInt(b.record.timeUnixNano)?-1:1).at(-1)
   assert.equal(Number(latest.record.asInt??latest.record.asDouble),1,language+' cumulative request count reconciles to one source request')
   assert.ok(points.some(p=>(p.record.exemplars??[]).some(e=>e.traceId===request.traceId&&e.spanId===spans[0].record.spanId)),language+' stock metric exemplar retains request trace and span context')
   assert.equal(latest.metricKind,'sum');assert.equal(latest.metric.unit,'{request}');assert.equal(latest.metric.sum.isMonotonic,true);assert.equal(latest.metric.sum.aggregationTemporality,2)
  }
  assert.ok(traces.some(p=>resource(p)&&attrs(p.resource.attributes)['telemetry.sdk.version']),language+' emitted SDK version present')
 }
}
export async function otlpLanguagesJourney({origin,freshOwner,restartWorker,withEmptyDestination}){
 let cookie=await freshOwner()
 const post=async(path,data,status=200)=>value(await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(data)}),status)
 const source=await post('/app/settings/credentials/mint',{name:'Stock four-language Collector',class:'ingest',scope,requestsPerMinute:10000,acceptedBytesPerMinute:100000000},201)
 const expected={traces:[],logs:[],metrics:[]},allCaptures=[],requests=[]
 for(const transport of ['http','grpc']){
  await post(api+'/control',{paused:true})
  const estate=await otlpLanguageEstate({origin,secret:source.secret,transport})
  try {
   for(const language of languages)for(let index=0;index<4;index++){
    const id='synthetic-porthole-'+transport+'-'+language+'-'+index,traceId=randomBytes(16).toString('hex'),parent=randomBytes(8).toString('hex'),status=index%2?503:200
    const response=await fetch('http://127.0.0.1:'+estate.ports[language]+'/work'+(status===503?'?fail=true':''),{headers:{'x-request-id':id,traceparent:'00-'+traceId+'-'+parent+'-01'}})
    assert.equal(response.status,status,language+' real producer response');await response.text();requests.push({id,traceId,language,status})
   }
   await delay(1600);await estate.stopProducers()
   assert.equal(estate.delivery.interrupted,1,'real stock Collector loses one acknowledgement after durable acceptance')
   assert.ok(estate.delivery.duplicates>=1,'stock Collector retries unchanged bytes after interrupted acknowledgement')
   assert.deepEqual(estate.failures,[],'stock Collector exports are acknowledged by real intake')
   const captures=[...estate.captures.values()]
   assert.ok(captures.length>=12,'each language exports all three signals')
   const messages=await decoded(captures)
   for(let i=0;i<captures.length;i++){
    const capture=captures[i],rows=flatten(messages[i],capture.signal)
    assert.equal(rows.length,capture.count,'receipt counts actual stock-exported records')
    capture.records=rows;expected[capture.signal].push(...rows);allCaptures.push(capture)
   }
   if(process.env.PORTHOLE_EVIDENCE_DIR){
    const directory=process.env.PORTHOLE_EVIDENCE_DIR;await mkdir(directory,{recursive:true})
    await writeFile(join(directory,'otlp-'+transport+'.json'),JSON.stringify({requests:requests.filter(r=>r.id.includes('-'+transport+'-')),captures:captures.map((c,i)=>({signal:c.signal,wireBase64:c.wire.toString('base64'),sha256:hash(c.wire),decoded:messages[i],accepted:c.count}))},null,2))
   }
  }catch(error){console.log(JSON.stringify(await estate.diagnostics()));throw error}finally{await estate.stop()}
  await restartWorker();cookie=await freshOwner()
  for(const capture of allCaptures){
   const response=await fetch(origin+'/v1/'+capture.signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,...capture.headers},body:capture.wire})
   assert.equal(response.status,200);assert.equal(response.headers.get('x-porthole-duplicate'),'true','exact stock export retry after restart')
  }
  await post(api+'/control',{paused:false})
  for(let attempt=0;attempt<100;attempt++){if(!(await post(api+'/drain',{})).pendingBatches)break}
 }
 outcomes(expected,requests)
 const actual={};for(const signal of signals)actual[signal]=await pages(origin,cookie,signal)
 reconcile(expected,actual,source.credential.id)
 await post(api+'/control',{paused:true})
 for(const signal of signals){
  const malformed=await fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf'},body:Buffer.from([255])})
  assert.equal(malformed.status,400);assert.ok(malformed.headers.get('x-porthole-error'))
 }
 const narrow=await post('/app/settings/credentials/mint',{name:'Logs only stock source',class:'ingest',scope:{...scope,signals:['logs']}},201)
 const trace=allCaptures.find(c=>c.signal==='traces')
 assert.equal((await fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+narrow.secret,...trace.headers},body:trace.wire})).status,403,'wrong signal grant refuses actual stock bytes')
 assert.equal((await fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer synthetic-porthole-1002',...trace.headers},body:trace.wire})).status,401,'foreign source refuses actual stock bytes')
 const reader=await post('/app/settings/credentials/mint',{name:'Stock signal reader',class:'read',scope:{...scope,actions:['telemetry.read']}},201)
 const firstRead=await value(await fetch(origin+api+'/records?signal=logs&limit=1',{headers:{authorization:'Bearer '+reader.secret}}))
 assert.equal(firstRead.records.length,1);assert.ok(firstRead.cursor,'actual stock logs paginate')
 await post('/app/settings/credentials/revoke',{id:reader.credential.id})
 assert.equal((await fetch(origin+api+'/records?'+new URLSearchParams({signal:'logs',limit:'1',snapshot:String(firstRead.snapshot),cursor:firstRead.cursor}),{headers:{authorization:'Bearer '+reader.secret}})).status,401,'next page cannot reuse revoked read authority')
 const wrongEnvelope=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,...trace.headers},body:trace.wire})
 assert.equal(wrongEnvelope.status,400,'trace message cannot enter a metric endpoint')
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 assert.equal((await fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,...trace.headers},body:trace.wire})).status,401,'next request source revocation')
 await post(api+'/control',{paused:false})
 const status=await value(await fetch(origin+api+'/status',{headers:{cookie}}))
 for(const signal of signals){const rows=status.sources.filter(r=>r.sourceId===source.credential.id&&r.signal===signal);for(const key of ['accepted','queryable','archived'])assert.equal(rows.reduce((n,r)=>n+r[key],0),expected[signal].length,'counted '+key+' '+signal)}
 if(withEmptyDestination){const {otlpLanguageArchiveJourney}=await import('./archive.mjs');await otlpLanguageArchiveJourney({origin,cookie,withEmptyDestination,expected,captures:allCaptures,sourceId:source.credential.id,reconcile,pages,fingerprint})}
 await otlpLanguagesAnalyticalJourney({captures:allCaptures,expected})
 cookie=await freshOwner();await languageScreens({origin,cookie})
 console.log('PROBE PORT-001 language exports: 32 independently counted real requests, 16 success and 16 refusal outcomes; stock HTTP and gRPC Collector exports -> all trace, log and metric payloads reconciled')
 console.log('otlpLanguagesJourney passed '+JSON.stringify({requests:requests.length,records:Object.fromEntries(signals.map(signal=>[signal,expected[signal].length])),transports:['http','grpc'],languages}))
 return {expected}
}
export async function otlpLanguagesAnalyticalJourney({captures,expected}){
 const {analyticalEstate}=await import('./analytics.mjs'),{recipientMailJourney}=await import('./health.mjs')
 const estate=await analyticalEstate()
 try{await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async({origin,cookie,call,post,restart})=>{
  const send=async(path,data,status=200)=>(await post(path,data,status)).json()
  const read=async path=>value(await call(path,{headers:{cookie}}))
  let config=await read('/api/porthole/v1/analytics/configuration')
  await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role:'primary',confirm:'connect-analytical-workers'})
  const source=await send('/app/settings/credentials/mint',{name:'Captured stock Collector exports',class:'ingest',scope,requestsPerMinute:10000,acceptedBytesPerMinute:100000000},201)
  for(const capture of captures)assert.equal((await call('/v1/'+capture.signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,...capture.headers},body:capture.wire})).status,200)
  for(let i=0;i<100;i++){const drain=await send(api+'/drain',{});if(!drain.pendingBatches){assert.equal(drain.analytical.complete,true);break}}
  for(const role of ['primary','standby']){
   config=await read('/api/porthole/v1/analytics/configuration');await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role,confirm:'connect-analytical-workers'})
   const actual={};for(const signal of signals)actual[signal]=await pages(origin,cookie,signal,{},path=>call(path,{headers:{cookie}}))
   reconcile(expected,actual,source.credential.id)
  }
  await restart();const actual={};for(const signal of signals)actual[signal]=await pages(origin,cookie,signal,{},path=>call(path,{headers:{cookie}}));reconcile(expected,actual,source.credential.id)
  await estate.stop('standby');assert.equal((await call(api+'/records?signal=logs',{headers:{cookie}})).status,503,'unavailable analytical storage does not become an empty success')
 }})}finally{await estate.dispose()}
 console.log('PROBE PORT-001 analytical reads: actual captured stock exports -> every record reconciled through primary and standby paginated public reads, restart retained, stopped storage refused')
}
async function languageScreens({origin,cookie}){
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox']})
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.addCookies(cookie.split('; ').map(item=>({name:item.slice(0,item.indexOf('=')),value:item.slice(item.indexOf('=')+1),url:origin})))
  const page=await context.newPage()
  await page.goto(origin+'/app/ingest');await page.getByRole('heading',{level:1}).waitFor()
  if(width===1440){assert.ok((await page.locator('body').innerText()).includes('python'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'language-delivery-'+width+'.png'),fullPage:true})
  await page.goto(origin+'/app/explore')
  await page.getByLabel('Signal',{exact:true}).selectOption('logs')
  for(const [label,text]of [['Service','python'],['Environment','production'],['Team','commerce']])await page.getByLabel(label,{exact:true}).fill(text)
  await page.getByRole('button',{name:'Run query',exact:true}).click();await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
  if(width===1440){assert.ok((await page.locator('pre').textContent()).includes('request.id'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'language-logs-'+width+'.png'),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
}
