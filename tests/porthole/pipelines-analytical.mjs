import assert from 'node:assert/strict'
import {analyticalEstate} from './analytics.mjs'
import {recipientMailJourney} from './health.mjs'
export async function pipelineAnalyticalJourney() {
 const estate=await analyticalEstate()
 try {
  await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
   const {post,call,cookie,restart}=context
   const value=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
   const d={service:'checkout-pipeline',environment:'production',team:'payments',processors:[{type:'json'}],metrics:[{name:'checkout.logs'}],redaction:[{pattern:'private-[0-9]{4}',exceptions:['private-0000']}],exclude:{field:'level',equals:'debug'}}
   const preview=await (await post('/api/porthole/v1/pipelines/preview',{definition:d,revision:0,samples:[]},201)).json()
   await post('/api/porthole/v1/pipelines/activate',{previewId:preview.id,digest:preview.digest,confirm:'activate-pipeline'},201)
   const config=await value(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}}))
   await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
   const scope={services:[d.service],environments:[d.environment],teams:[d.team]}
   const source=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-12100',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}},201)).json()
   const credential='synthetic-porthole-12101'
   const planted=['123'+'-45-'+'6789','4111'+'1111'+'1111'+'1111','(415) 555'+'-0123',['synthetic-porthole-12102','example.invalid'].join(String.fromCharCode(64)),'192'+'.0.2.17','2001'+':db8:abcd:12::8','Bearer '+credential,Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from('{"private":"synthetic-porthole-12103"}').toString('base64url')+'.synthetic-porthole-12104'],at=BigInt(Date.now())*1000000n
   const packet={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:d.service}},{key:'deployment.environment.name',value:{stringValue:d.environment}},{key:'team.name',value:{stringValue:d.team}}]},scopeLogs:[{logRecords:[...planted.map((secret,i)=>({timeUnixNano:String(at+BigInt(i)),body:{stringValue:JSON.stringify({message:'Checkout privacy '+secret,level:'info',api_key:credential,custom:'private-1234 private-0000',numericIdentifier:Number('987'+'654'+'321'),'http.request.header.x-api-key':credential,'db.password':credential,'aws.secret_access_key':credential,'http.request.header.x-amz-security-token':credential,'http.request.header.x-goog-api-key':credential,'http.request.header.ocp-apim-subscription-key':credential})}})),{timeUnixNano:String(at+BigInt(planted.length)),body:{stringValue:JSON.stringify({message:'Checkout debug',level:'debug'})}}]}]}]}
   const maskedValues=planted.concat(credential,'private-1234','987'+'654'+'321')
   const ingest=()=>call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(packet)})
   assert.equal((await ingest()).status,200)
   const drained=await (await post('/api/porthole/v1/ingest/drain',{})).json();assert.equal(drained.analytical.complete,true,JSON.stringify(drained.analytical))
   for(const path of ['/api/porthole/v1/ingest/records','/api/porthole/v1/ingest/archive']){
    const result=await value(await call(path+'?signal=logs&service='+d.service,{headers:{cookie}}))
    assert.equal(result.records.length,planted.length);assert.equal(result.analytical.role,'primary')
    for(const secret of maskedValues)assert.ok(!JSON.stringify(result).includes(secret),'query exposes only sanitized analytical data')
   }
   for(const role of ['primary','standby']){
    const rows=await estate.inspect(role)
    assert.equal(rows.length,planted.length,'both physical analytical replicas receive accepted records')
    assert.ok(JSON.stringify(rows).includes('private-0000'),'approved custom exception survives both analytical copies')
    for(const secret of maskedValues)assert.ok(!JSON.stringify(rows).includes(secret),'no planted values in analytical durable payload')
   }
   const traceId='9a'.repeat(16),spanId='8b'.repeat(8),spanAt=at+100n
   const spanPacket={resourceSpans:[{resource:packet.resourceLogs[0].resource,scopeSpans:[{spans:[{
    traceId,spanId,name:'Checkout span '+planted[1],startTimeUnixNano:String(spanAt),endTimeUnixNano:String(spanAt+1000n),
    attributes:[{key:'sensitive',value:{arrayValue:{values:planted.map(stringValue=>({stringValue}))}}},{key:'numericIdentifier',value:{doubleValue:Number('987'+'654'+'321')}},{key:'aws.secret_access_key',value:{stringValue:credential}},{key:'http.request.header.ocp-apim-subscription-key',value:{stringValue:credential}},{key:'custom',value:{stringValue:'private-1234 private-0000'}}],
    links:[{traceId:'9a'.repeat(16),spanId:'1'.repeat(16),attributes:[{key:'aws.secret_access_key',value:{stringValue:credential}}]}],
    events:[{name:'db.password='+credential,timeUnixNano:String(spanAt),attributes:[{key:'ssn',value:{doubleValue:42}}]}]
   }]}]}]}
   const ingestSpan=()=>call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(spanPacket)})
   assert.equal((await ingestSpan()).status,200)
   const traceDrain=await (await post('/api/porthole/v1/ingest/drain',{})).json();assert.equal(traceDrain.analytical.complete,true,JSON.stringify(traceDrain.analytical))
   const trace=await value(await call('/api/porthole/v1/traces/'+traceId,{headers:{cookie}}))
   assert.equal(trace.spans.length,1);assert.equal(trace.spans[0].spanId,spanId);assert.equal(trace.spans[0].startTimeNs,String(spanAt));assert.equal(trace.spans[0].name,'Checkout span [REDACTED]')
   for(const path of ['/api/porthole/v1/ingest/records','/api/porthole/v1/ingest/archive']){
    const result=await value(await call(path+'?signal=traces&service='+d.service,{headers:{cookie}}))
    assert.equal(result.records.length,1);assert.equal(result.analytical.role,'primary')
    for(const secret of maskedValues)assert.ok(!JSON.stringify(result).includes(secret),'native span reads expose only sanitized analytical data')
   }
   for(const role of ['primary','standby']){
    const rows=await estate.inspect(role),spans=rows.filter(row=>row.signal==='traces')
    assert.equal(rows.length,planted.length+1);assert.equal(spans.length,1)
    const retained=JSON.parse(spans[0].payload)
    assert.equal(retained.record.traceId,traceId);assert.equal(retained.record.spanId,spanId)
    assert.equal(retained.record.events[0].timeUnixNano,String(spanAt),'event clocks remain original nanoseconds after redaction')
    assert.equal(retained.record.links[0].spanId,'1'.repeat(16),'link identities remain usable after redaction')
    assert.equal(retained.record.links[0].attributes[0].value.stringValue,'[REDACTED]','preserving link identity cannot revive link credential attributes')
    assert.equal(retained.record.events[0].attributes[0].value.stringValue,'[REDACTED]','sensitive numeric event attributes are masked in physical span custody')
    assert.ok(JSON.stringify(spans).includes('private-0000'),'approved custom exception survives physical span custody')
    for(const secret of maskedValues)assert.ok(!JSON.stringify(spans).includes(secret),'no sensitive span values in either physical analytical replica')
   }
   const totals=await (await post('/api/porthole/v1/pipelines/metrics',{definition:d,from:String(at),through:String(at+10n)})).json()
   assert.equal(totals.groups[0].count,planted.length+1,'analytical exclusion keeps configured pre-exclusion metric totals')
   await restart();const retry=await ingest();assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')
   await post('/api/porthole/v1/ingest/drain',{})
   assert.equal((await ingestSpan()).headers.get('x-porthole-duplicate'),'true','span replay after restart retains its sanitized source identity')
   await post('/api/porthole/v1/ingest/drain',{})
   for(const role of ['primary','standby'])assert.equal((await estate.inspect(role)).length,planted.length+1,'analytical replay after restart creates no copies')
   await post('/app/settings/credentials/revoke',{id:source.credential.id,revision:source.credential.revision})
   assert.equal((await ingestSpan()).status,401,'revoked sources cannot add new physical span custody')
   for(const role of ['primary','standby'])assert.equal((await estate.inspect(role)).length,planted.length+1,'refused span intake leaves analytical copies unchanged')
  }})
 }finally{await estate.dispose()}
 console.log('pipelineAnalyticalJourney passed: real log and span custody in primary and standby, native query, restart replay and revoked-source refusal')
}
