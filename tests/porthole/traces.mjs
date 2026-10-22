import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {form} from './fixture.mjs'
import {healthBrowser} from './health.mjs'
const execute=promisify(execFile)
const path='/api/porthole/v1/traces/'

export async function traceJourney({origin,freshOwner,signIn,restartWorker,sql}) {
 let cookie=await freshOwner()
 const post=async(route,data,status=200,acting=cookie)=>{const response=await fetch(origin+route,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.json()}
 const get=async(route,acting=cookie)=>{const response=await fetch(origin+route,{headers:{cookie:acting}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const scope={services:['checkout','python','java','go','dotnet','ruby','php'],environments:['production'],teams:['commerce']}
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1100',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
 // A subprocess imports the shipped register module before any HTTP/gRPC
 // client/server. No span payloads or expected timings are generated here.
 const {polyglotEstate}=process.env.PORTHOLE_POLYGLOT==='1'?await import('./polyglot/estate.mjs'):{polyglotEstate:null}
 const estate=polyglotEstate?await polyglotEstate():null
 let child
 try {child=await execute(process.execPath,['tests/porthole/polyglot/node.cjs'],{timeout:60000,env:{...process.env,
  OTEL_SERVICE_NAME:'checkout',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-1101',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:origin+'/v1/traces',OTEL_EXPORTER_OTLP_PROTOCOL:'http/protobuf',OTEL_EXPORTER_OTLP_HEADERS:'authorization=Bearer '+source.secret,
  OTEL_TRACES_SAMPLER:'always_on',OTEL_PROPAGATORS:'tracecontext',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',...(estate?await estate.environment({origin,secret:source.secret}):{})}})}finally{if(estate)await estate.stop()}
 const receipt=JSON.parse(child.stdout.trim().split('\n').at(-1)),traceId=receipt.traceId
 assert.match(traceId,/^[a-f0-9]{32}$/)
 let pending=1
 for(let pass=0;pass<10&&pending;pass++){const drain=await post('/api/porthole/v1/ingest/drain',{});assert.ok(drain.processedBatches<=20);pending=drain.pendingBatches}
 assert.equal(pending,0,'bounded public drains reconcile the whole real runtime estate')
 let graph=await get(path+traceId)
 if(graph.status!=='Connected')console.log('Unexpected trace topology: '+JSON.stringify({diagnostics:graph.diagnostics,spans:graph.spans.map(({spanId,parentSpanId,service,name,kind,diagnostics})=>({spanId,parentSpanId,service,name,kind,diagnostics}))}))
 assert.equal(graph.status,'Connected');assert.equal(graph.truncated,false);assert.ok(graph.spans.length>=13,'HTTP/gRPC clients and servers plus root were automatically recorded')
 assert.equal(graph.spans.filter(span=>!span.parentSpanId).length,1)
 const native=graph.spans.filter(span=>span.service==='checkout'&&!span.instrumentation.name?.includes('kafkajs'))
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
  console.log('polyglotEstate passed on '+process.env.PORTHOLE_CANDIDATE_SHA+': seven runtimes, real Kafka, HTTP/gRPC and one connected graph')
 }
 const broken=await get(path+receipt.brokenTraceId)
 assert.equal(broken.status,'Incomplete')
 assert.ok(broken.diagnostics.includes('missing_or_out_of_scope_parent'),'the actual TCP propagation boundary is exposed')
 assert.ok(broken.spans.some(span=>span.parentSpanId==='00000000000000ff'&&span.parent===null))
 await healthBrowser({origin,cookie,path:'/app/traces/'+receipt.brokenTraceId,name:'trace-runtime-broken-boundary',contains:'missing or out of scope parent'})
 const original=structuredClone(graph),snapshot=graph.snapshot
 await restartWorker();cookie=await freshOwner()
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
 console.log('traceJourney passed: actual stock Node HTTP/gRPC instrumentation, async fanout, original graph/ns/restart/snapshot, explicit conflicting/missing/cyclic parent diagnostics, live scope/revocation and 1440/390 states; seven-language/Kafka qualification remains pending')
}
