import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {gzipSync} from 'node:zlib'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const execute=promisify(execFile),api='/api/porthole/v1/genai',marker='synthetic-porthole-2701-sensitive-content'

// Official OTLP LogRecord eventName (field 12), without provider attributes.
function messageLog(eventName,body){
 const varint=value=>{const bytes=[];do{bytes.push((value&127)|(value>127?128:0));value>>>=7}while(value);return Buffer.from(bytes)}
 const field=(number,value)=>{const bytes=Buffer.from(value);return Buffer.concat([varint(number*8+2),varint(bytes.length),bytes])}
 return field(1,field(2,field(2,Buffer.concat([field(5,field(1,body)),field(12,eventName)]))))
}

async function stock({origin,call,source}){
 const bridge=createServer(async(request,response)=>{
  const parts=[];for await(const part of request)parts.push(part)
  const received=await call('/v1/traces',{method:'POST',headers:{'content-type':'application/x-protobuf',authorization:'Bearer '+source.secret},body:Buffer.concat(parts)})
  response.writeHead(received.status,Object.fromEntries(received.headers));response.end(Buffer.from(await received.arrayBuffer()))
 })
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve))
 try{
  const child=await execute(process.execPath,['tests/porthole/genai/stock.cjs'],{timeout:60000,maxBuffer:2*1024*1024,env:{...process.env,PORTHOLE_GENAI_INTAKE:'http://127.0.0.1:'+bridge.address().port+'/v1/traces',PORTHOLE_GENAI_SOURCE:source.secret,OTEL_SERVICE_NAME:'genai-checkout',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-2700',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',OTEL_TRACES_SAMPLER:'always_on',OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:'true'}})
  assert.ok(!child.stderr.includes(marker),'value-free diagnostics even for actual provider failures')
  const receipt=JSON.parse(child.stdout.trim().split('\n').at(-1))
  for(const packet of receipt.packets)assert.ok(!Buffer.from(packet,'base64').includes(Buffer.from(marker)),'stock exporter sends no prompt, completion, tool argument or exception content')
  return receipt
 }finally{await new Promise(resolve=>bridge.close(resolve))}
}
function inspect(view,receipt){
 assert.equal(view.contentCapture,'disabled');assert.equal(view.calls.length,9)
 const models=view.calls.filter(c=>c.usage),tools=view.calls.filter(c=>!c.usage)
 assert.equal(models.length,7);assert.equal(tools.length,2)
 assert.equal(models.filter(c=>c.status==='failed').length,2)
 assert.equal(models.filter(c=>c.usageState==='missing').length,3)
 assert.equal(models.filter(c=>c.streaming===true).length,2)
 assert.ok(models.every(c=>c.parentSpanId===receipt.rootId),'stock provider spans correlate to the real request')
 assert.ok(models.every(c=>['@opentelemetry/instrumentation-openai','@traceloop/instrumentation-anthropic'].includes(c.instrumentation.name)))
 assert.ok(models.every(c=>c.feature==='checkout-assistant'&&c.conventions!=='undeclared'))
 assert.deepEqual(models.filter(c=>c.requestModel==='synthetic-porthole-retry').map(c=>c.attempt).sort(),[1,2])
 assert.ok(models.filter(c=>c.status==='failed').every(c=>Object.values(c.usage).every(n=>n===null)),'failed calls never invent token counters')
 assert.equal(models.reduce((n,c)=>n+(c.usage.inputTokens??0),0),35)
 assert.equal(models.reduce((n,c)=>n+(c.usage.outputTokens??0),0),19)
 assert.equal(models.reduce((n,c)=>n+(c.usage.cacheReadInputTokens??0),0),6)
 assert.equal(models.reduce((n,c)=>n+(c.usage.cacheCreationInputTokens??0),0),2)
 assert.ok(models.filter(c=>c.provider==='openai').every(c=>c.usage.cacheReadInputTokens===null),'the pinned OpenAI plugin omits cache counters; they stay unavailable')
 assert.deepEqual(tools.map(c=>c.toolName).sort(),['inventory','shipping'])
 assert.deepEqual(tools.map(c=>c.toolCallId).sort(),['synthetic-porthole-tool-1','synthetic-porthole-tool-2'])
 for(const tool of tools){const parent=models.find(c=>c.spanId===tool.parentSpanId);assert.ok(parent);assert.equal(tool.parent,parent.spanId);assert.equal(parent.status,'completed')}
 assert.ok(view.groups.length>0);assert.equal(view.groups.reduce((n,g)=>n+g.observedInputTokens,0),35)
 assert.ok(view.groups.every(g=>g.usd===null));assert.equal(view.usd,null);assert.equal(view.reconciliation.state,'unavailable')
 assert.ok(view.calls.every(c=>c.rateSource===null&&c.usd===null&&c.reconciliation.state==='unavailable'))
 assert.ok(!JSON.stringify(view).includes(marker))
}

