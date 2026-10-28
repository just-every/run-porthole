import assert from 'node:assert/strict'

export async function metricCustodyJourney({withEmptyDestination}) {
 await withEmptyDestination(async source=>{
  let cookie=await source.freshOwner()
  const root='/api/porthole/v1/metric-rules',archive='/api/porthole/v1/archive',erase='/api/porthole/v1/subject-erasure'
  const call=(path,data,session=cookie)=>fetch(source.origin+path,{method:data===undefined?'GET':'POST',headers:{cookie:session,origin:source.origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
  const post=async(path,data,status=200)=>{const response=await call(path,data);assert.equal(response.status,status,await response.clone().text());return response.json()}
  const scope={services:['custody-orders'],environments:['production'],teams:['custody-commerce']}
  const costModel={source:'synthetic-porthole-custody-rate-v1',monthlySpans:1000,bytesPerPoint:128,usdMicrosPerMillionSpans:1000000,usdMicrosPerSeriesMonth:1000,usdMicrosPerGiBMonth:1000,ceilingUsdMicros:1000000}
  const definition={name:'custody_value',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],spanName:'settle_order',kind:'sum',value:'invoice.value',unit:'USD',dimensions:[],upstream:'complete',inputStage:'pre-sampling',costModel}
  const preview=await post(root+'/preview',{definition}),rule=await post(root+'/approve',{previewId:preview.id,digest:preview.digest,confirm:'approve-metric-rule'},201)
  const sourceKey=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-custody-source',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
  const at=BigInt(Date.now())*1000000n-1000000000n,identifier='synthetic-porthole-custody-subject',range={from:String(at),through:String(at+1000000000n)}
  const packet={resourceSpans:[{resource:{attributes:[['service.name',scope.services[0]],['deployment.environment.name',scope.environments[0]],['team.name',scope.teams[0]]].map(([key,stringValue])=>({key,value:{stringValue}}))},scopeSpans:[{spans:[10.5,20.25].map((amount,i)=>({name:'settle_order',traceId:'12345678901234567890123456789012',spanId:String(i+1).padStart(16,'0'),startTimeUnixNano:String(at),endTimeUnixNano:String(at+1000000n),status:{code:2},attributes:[{key:'invoice.value',value:{doubleValue:amount}},{key:'subject',value:{stringValue:identifier}}]}))}]}]}
  const send=()=>fetch(source.origin+'/api/porthole/v1/ingest/pre-sampling/traces',{method:'POST',headers:{authorization:'Bearer '+sourceKey.secret,'content-type':'application/json'},body:JSON.stringify(packet)})
  assert.equal((await send()).status,200)
  const query=()=>post(root+'/query',{id:rule.id,revision:1,...range})
  assert.equal((await query()).groups[0].sum,30.75)
  const monitor=await post('/api/porthole/v1/objects',{kind:'monitor',name:'Custody metric threshold',scope,body:{signal:'metrics',operator:'above',threshold:20,windowSeconds:60,spanMetric:{id:rule.id,revision:1,aggregation:'sum'}}},201)
  await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
  const tick=await post('/api/v1/health/tick',{})
  const evaluated=tick.monitors.monitors.find(row=>row.monitorId===monitor.id);assert.equal(evaluated.status,'Firing');assert.equal(evaluated.observedCount,30.75)
  await post('/api/porthole/v1/objects',{kind:'monitor',name:'Foreign metric scope',scope:{...scope,services:['foreign-custody-service']},body:{signal:'metrics',operator:'above',threshold:20,windowSeconds:60,spanMetric:{id:rule.id,revision:1,aggregation:'sum'}}},403)
  const saved=await post(archive+'/exports',{},201),chunks=[]
  for(let i=0;i<saved.totalChunks;i++){const response=await call(archive+'/exports/'+saved.id+'/chunks/'+i);assert.equal(response.status,200);chunks.push(await response.json())}
  const manifest=await (await call(archive+'/exports/'+saved.id+'/manifest')).json()
  assert.equal(manifest.tables.porthole_metric_points,2);assert.equal(manifest.tables.porthole_sampling_decisions,1)
  await withEmptyDestination(async destination=>{
   const acting=await destination.freshOwner()
   const request=async(path,data,status=200)=>{const response=await fetch(destination.origin+path,{method:data===undefined?'GET':'POST',headers:{cookie:acting,origin:destination.origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.equal(response.status,status,await response.clone().text());return response.json()}
   const restore=await request(archive+'/restores',{manifest},201)
   for(const chunk of chunks)await request(archive+'/restores/'+restore.id+'/chunks',{chunk})
   await request(archive+'/restores/'+restore.id+'/commit',{confirm:manifest.rootHash})
   const frozen=await request(archive+'/exports',{},201),points=[]
   for(let i=0;i<frozen.totalChunks;i++){const chunk=await request(archive+'/exports/'+frozen.id+'/chunks/'+i);points.push(...chunk.rows.filter(row=>row.table==='porthole_metric_points').map(row=>row.row.value))}
   assert.deepEqual(points.sort((a,b)=>a-b),[10.5,20.25],'independent inactive archive preserves exact decimal points')
   const native=await request('/app/settings/credentials/mint',{name:'synthetic-porthole-restored-source',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
   const next=structuredClone(packet);next.resourceSpans[0].scopeSpans[0].spans=[{...next.resourceSpans[0].scopeSpans[0].spans[0],spanId:'0000000000000099',status:{code:1}}]
   const sent=await fetch(destination.origin+'/api/porthole/v1/ingest/pre-sampling/traces',{method:'POST',headers:{authorization:'Bearer '+native.secret,'content-type':'application/json'},body:JSON.stringify(next)})
   assert.equal(sent.status,200)
   const retained=await request('/api/porthole/v1/ingest/records?signal=traces&service='+scope.services[0]);assert.equal(retained.records.length,2);assert.ok(retained.records.every(row=>row.span_id!=='0000000000000099'),'historical error decisions cannot authorize retention of a fresh ordinary trace')
  })
  const exact=await post(erase,{identifier});assert.equal(exact.canApply,true);assert.equal(exact.records,2)
  await post(erase+'/apply',{identifier,digest:exact.digest,confirm:'wrong'},409)
  assert.equal((await query()).groups[0].sum,30.75)
  await post(erase+'/apply',{identifier,digest:exact.digest,confirm:'erase-exact-batches'})
  const after=await query();assert.deepEqual(after.groups,[]);assert.equal(after.coverage.status,'incomplete')
  const erasedTick=await post('/api/v1/health/tick',{}),unknown=erasedTick.monitors.monitors.find(row=>row.monitorId===monitor.id)
  assert.equal(unknown.status,'Unknown');assert.equal(unknown.lastKnownCount,30.75)
  assert.equal((await send()).status,409,'captured erased spans cannot restore custom metrics')
  const journal=await (await call(erase+'/journal')).json()
  await withEmptyDestination(async destination=>{
   const acting=await destination.freshOwner()
   const request=async(path,data,status=200)=>{const response=await fetch(destination.origin+path,{method:data===undefined?'GET':'POST',headers:{cookie:acting,origin:destination.origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.equal(response.status,status,await response.clone().text());return response.json()}
   await request(erase+'/journal',{...journal,confirm:'apply-erasure-journal'})
   const restore=await request(archive+'/restores',{manifest},201)
   for(const chunk of chunks)await request(archive+'/restores/'+restore.id+'/chunks',{chunk})
   await request(archive+'/restores/'+restore.id+'/commit',{confirm:manifest.rootHash})
   await request(root+'/query',{id:rule.id,revision:1,...range},404)
   const listed=await request(root);assert.equal(listed.rules[0].state,'quarantined')
   const renewed=await request(root+'/preview',{id:rule.id,revision:1,definition}),enabled=await request(root+'/approve',{previewId:renewed.id,digest:renewed.digest,confirm:'approve-metric-rule'},201)
   const empty=await request(root+'/query',{id:enabled.id,revision:2,...range});assert.deepEqual(empty.groups,[])
   const retained=await request('/api/porthole/v1/ingest/records?signal=traces&service='+scope.services[0]);assert.deepEqual(retained.records,[])
   const rows=await destination.sql('SELECT COUNT(*) AS n FROM porthole_metric_points');assert.equal(rows[0].n,0)
   const decisions=await destination.sql('SELECT COUNT(*) AS n FROM porthole_sampling_decisions');assert.equal(decisions[0].n,0)
  })
 })
 console.log('metricCustodyJourney passed: pinned custom-metric monitor, exact decimal archive points, reviewed erasure, Unknown instead of substituted RED, captured retry refusal and later-journal inactive restore')
}
