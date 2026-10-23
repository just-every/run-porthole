import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {form} from './fixture.mjs'
import {healthBrowser} from './health.mjs'
const execute=promisify(execFile)
const path='/api/porthole/v1/traces/'

export async function traceJourney({origin,freshOwner,signIn,restartWorker,sql,withEmptyDestination}) {
 let cookie=await freshOwner()
 const post=async(route,data,status=200,acting=cookie)=>{const response=await fetch(origin+route,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.json()}
 const get=async(route,acting=cookie)=>{const response=await fetch(origin+route,{headers:{cookie:acting}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const scope={services:['checkout','python','java','go','dotnet','ruby','php'],environments:['production'],teams:['commerce','fulfillment']}
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1100',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
 // A subprocess imports the shipped register module before any HTTP/gRPC
 // client/server. No span payloads or expected timings are generated here.
 const policyRoute='/app/settings/instrumentation'
 const policyGet=async()=>{const response=await fetch(origin+policyRoute,{headers:{cookie,accept:'application/json'}});assert.equal(response.status,200);return response.json()}
 let policy=await policyGet()
 assert.equal(policy.enabled,false);assert.deepEqual(policy.allowedKeys,[]);assert.deepEqual(policy.attributeKeys,[])
 assert.equal((await fetch(origin+policyRoute)).status,401)
 assert.equal((await fetch(origin+policyRoute,{headers:{authorization:'Bearer '+source.secret}})).status,403)
 const policyInput={revision:policy.revision,enabled:true,allowedKeys:['region','routing','large','edge','email','auth','customer-name','secret','token',...Array.from({length:10},(_,i)=>'k'+i)],attributeKeys:['region'],confirm:'apply-baggage-policy'}
 const configured=await post(policyRoute,policyInput)
 assert.equal(configured.enabled,true)
 await post(policyRoute,policyInput,409)
 await post(policyRoute,{...policyInput,revision:configured.revision,attributeKeys:['unlisted']},400)
 const foreign=await fetch(origin+policyRoute,{...form(origin,cookie,{...policyInput,revision:configured.revision}),headers:{...form(origin,cookie,{}).headers,origin:'https://foreign.example'}})
 assert.equal(foreign.status,403)
 const admin=await signIn('synthetic-porthole-10@example.com')
 assert.equal((await fetch(origin+policyRoute,{headers:{cookie:admin}})).status,403)
 await healthBrowser({origin,cookie:admin,path:policyRoute,name:'baggage-admin-denied',contains:'owner required',expectedStatus:403})
 cookie=await freshOwner()
 await policyBrowser({origin,cookie,policyInput})
 policy=await policyGet()
 const download=await fetch(origin+policyRoute+'/policy.json',{headers:{cookie}})
 assert.equal(download.status,200);assert.deepEqual(await download.json(),policy)
 const scratch=await mkdtemp(join(tmpdir(),'porthole-baggage-')),policyPath=join(scratch,'policy.json')
 await writeFile(policyPath,JSON.stringify(policy),{mode:0o600})
 const baggageProbe={region:'synthetic-porthole-1200',routing:'synthetic-porthole-1201',large:'é'.repeat(129),edge:'é'.repeat(128),email:'synthetic-porthole-1202',auth:'synthetic-porthole-1203','customer-name':'synthetic-porthole-1204',secret:'synthetic-porthole-1205',token:'synthetic-porthole-1206',unlisted:'synthetic-porthole-1207',...Object.fromEntries(Array.from({length:10},(_,i)=>['k'+i,'synthetic-porthole-'+(1210+i)]))}
 const runtimeEnv={...process.env,OTEL_SERVICE_NAME:'checkout',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-1101',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:origin+'/v1/traces',OTEL_EXPORTER_OTLP_PROTOCOL:'http/protobuf',OTEL_EXPORTER_OTLP_HEADERS:'authorization=Bearer '+source.secret,OTEL_TRACES_SAMPLER:'always_on',OTEL_PROPAGATORS:'tracecontext',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',PORTHOLE_BAGGAGE_PROBE:JSON.stringify(baggageProbe)}
 const baselineChild=await execute(process.execPath,['tests/porthole/polyglot/node.cjs'],{timeout:60000,env:{...runtimeEnv,PORTHOLE_BAGGAGE_POLICY:join(scratch,'missing.json')}})
 const baseline=JSON.parse(baselineChild.stdout.trim().split('\n').at(-1))
 assert.ok(baseline.observed.length>0);assert.ok(baseline.observed.every(row=>Object.keys(row.entries).length===0),'missing policy fails closed across actual Node HTTP/gRPC')
 assert.match(baselineChild.stderr,/policy_unavailable/);assert.match(baselineChild.stderr,/disabled/)
 const {polyglotEstate}=process.env.PORTHOLE_POLYGLOT==='1'?await import('./polyglot/estate.mjs'):{polyglotEstate:null}
 const estate=polyglotEstate?await polyglotEstate():null
 const candidate=(await execute('git',['rev-parse','HEAD'])).stdout.trim()
 if(process.env.PORTHOLE_CANDIDATE_SHA)assert.equal(candidate,process.env.PORTHOLE_CANDIDATE_SHA)
 let child,estateProof=[]
 try {
  const estateEnv=estate?await estate.environment({origin,secret:source.secret,policyPath}):{}
  if(estate){
   const header=Object.entries(baggageProbe).map(([key,value])=>key+'='+encodeURIComponent(value)).join(',')
   estateProof=await estate.probe(header)
   for(const row of estateProof){assert.equal(row.keys.length,8,row.language+' enforces eight-entry limit');assert.ok(row.keys.every(key=>policy.allowedKeys.includes(key)&&!['large','email','auth','customer-name','secret','token','unlisted'].includes(key)),row.language+' refuses sensitive/unlisted/oversize values');assert.ok(row.maxBytes<=256,row.language+' limits decoded UTF-8 bytes')}
   for(const row of await estate.probe('edge='+encodeURIComponent('é'.repeat(128))+',large='+encodeURIComponent('é'.repeat(129)))){assert.deepEqual(row.keys,['edge'],row.language+' accepts exactly 256 decoded UTF-8 bytes and refuses 258');assert.equal(row.maxBytes,256)}
  }
  child=await execute(process.execPath,['tests/porthole/polyglot/node.cjs'],{timeout:60000,env:{...runtimeEnv,PORTHOLE_BAGGAGE_POLICY:policyPath,...estateEnv}})
  if(estate){
   for(const row of await estate.probe('region=synthetic-porthole-1200,region=synthetic-porthole-1201,routing=%ZZ,invalid'))assert.deepEqual(row.keys,[],row.language+' refuses conflicting and malformed baggage without a merge')
   await writeFile(policyPath,JSON.stringify({...policy,enabled:false}));await estate.restartServices()
   for(const row of await estate.probe('region=synthetic-porthole-1200'))assert.deepEqual(row.keys,[],row.language+' enforces owner-disabled baggage')
   await writeFile(policyPath,'{invalid');await estate.restartServices()
   for(const row of await estate.probe('region=synthetic-porthole-1200'))assert.deepEqual(row.keys,[],row.language+' fails closed with an invalid policy')
  }
  if(estate)for(const row of await estate.diagnostics()){assert.match(row.output,/porthole.baggage/,row.language+' exposes refusal diagnostics');for(const value of ['synthetic-porthole-1202','synthetic-porthole-1203','synthetic-porthole-1204','synthetic-porthole-1205','synthetic-porthole-1206','synthetic-porthole-1207'])assert.ok(!row.output.includes(value),row.language+' diagnostics exclude refused values')}
 }finally{if(estate)await estate.stop();await rm(scratch,{recursive:true,force:true})}
 const receipt=JSON.parse(child.stdout.trim().split('\n').at(-1)),traceId=receipt.traceId
 assert.match(traceId,/^[a-f0-9]{32}$/)
 assert.ok(receipt.observed.some(row=>row.boundary==='http'));assert.ok(receipt.observed.some(row=>row.boundary==='grpc'))
 if(estate)assert.ok(receipt.observed.some(row=>row.boundary==='kafka'))
 for(const row of receipt.observed){const keys=Object.keys(row.entries);assert.ok(keys.length>0&&keys.length<=8);assert.ok(keys.every(key=>policy.allowedKeys.includes(key)&&!['large','email','auth','customer-name','secret','token','unlisted'].includes(key)));assert.ok(Object.values(row.entries).every(value=>Buffer.byteLength(value)<=256))}
 for(const value of ['synthetic-porthole-1202','synthetic-porthole-1203','synthetic-porthole-1204','synthetic-porthole-1205','synthetic-porthole-1206','synthetic-porthole-1207'])assert.ok(!child.stderr.includes(value),'Node refusal diagnostics exclude values')
 assert.match(child.stderr,/sensitive_key/);assert.match(child.stderr,/entry_limit/);assert.match(child.stderr,/value_too_large/)
 let pending=1
 for(let pass=0;pass<10&&pending;pass++){const drain=await post('/api/porthole/v1/ingest/drain',{});assert.ok(drain.processedBatches<=20);pending=drain.pendingBatches}
 assert.equal(pending,0,'bounded public drains reconcile the whole real runtime estate')
 let graph=await get(path+traceId)
 if(graph.status!=='Connected')console.log('Intake accounting: '+JSON.stringify((await get('/api/porthole/v1/ingest/status')).sources.map(({service,accepted,pending,rejected,reasons})=>({service,accepted,pending,rejected,reasons}))))
 if(graph.status!=='Connected')console.log('Unexpected trace topology: '+JSON.stringify({diagnostics:graph.diagnostics,spans:graph.spans.map(({spanId,parentSpanId,service,name,kind,diagnostics})=>({spanId,parentSpanId,service,name,kind,diagnostics}))}))
 assert.equal(graph.status,'Connected');assert.equal(graph.truncated,false);assert.ok(graph.spans.length>=13,'HTTP/gRPC clients and servers plus root were automatically recorded')
 assert.equal(graph.spans.filter(span=>!span.parentSpanId).length,1)
 const baselineGraph=await get(path+baseline.traceId)
 assert.ok(baselineGraph.spans.every(span=>!span.attributes.some(attr=>attr.key.startsWith('baggage.'))),'disabled policy never copies baggage to attributes')
 assert.ok(graph.spans.some(span=>span.attributes.some(attr=>attr.key==='baggage.region'&&attr.value.stringValue===baggageProbe.region)),'separate attribute allowlist permits approved Node capture')
 assert.ok(graph.spans.every(span=>!span.attributes.some(attr=>attr.key.startsWith('baggage.')&&attr.key!=='baggage.region')),'forwarding alone grants no span capture')
 assert.ok(graph.spans.some(span=>span.events.some(event=>event.name==='porthole.baggage.refused')),'value-free refusals are visible in the trace API/waterfall')
 const byId=new Map(graph.spans.map(span=>[span.spanId,span]))
 const messagingAncestor=span=>{for(let current=span;current;current=byId.get(current.parentSpanId))if(current.instrumentation.name?.includes('kafkajs'))return true;return false}
 const native=graph.spans.filter(span=>span.service==='checkout'&&!messagingAncestor(span))
 if(estate)assert.equal(graph.spans.filter(span=>span.service==='checkout'&&span.kind===3&&messagingAncestor(span)).length,1,'the Kafka consumer makes one additional real HTTP call into Python')
 assert.equal(native.length,13,'known root plus four HTTP and two gRPC client/server pairs')
 assert.deepEqual(native.map(span=>span.depth).sort((a,b)=>a-b),[0,1,2,3,3,3,3,3,4,4,4,4,4],'known fanout topology is exact')
 assert.ok(native.some(span=>span.status.code===2&&span.attributes.some(attr=>['http.response.status_code','http.status_code'].includes(attr.key)&&Number(attr.value.intValue)===503)),'actual HTTP errors survive')
 assert.ok(native.some(span=>span.status.code===2&&span.attributes.some(attr=>attr.key==='rpc.grpc.status_code'&&Number(attr.value.intValue)===14)),'actual gRPC errors survive')
 assert.ok(graph.spans.every(span=>span.parentSpanId===null||graph.spans.some(parent=>parent.spanId===span.parentSpanId)))
 assert.ok(graph.spans.filter(span=>span.service==='checkout'&&span.name!=='checkout.transaction').every(span=>span.instrumentation.name?.includes('instrumentation')))
 assert.ok(graph.spans.some(span=>span.attributes.some(attr=>attr.key==='rpc.system'&&attr.value.stringValue==='grpc')))
 assert.ok(graph.spans.every(span=>span.resource.attributes.some(attr=>attr.key==='service.version'&&attr.value.stringValue==='synthetic-porthole-1101')))
 const root=graph.spans.find(span=>span.name==='checkout.transaction')
 assert.ok(BigInt(root.durationNs)>0n&&BigInt(root.durationNs)<=BigInt(receipt.elapsedNs),'original observed root timing is not synthesized from arrival')
 const clients=graph.spans.filter(span=>span.kind===3)
 assert.ok(clients.some((span,index)=>clients.some((other,j)=>index!==j&&BigInt(span.startTimeNs)<BigInt(other.endTimeNs)&&BigInt(other.startTimeNs)<BigInt(span.endTimeNs))),'async fanout overlaps in actual captured time')
 if(estate){
  assert.deepEqual([...new Set(graph.spans.map(span=>span.service))].sort(),scope.services.slice().sort(),'all seven real runtimes participate in one trace')
  assert.ok(graph.spans.some(span=>span.attributes.some(attr=>['messaging.system'].includes(attr.key)&&attr.value.stringValue==='kafka')),'actual stock Kafka producer/consumer spans')
  console.log('polyglotEstate passed on '+candidate+': seven runtimes, real Kafka, HTTP/gRPC and one connected graph')
 }
 const broken=await get(path+receipt.brokenTraceId)
 assert.equal(broken.status,'Incomplete')
 assert.ok(broken.diagnostics.includes('missing_or_out_of_scope_parent'),'the actual TCP propagation boundary is exposed')
 assert.ok(broken.spans.some(span=>span.parentSpanId==='00000000000000ff'&&span.parent===null))
 await healthBrowser({origin,cookie,path:'/app/traces/'+receipt.brokenTraceId,name:'trace-runtime-broken-boundary',contains:'missing or out of scope parent'})
 if(estate){
  assert.deepEqual([...new Set(graph.spans.map(span=>span.team))].sort(),['commerce','fulfillment'])
  const email='synthetic-porthole-1131@example.com'
  await post('/app/settings/members/invite',{email,displayName:'Fulfillment trace analyst',role:'read-only analyst',scope:{services:['php'],environments:['production'],teams:['fulfillment']}},202)
  const restricted=await signIn(email),scoped=await get(path+traceId,restricted)
  assert.ok(scoped.recordCount>0);assert.ok(scoped.spans.every(span=>span.service==='php'&&span.team==='fulfillment'))
  assert.ok(scoped.diagnostics.includes('missing_or_out_of_scope_parent'))
  await healthBrowser({origin,cookie:restricted,path:'/app/traces/'+traceId,name:'trace-real-team-boundary',contains:'missing or out of scope parent'})
 }
 const original=structuredClone(graph),snapshot=graph.snapshot
 await restartWorker();cookie=await freshOwner();assert.deepEqual(await policyGet(),policy,'owner policy survives restart')
 assert.deepEqual(await get(path+traceId+'?snapshot='+snapshot),original,'trace and original nanoseconds survive Worker restart')
 await healthBrowser({origin,cookie,path:'/app/traces/'+traceId,name:'trace-connected',contains:'Connected'})
 // Official OTLP v1.9 schema edges prove malformed/conflicting propagation;
 // these are protocol probes, not substitutes for runtime instrumentation.
 const raw=(spanId,parentSpanId,name,start='1000000001',end='1000010001')=>({traceId,spanId,parentSpanId,name,kind:2,startTimeUnixNano:start,endTimeUnixNano:end})
 const send=async(spans,id)=>{
  const payload={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'checkout'}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team.name',value:{stringValue:'commerce'}}]},scopeSpans:[{scope:{name:'synthetic-porthole-1102'},spans}]}]}
  const response=await fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':id},body:JSON.stringify(payload)})
  assert.equal(response.status,200,await response.clone().text());await post('/api/porthole/v1/ingest/drain',{})
 }
 const missing='0000000000000001',conflict='0000000000000002',dependent='0000000000000003',cycleA='0000000000000004',cycleB='0000000000000005'
 await send([raw(missing,'000000000000000f','broken boundary'),raw(conflict,root.spanId,'first identity'),raw(conflict,root.spanId,'different identity'),raw(dependent,conflict,'ambiguous child'),raw(cycleA,cycleB,'cycle A'),raw(cycleB,cycleA,'cycle B')],'synthetic-porthole-1103')
 graph=await get(path+traceId)
 assert.equal(graph.status,'Incomplete')
 assert.deepEqual(graph.spans.filter(span=>span.spanId===conflict).map(span=>span.conflict),[true,true])
 assert.ok(graph.spans.filter(span=>[missing,conflict,dependent,cycleA,cycleB].includes(span.spanId)).every(span=>span.parent===null),'broken/conflicting/cyclic graph is never silently attached')
 for(const diagnostic of ['conflicting_span_identity','missing_or_out_of_scope_parent','ambiguous_parent_identity','cyclic_parent_links'])assert.ok(graph.diagnostics.includes(diagnostic))
 assert.deepEqual(await get(path+traceId+'?snapshot='+snapshot),original,'frozen snapshot excludes later conflicting evidence')
 await healthBrowser({origin,cookie,path:'/app/traces/'+traceId,name:'trace-propagation-incomplete',contains:'Propagation diagnostics'})
 for(const [name,route,contains,status] of [['empty','/app/traces','No trace selected',200],['not-found','/app/traces/'+'f'.repeat(32),'No retained spans found',200],['invalid','/app/traces/bad','invalid trace id',400]])await healthBrowser({origin,cookie,path:route,name:'trace-'+name,contains,expectedStatus:status})
 const read=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1104',class:'read',scope:{...scope,signals:['traces'],actions:['telemetry.read']}},201)
 const bearer=()=>fetch(origin+path+traceId,{headers:{authorization:'Bearer '+read.secret}})
 assert.equal((await bearer()).status,200)
 await post('/app/settings/credentials/revoke',{id:read.credential.id})
 assert.equal((await bearer()).status,401,'next-request credential revocation')
 assert.equal((await fetch(origin+path+traceId)).status,401)
 assert.equal((await fetch(origin+path+'bad',{headers:{cookie}})).status,400)
 await healthBrowser({origin,path:'/app/traces/'+traceId,name:'trace-unauthenticated',contains:'unauthenticated',expectedStatus:401})
 const email='synthetic-porthole-1105@example.com'
 await post('/app/settings/members/invite',{email,displayName:'Payments analyst',role:'read-only analyst',scope:{services:['payments'],environments:['production'],teams:['commerce']}},202)
 const restricted=await signIn(email),hidden=await get(path+traceId,restricted)
 assert.equal(hidden.recordCount,0,'no cross-service existence or graph leakage')
 await healthBrowser({origin,cookie:restricted,path:'/app/traces/'+traceId,name:'trace-scope-empty',contains:'No retained spans found'})
 const financial='synthetic-porthole-1106@example.com'
 await post('/app/settings/members/invite',{email:financial,displayName:'Finance reader',role:'finance reader',scope},202)
 const finance=await signIn(financial)
 assert.equal((await fetch(origin+path+traceId,{headers:{cookie:finance}})).status,403)
 await healthBrowser({origin,cookie:finance,path:'/app/traces/'+traceId,name:'trace-forbidden',contains:'telemetry forbidden',expectedStatus:403})
 // An actual storage failure yields persistent feedback and keeps auth private.
 await restartWorker(()=>sql('ALTER TABLE porthole_telemetry_records RENAME TO synthetic_porthole_unavailable_traces'))
 try {assert.equal((await fetch(origin+path+traceId,{headers:{cookie}})).status,503);await healthBrowser({origin,cookie,path:'/app/traces/'+traceId,name:'trace-unavailable',contains:'telemetry unavailable',expectedStatus:503})}
 finally {await restartWorker(()=>sql('ALTER TABLE synthetic_porthole_unavailable_traces RENAME TO porthole_telemetry_records'))}
 const {traceArchiveJourney}=await import('./archive.mjs')
 await traceArchiveJourney({origin,cookie:await freshOwner(),traceId,snapshot,expected:original,withEmptyDestination})
 console.log('traceJourney passed: actual stock Node HTTP/gRPC instrumentation, async fanout, original graph/ns/restart/snapshot, explicit conflicting/missing/cyclic parent diagnostics, live scope/revocation and 1440/390 states; seven-language/Kafka qualification '+(estate?'passed on '+candidate:'runs separately outside Verify'))
}

async function policyBrowser({origin,cookie,policyInput}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+'/app/settings/instrumentation')
  await page.getByLabel('Forwarded keys').fill(policyInput.allowedKeys.join(', '));await page.getByLabel('Span attribute keys').fill('region');await page.getByLabel('Baggage forwarding').selectOption('true');await page.getByLabel('I approve this exact').check()
  await Promise.all([page.waitForURL(origin+'/app/settings/instrumentation'),page.getByRole('button',{name:'Save reviewed policy'}).click()])
  assert.match(await page.locator('body').innerText(),/Baggage enabled by owner/)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'policy form reflows')
  assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(button=>!button.textContent.trim()).length),0,'the touched Settings screen has no icon-only controls')
  await page.getByLabel('Forwarded keys').focus();assert.equal(await page.getByLabel('Forwarded keys').evaluate(input=>input===document.activeElement),true)
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'baggage-owner-policy-'+width+'.png'),fullPage:true})}
  await context.close()
 }}finally{await browser.close()}
}