export async function genaiJourney({origin,freshOwner,restartWorker,sql,withEmptyDestination,signIn}){
 let cookie=await freshOwner()
 const call=(path,options={})=>fetch(origin+path,options)
 const post=async(path,data,status=200,acting=cookie)=>{const response=await call(path,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.json()}
 const get=async(path,acting=cookie)=>{const response=await call(path,{headers:{cookie:acting}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const scope={services:['genai-checkout'],environments:['production'],teams:['commerce']}
 const source=await post('/app/settings/credentials/mint',{name:'Native GenAI collector',class:'ingest',scope:{...scope,signals:['traces','logs'],actions:['telemetry.write']}},201)
 await post('/api/porthole/v1/ingest/control',{paused:true})
 const receipt=await stock({origin,call,source})
 const pending=await sql('SELECT state,records,wire_base64 FROM porthole_ingest_batches')
 assert.ok(pending.length>0&&pending.every(r=>r.state==='pending'));assert.ok(!JSON.stringify(pending).includes(marker))
 await restartWorker();cookie=await freshOwner()
 await post('/api/porthole/v1/ingest/control',{paused:false});await post('/api/porthole/v1/ingest/drain',{})
 let view=await get(api+'?trace='+receipt.traceId);inspect(view,receipt)
 const original=structuredClone(view)
 for(const packet of receipt.packets){const replay=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf'},body:Buffer.from(packet,'base64')});assert.equal(replay.status,200);assert.equal(replay.headers.get('x-porthole-duplicate'),'true')}
 await post('/api/porthole/v1/ingest/drain',{});inspect(await get(api+'?trace='+receipt.traceId),receipt)
 // A different envelope identity can carry the same spans. Identity-based
 // projection still counts one invocation and exposes the redundant copies.
 for(const [index,packet]of receipt.packets.entries())assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf','x-porthole-batch-id':'synthetic-porthole-2780-'+index},body:Buffer.from(packet,'base64')})).status,200)
 await post('/api/porthole/v1/ingest/drain',{})
 view=await get(api+'?trace='+receipt.traceId);inspect(view,receipt);assert.ok(view.replayCopies>=9)
 await restartWorker();cookie=await freshOwner();inspect(await get(api+'?trace='+receipt.traceId),receipt)
 const retained=await get('/api/porthole/v1/ingest/records?signal=traces&trace='+receipt.traceId+'&limit=2000')
 const model=retained.records.find(r=>r.payload.record.attributes?.some(a=>a.key==='gen_ai.operation.name'))
 const base=()=>({resourceSpans:[{resource:structuredClone(model.payload.resource),scopeSpans:[{scope:structuredClone(model.payload.scope),spans:[structuredClone(model.payload.record)]}]}]})
 const content={key:'gen_ai.input.messages',value:{stringValue:marker}}
 const probes=[]
 for(const mutate of [p=>p.resourceSpans[0].scopeSpans[0].spans[0].attributes.push(content),p=>p.resourceSpans[0].resource.attributes.push(content),p=>p.resourceSpans[0].scopeSpans[0].scope.attributes=[content],p=>p.resourceSpans[0].scopeSpans[0].spans[0].events=[{name:'exception',attributes:[{key:'exception.message',value:{stringValue:marker}}]}],p=>p.resourceSpans[0].scopeSpans[0].spans[0].status={code:2,message:marker},p=>p.resourceSpans[0].scopeSpans[0].spans[0].links=[{traceId:receipt.traceId,spanId:receipt.rootId,attributes:[{key:'gen_ai.tool.call.arguments',value:{stringValue:marker}}]}]]){const packet=base();mutate(packet);probes.push(packet)}
 const count=async()=>sql('SELECT COUNT(*) AS n FROM porthole_ingest_batches')
 const logHeaders={authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf'}
 assert.equal((await call('/v1/logs',{method:'POST',headers:logHeaders,body:messageLog('synthetic-porthole-event','synthetic-porthole-2791')})).status,200,'ordinary message logs remain supported')
 const metadataLog={resourceLogs:[{scopeLogs:[{logRecords:[{eventName:'gen_ai.client.inference.operation.details'}]}]}]}
 assert.equal((await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(metadataLog)})).status,200,'content-free GenAI event metadata remains supported')
 const before=await count()
 for(const [index,packet]of probes.entries()){
  const response=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json',...(index%2?{'content-encoding':'gzip'}:{})},body:index%2?gzipSync(JSON.stringify(packet)):JSON.stringify(packet)})
  assert.equal(response.status,400);assert.equal((await response.json()).message,'genai_content_not_authorized')
 }
 const unsafeLog={resourceLogs:[{resource:structuredClone(model.payload.resource),scopeLogs:[{logRecords:[{timeUnixNano:'1',attributes:[{key:'gen_ai.system',value:{stringValue:'openai'}}],body:{stringValue:marker}}]}]}]}
 assert.equal((await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(unsafeLog)})).status,400)
 for(const eventName of ['gen_ai.system.message','gen_ai.user.message','gen_ai.assistant.message','gen_ai.tool.message','gen_ai.client.inference.operation.details']){
  for(const body of [{stringValue:marker},{kvlistValue:{values:[{key:'content',value:{stringValue:marker}}]}}]){
   const packet=structuredClone(unsafeLog),log=packet.resourceLogs[0].scopeLogs[0].logRecords[0]
   delete log.attributes;log.eventName=eventName;log.body=body
   const response=await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','content-encoding':'gzip'},body:gzipSync(JSON.stringify(packet))})
   assert.equal(response.status,400,'GenAI message event refuses content without optional provider metadata: '+eventName)
   assert.equal((await response.json()).message,'genai_content_not_authorized')
  }
  const response=await call('/v1/logs',{method:'POST',headers:logHeaders,body:messageLog(eventName,marker)})
  assert.equal(response.status,400,'protobuf GenAI message content is refused without provider metadata')
  assert.equal(response.headers.get('x-porthole-error'),'genai_content_not_authorized')
  assert.ok(!Buffer.from(await response.arrayBuffer()).includes(Buffer.from(marker)))
 }
 const eventPacket=base(),eventSpan=eventPacket.resourceSpans[0].scopeSpans[0].spans[0]
 delete eventSpan.attributes;eventSpan.events=[{name:'gen_ai.user.message',attributes:[{key:'content',value:{stringValue:marker}}]}]
 assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(eventPacket)})).status,400,'GenAI span event names protect content without provider metadata')
 // Correlation links are part of the same metadata-only record. A content key
 // does not become consented by moving it off the span's own attributes.
 const linked=base()
 linked.resourceSpans[0].scopeSpans[0].spans[0].links=[{traceId:receipt.traceId,spanId:receipt.rootId,attributes:[{key:'prompt',value:{stringValue:marker}}]}]
 const linkedResponse=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(linked)})
 assert.equal(linkedResponse.status,400,'GenAI link content refuses before original-wire persistence')
 assert.equal((await linkedResponse.json()).message,'genai_content_not_authorized')
 assert.deepEqual(await count(),before,'content refusal creates no pending or original-wire envelope')
 const stored=await sql("SELECT records||wire_base64 AS value FROM porthole_ingest_batches UNION ALL SELECT payload FROM porthole_telemetry_records UNION ALL SELECT payload FROM porthole_telemetry_archive UNION ALL SELECT reason FROM porthole_ingest_events")
 assert.ok(stored.length>20);assert.ok(stored.every(row=>!row.value.includes(marker)))
 for(const row of await sql('SELECT wire_base64 FROM porthole_ingest_batches'))assert.ok(!Buffer.from(row.wire_base64,'base64').includes(Buffer.from(marker)))
 await genaiBrowser({origin,cookie,traceId:receipt.traceId})
 assert.equal((await call(api)).status,401);assert.equal((await call(api,{method:'POST',headers:{cookie}})).status,405)
 assert.equal((await call(api+'?provider=openai',{headers:{cookie}})).status,400)
 assert.equal((await call(api+'?trace=bad',{headers:{cookie}})).status,400)
 const address=['synthetic-porthole-2790','example.com'].join(String.fromCharCode(64))
 await post('/app/settings/members/invite',{email:address,displayName:'GenAI scoped analyst',role:'read-only analyst',scope},202)
 const restricted=await signIn(address)
 inspect(await get(api+'?trace='+receipt.traceId,restricted),receipt)
 const rows=await sql("SELECT id FROM oa_operators WHERE display_name='GenAI scoped analyst'")
 const memberId=rows[0].id
 await post('/app/settings/members/change',{operatorId:memberId,role:'read-only analyst',scope:{...scope,services:['other-service']}})
 assert.equal((await call(api+'?trace='+receipt.traceId,{headers:{cookie:restricted}})).status,401,'scope change revokes the old session immediately')
 const narrowed=await signIn(address)
 assert.deepEqual((await get(api+'?trace='+receipt.traceId,narrowed)).calls,[],'a new current session sees only its narrowed scope')
 const read=await post('/app/settings/credentials/mint',{name:'GenAI scoped reader',class:'read',scope:{...scope,signals:['traces'],actions:['telemetry.read']}},201)
 assert.equal((await call(api+'?trace='+receipt.traceId,{headers:{authorization:'Bearer '+read.secret}})).status,200)
 await post('/app/settings/credentials/revoke',{id:read.credential.id})
 assert.equal((await call(api+'?trace='+receipt.traceId,{headers:{authorization:'Bearer '+read.secret}})).status,401)
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf'},body:Buffer.from(receipt.packets[0],'base64')})).status,401)
 const {genaiArchiveJourney}=await import('./archive.mjs')
 await genaiArchiveJourney({origin,cookie:await freshOwner(),withEmptyDestination,traceId:receipt.traceId,expected:view,marker})
 cookie=await freshOwner()
 const preview=await post('/api/porthole/v1/subject-erasure',{identifier:'checkout-assistant'});assert.equal(preview.canApply,true);assert.ok(preview.records>0)
 await post('/api/porthole/v1/subject-erasure/apply',{identifier:'checkout-assistant',digest:preview.digest,confirm:'erase-exact-batches'})
 assert.deepEqual((await get(api+'?trace='+receipt.traceId)).calls,[])
 const replacement=await post('/app/settings/credentials/mint',{name:'Replacement GenAI collector',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
 for(const packet of receipt.packets)assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+replacement.secret,'content-type':'application/x-protobuf'},body:Buffer.from(packet,'base64')})).status,409,'later erasure journal refuses replay under new source authority')
 await restartWorker();cookie=await freshOwner();assert.deepEqual((await get(api+'?trace='+receipt.traceId)).calls,[])
 assert.ok(original.calls.length>0)
 console.log('genaiJourney passed: stock SDK multi-tool, stream, retry and failure; exact observed usage, missing cache and USD, replay, content admission and custody, current authority, restart, erasure and inactive archive')
}

