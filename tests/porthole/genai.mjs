import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {gzipSync} from 'node:zlib'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const execute=promisify(execFile),api='/api/porthole/v1/genai',marker='synthetic-porthole-2701-sensitive-content'

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
 const before=await count()
 for(const [index,packet]of probes.entries()){
  const response=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json',...(index%2?{'content-encoding':'gzip'}:{})},body:index%2?gzipSync(JSON.stringify(packet)):JSON.stringify(packet)})
  assert.equal(response.status,400);assert.equal((await response.json()).message,'genai_content_not_authorized')
 }
 const unsafeLog={resourceLogs:[{resource:structuredClone(model.payload.resource),scopeLogs:[{logRecords:[{timeUnixNano:'1',attributes:[{key:'gen_ai.system',value:{stringValue:'openai'}}],body:{stringValue:marker}}]}]}]}
 assert.equal((await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(unsafeLog)})).status,400)
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