export async function genaiBrowser({origin,cookie,traceId}){
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),response=await page.goto(origin+'/app/genai?trace='+traceId)
  assert.equal(response.status(),200)
  if(width===1440){
   assert.match(await page.locator('body').innerText(),/checkout-assistant/);assert.match(await page.locator('body').innerText(),/USD and provider reconciliation: Unavailable/)
   assert.ok(await page.getByRole('heading',{name:/inventory/}).isVisible());assert.ok(await page.getByRole('heading',{name:/shipping/}).isVisible())
   assert.equal(await page.locator('button,a').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0)
   assert.ok(await page.locator('main p,main button,main label,main dt,main dd').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)))
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native GenAI page fits viewport')
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'genai-observed-'+width+'.png'),fullPage:true})}
  await context.close()
 }}finally{await browser.close()}
}

export async function genaiAnalyticalJourney(){
 const {analyticalEstate}=await import('./analytics.mjs'),{recipientMailJourney}=await import('./health.mjs')
 const estate=await analyticalEstate()
 try{await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async({origin,call,post,cookie,restart,getDb})=>{
  const send=async(path,data,status=200)=>(await post(path,data,status)).json()
  const read=async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()}
  const config=await read('/api/porthole/v1/analytics/configuration')
  await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role:'primary',confirm:'connect-analytical-workers'})
  const source=await send('/app/settings/credentials/mint',{name:'Analytical GenAI collector',class:'ingest',scope:{services:['genai-checkout'],environments:['production'],teams:['commerce'],signals:['traces'],actions:['telemetry.write']}},201)
  const receipt=await stock({origin,call,source})
  const drain=await send('/api/porthole/v1/ingest/drain',{});assert.equal(drain.analytical.complete,true,JSON.stringify(drain.analytical))
  for(const role of ['primary','standby']){
   const config=await read('/api/porthole/v1/analytics/configuration')
   await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role,confirm:'connect-analytical-workers'})
   const view=await read(api+'?trace='+receipt.traceId);inspect(view,receipt);assert.equal(view.analytical.role,role)
   const custody=await (await fetch(estate.origin(role)+'/v1/query',{method:'POST',headers:{authorization:'Bearer '+estate.bindings['ANALYTICS_'+role.toUpperCase()+'_TOKEN'],'content-type':'application/json'},body:JSON.stringify({sourceIdentity:(await getDb().prepare('SELECT source_identity FROM porthole_analytical_configuration').first()).source_identity,requiredWatermark:view.snapshot,snapshot:view.snapshot,signal:'traces',scope:{services:['genai-checkout'],environments:['production'],teams:['commerce']},from:'0',through:'18446744073709551615',limit:200})})).json()
   assert.ok(custody.records.length>=10);assert.ok(!JSON.stringify(custody).includes(marker))
  }
  await restart();inspect(await read(api+'?trace='+receipt.traceId),receipt)
  await estate.stop('standby');assert.equal((await call(api+'?trace='+receipt.traceId,{headers:{cookie}})).status,503,'no silent local fallback when selected analytical process is stopped')
 }})}finally{await estate.dispose()}
 console.log('genaiAnalyticalJourney passed: exact stock-emitted spans and metadata-only custody on both real analytical workers, cold restart and unavailable selected worker')
}

/** Complete event-name boundary through public intake and native installation
 * export. The independent wire schema below uses official OTLP field numbers;
 * neither admission nor the product's archive validator is used as an oracle. */
export async function genaiContentRefusalJourney({origin,cookie,sql,saveArchive,exportInstallation}) {
 const {createRequire}=await import('node:module'),{gunzipSync}=await import('node:zlib')
 const grpc=createRequire(import.meta.resolve('@grpc/grpc-js'))
 const {parse}=createRequire(grpc.resolve('@grpc/proto-loader'))('protobufjs')
 const schema=parse(`syntax = "proto3";
  message AnyValue { string stringValue = 1; }
  message KeyValue { string key = 1; AnyValue value = 2; }
  message Resource { repeated KeyValue attributes = 1; }
  message Event { fixed64 timeUnixNano = 1; string name = 2; repeated KeyValue attributes = 3; }
  message Status { uint32 code = 3; }
  message Span { bytes traceId = 1; bytes spanId = 2; string name = 5; uint32 kind = 6;
   fixed64 startTimeUnixNano = 7; fixed64 endTimeUnixNano = 8; repeated KeyValue attributes = 9;
   repeated Event events = 11; Status status = 15; }
  message LogRecord { fixed64 timeUnixNano = 1; AnyValue body = 5; repeated KeyValue attributes = 6; string eventName = 12; }
  message ScopeSpans { repeated Span spans = 2; }
  message ScopeLogs { repeated LogRecord logRecords = 2; }
  message ResourceSpans { Resource resource = 1; repeated ScopeSpans scopeSpans = 2; }
  message ResourceLogs { Resource resource = 1; repeated ScopeLogs scopeLogs = 2; }
  message Traces { repeated ResourceSpans resourceSpans = 1; }
  message Logs { repeated ResourceLogs resourceLogs = 1; }`).root
 const attr=(key,stringValue)=>({key,value:{stringValue}})
 const scope={services:['synthetic-porthole-9801'],environments:['production'],teams:['synthetic-porthole-9802']}
 const resource={attributes:[attr('service.name',scope.services[0]),attr('deployment.environment.name','production'),attr('team.name',scope.teams[0])]}
 const traceId='98000000000000000000000000000001',time=1793361600000000000n
 const markers=['synthetic-porthole-9803-prompt-content','synthetic-porthole-9804-response-content']
 const post=async(path,data,status=200)=>{
  const response=await fetch(origin+path,form(origin,cookie,data))
  assert.equal(response.status,status,await response.clone().text());return response.json()
 }
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-9805',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}},201)
 const packet=(signal,provider,index,eventName,content)=>{
  const attributes=provider?[attr('gen_ai.provider.name','openai')]:[]
  const record=signal==='logs'
   ?{timeUnixNano:String(time+BigInt(index)),eventName:eventName??'synthetic-porthole-9806',...(content?{body:{stringValue:content}}:provider?{}:{body:{stringValue:'synthetic-porthole-9807'}}),attributes}
   :{traceId,spanId:(index+1).toString(16).padStart(16,'0'),name:'synthetic-porthole-9808',kind:2,startTimeUnixNano:String(time),endTimeUnixNano:String(time+1000000n),status:{code:1},attributes,...(eventName?{events:[{name:eventName,timeUnixNano:String(time),attributes:[attr('content',content)]}]}:{})}
  return signal==='logs'?{resourceLogs:[{resource,scopeLogs:[{logRecords:[record]}]}]}:{resourceSpans:[{resource,scopeSpans:[{spans:[record]}]}]}
 }
 const types={logs:schema.lookupType('Logs'),traces:schema.lookupType('Traces')}
 const encode=(signal,data,encoding)=>{
  if(encoding==='json')return Buffer.from(JSON.stringify(data))
  const copy=structuredClone(data)
  if(signal==='traces')for(const group of copy.resourceSpans)for(const scope of group.scopeSpans)for(const span of scope.spans){span.traceId=Buffer.from(span.traceId,'hex');span.spanId=Buffer.from(span.spanId,'hex')}
  return Buffer.from(types[signal].encode(types[signal].fromObject(copy)).finish())
 }
 const send=(signal,data,encoding,gzip)=>{
  const bytes=encode(signal,data,encoding)
  return fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':encoding==='json'?'application/json':'application/x-protobuf',...(gzip?{'content-encoding':'gzip'}:{})},body:gzip?gzipSync(bytes):bytes})
 }
 const clean=value=>{const text=typeof value==='string'?value:JSON.stringify(value);for(const marker of markers)assert.ok(!text.includes(marker),'no planted prompt or response content in custody or diagnostics')}
 let decoded=0
 function inspect(value) {
  clean(value)
  if(typeof value==='string'&&/^[\[{]/.test(value.trim())){inspect(JSON.parse(value));return}
  if(!value||typeof value!=='object')return
  if(value.wire_base64){
   let bytes=Buffer.from(value.wire_base64,'base64')
   if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes)
   clean(bytes.toString('utf8'))
   const wire=bytes[0]===123?JSON.parse(bytes.toString('utf8')):types[value.signal].toObject(types[value.signal].decode(bytes),{longs:String,bytes:String})
   clean(wire);decoded++
   const groups=wire.resourceSpans??wire.resourceLogs
   assert.equal(groups.length,1,'decode a real accepted control envelope')
   assert.ok(groups[0].resource.attributes.some(a=>a.key==='service.name'&&a.value.stringValue==='synthetic-porthole-9801'))
   const record=value.signal==='traces'?groups[0].scopeSpans[0].spans[0]:groups[0].scopeLogs[0].logRecords[0]
   assert.equal(record.name??record.eventName,value.signal==='traces'?'synthetic-porthole-9808':'synthetic-porthole-9806')
   assert.ok(!record.events?.length,'retained wire contains only the accepted control')
  }
  for(const child of Object.values(value))inspect(child)
 }
 const snapshot=async()=>({
  batches:await sql('SELECT id,state,signal,records,wire_base64,record_count FROM porthole_ingest_batches ORDER BY id'),
  retained:await sql('SELECT id,payload FROM porthole_telemetry_records ORDER BY id'),
  archive:await sql('SELECT id,payload FROM porthole_telemetry_archive ORDER BY id'),
 })
 await post('/api/porthole/v1/ingest/control',{paused:true})
 const controls=[]
 for(const signal of ['logs','traces'])for(const provider of [false,true])for(const encoding of ['json','protobuf'])for(const gzip of [false,true]){
  const response=await send(signal,packet(signal,provider,controls.length),encoding,gzip)
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('x-porthole-accepted'),'1')
  await response.arrayBuffer();controls.push(response.headers.get('x-porthole-batch'))
 }
 const pending=await snapshot()
 assert.equal(pending.batches.length,16);assert.ok(pending.batches.every(row=>row.state==='pending'))
 assert.equal(pending.retained.length,0);assert.equal(pending.archive.length,0);inspect(pending)
 const frozenPending=await saveArchive();assert.ok(frozenPending.rows.some(row=>row.table==='porthole_ingest_batches'));inspect(frozenPending)
 let refused=0
 for(const signal of ['logs','traces'])for(const [index,eventName]of ['gen_ai.user.message','gen_ai.assistant.message'].entries())for(const provider of [false,true])for(const encoding of ['json','protobuf'])for(const gzip of [false,true]){
  // Put the valid control first in the same envelope: refusing the content
  // must not partially accept the innocuous prefix either.
  const data=packet(signal,provider,100+refused,eventName,markers[index]),control=packet(signal,provider,200+refused)
  if(signal==='logs')data.resourceLogs[0].scopeLogs[0].logRecords.unshift(control.resourceLogs[0].scopeLogs[0].logRecords[0])
  else data.resourceSpans[0].scopeSpans[0].spans.unshift(control.resourceSpans[0].scopeSpans[0].spans[0])
  const response=await send(signal,data,encoding,gzip)
  assert.equal(response.status,400,`${signal} ${eventName} provider=${provider} ${encoding} gzip=${gzip}`)
  const body=Buffer.from(await response.arrayBuffer());clean(body.toString('utf8'));clean(Object.fromEntries(response.headers))
  if(encoding==='json')assert.deepEqual(JSON.parse(body.toString()),{code:3,message:'genai_content_not_authorized'})
  else{assert.equal(response.headers.get('x-porthole-error'),'genai_content_not_authorized');assert.ok(body.includes(Buffer.from('genai_content_not_authorized')))}
  refused++
 }
 assert.equal(refused,32)
 assert.deepEqual(await snapshot(),pending,'all unsafe envelopes refuse before pending, original-wire, retained or archive writes; accepted controls are unchanged')
 const diagnostics=await sql('SELECT * FROM porthole_ingest_events ORDER BY rowid')
 assert.ok(diagnostics.length>=32);inspect(diagnostics)
 assert.equal(diagnostics.filter(row=>row.reason==='genai_content_not_authorized').length,32)
 console.log('PROBE PORT-098 refusal: both message names, both routes, provider present and absent, JSON and protobuf, plain and gzip -> 32 refusals, value-free diagnostics, zero custody changes')
 await post('/api/porthole/v1/ingest/control',{paused:false})
 await post('/api/porthole/v1/ingest/drain',{})
 const retained=await snapshot();inspect(retained)
 assert.equal(retained.retained.length,16);assert.equal(retained.archive.length,16)
 assert.ok(retained.batches.every(row=>row.state==='complete'))
 for(const batch of retained.batches){const before=pending.batches.find(row=>row.id===batch.id);assert.equal(batch.records,before.records);assert.equal(batch.wire_base64,before.wire_base64)}
 const read=async path=>{const response=await fetch(origin+path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const traces=await read('/api/porthole/v1/ingest/records?signal=traces&trace='+traceId+'&limit=200')
 assert.equal(traces.records.length,8)
 assert.ok(traces.records.every(row=>row.payload.record.name==='synthetic-porthole-9808'&&row.payload.record.endTimeUnixNano==='1793361600001000000'))
 const beforeTraces=structuredClone(traces.records)
 const frozen=await saveArchive();inspect(frozen)
 for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'])assert.equal(frozen.rows.filter(row=>row.table===table).length,16)
 inspect(await sql('SELECT payload FROM porthole_archive_rows'))
 inspect(await sql('SELECT packet FROM porthole_archive_chunks'))
 const again=await read('/api/porthole/v1/ingest/records?signal=traces&trace='+traceId+'&limit=200')
 assert.deepEqual(again.records,beforeTraces,'owner export leaves accepted control traces unchanged')
 console.log('PROBE PORT-098 retained: owner retained-trace read and frozen archive -> 8 unchanged control spans, 16 retained and 16 archive records, decoded content-free wire')
 const beforeExportDecoded=decoded,records=await exportInstallation();inspect(records)
 const items=records.filter(record=>record.kind==='part').flatMap(record=>record.items)
 for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'])assert.equal(items.filter(item=>item.kind==='row'&&item.table===table).length,16,'actual installation export includes populated '+table)
 for(const batch of items.filter(item=>item.table==='porthole_ingest_batches')) {
  const before=retained.batches.find(row=>row.id===batch.row.id)
  assert.ok(before);assert.equal(batch.row.wire_base64,before.wire_base64);assert.equal(batch.row.records,before.records)
 }
 assert.equal(decoded-beforeExportDecoded,16,'every native exported original-wire entry was actually decoded')
 console.log('PROBE PORT-098 export: actual rer export and verified native archive reader -> populated retained and frozen custody decoded, no planted prompt or response content')
 console.log('genaiContentRefusalJourney passed: 32 event-name refusals, 16 unchanged accepted controls, pending and original wire, retained and archive custody, actual owner installation export; no provider calls or erasure')
}
