import assert from 'node:assert/strict'
export async function splunkReplayJourney({origin,cookie,capture,member,foreignCookie}){
 const post=(path,data,session=cookie,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json',...extra},body:JSON.stringify(data)})
 const scope={service:'checkout',environment:'test',team:'ops'}
 const mint=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-4310',class:'ingest',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.write']}})
 assert.equal(mint.status,201,await mint.clone().text());const source=await mint.json()
 const start=BigInt(Date.now()-6000)*1000000n
 const from=String(start),through=String(start+2000000000n)
 const resources=['a','b'].map((instance,index)=>({resource:{attributes:Object.entries({'service.name':scope.service,'deployment.environment.name':scope.environment,'team.name':scope.team,'service.instance.id':instance}).map(([key,value])=>({key,value:{stringValue:value}}))},scopeMetrics:[{scope:{name:'synthetic-porthole-4311'},metrics:[{name:'requests',unit:'{request}',gauge:{dataPoints:[2+index*2,18+index*4,2+index*2].map((asDouble,offset)=>({timeUnixNano:String(start+BigInt(offset)*1000000000n),asDouble}))}}]}]}))
 const intake=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-4312'},body:JSON.stringify({resourceMetrics:resources})})
 assert.equal(intake.status,200,await intake.clone().text())
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const body={...scope,from,through,targetId:'splunk:detectors:synthetic-porthole-106'}
 const route='/api/porthole/v1/migration/replay'
 assert.equal((await post(route,body,'')).status,401)
 assert.equal((await post(route,body,member)).status,403)
 assert.equal((await post(route,body,foreignCookie)).status,401)
 assert.equal((await post(route,body,cookie,{origin:'https://foreign.invalid'})).status,403)
 const response=await post(route,body);assert.equal(response.status,200,await response.clone().text())
 const replay=await response.json()
 assert.deepEqual(replay.points.map(p=>({value:p.value,active:p.active,series:p.series})),[{value:3,active:false,series:2},{value:20,active:true,series:2},{value:3,active:false,series:2}])
 assert.deepEqual(replay.points.map(p=>BigInt(p.time).toString()),[0n,1n,2n].map(offset=>String(start+offset*1000000000n)))
 assert.equal(replay.sourceId,'synthetic-porthole-106');assert.ok(replay.queryRef);assert.equal(replay.notifications,'inactive')
 const extraPoints=[
  {gauge:{dataPoints:[{timeUnixNano:String(start-1000000000n),asDouble:0,flags:1}]}},
  {gauge:{dataPoints:[{timeUnixNano:String(start-2000000000n),asInt:'9007199254740993'}]}},
  {gauge:{dataPoints:[{timeUnixNano:String(start-3000000000n),asDouble:2},{timeUnixNano:String(start-3000000000n),asDouble:2}]}},
  {sum:{aggregationTemporality:2,isMonotonic:true,dataPoints:[{timeUnixNano:String(start-4000000000n),asInt:'2'}]}}
 ]
 const invalidSamples={resourceMetrics:[{resource:resources[0].resource,scopeMetrics:[{scope:{name:'synthetic-porthole-4311'},metrics:extraPoints.map(value=>({name:'requests',unit:'{request}',...value}))}]}]}
 const refusedSamples=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-4313'},body:JSON.stringify(invalidSamples)})
 assert.equal(refusedSamples.status,200);assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 for(const offset of [1n,2n,3n,4n]){
  const time=String(start-offset*1000000000n)
  const invalid=await post(route,{...body,from:time,through:time});assert.equal(invalid.status,422)
  assert.equal((await invalid.json()).error,'unqualified_replay_samples')
 }
 const manyTime=String(start+10000000000n)
 const many={resourceMetrics:[{resource:resources[0].resource,scopeMetrics:[{metrics:[{name:'requests',gauge:{dataPoints:Array.from({length:201},(_,n)=>({timeUnixNano:manyTime,asDouble:n,attributes:[{key:'instance',value:{intValue:String(n)}}]}))}}]}]}]}
 const manyIntake=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-4314'},body:JSON.stringify(many)})
 assert.equal(manyIntake.status,200);assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const partial=await post(route,{...body,from:manyTime,through:manyTime});assert.equal(partial.status,422)
 assert.equal((await partial.json()).error,'replay_window_incomplete_narrow_range')
 const ledger=await (await fetch(origin+'/api/v1/audit/export',{headers:{cookie}})).text()
 assert.ok(ledger.includes('migration.replay'));assert.ok(!ledger.includes("data('requests'"),'source program stays out of private action labels')
 const unsupported=await post(route,{...body,targetId:'splunk:detectors:synthetic-porthole-100'})
 assert.equal(unsupported.status,422);assert.equal((await unsupported.json()).construct,',')
 const mismatch=await post(route,{...body,service:'elsewhere'});assert.equal(mismatch.status,422)
 const empty=await post(route,{...body,from:String(start-6000000000n),through:String(start-5000000000n)});assert.equal(empty.status,200)
 const noData=await empty.json();assert.deepEqual(noData.points,[]);assert.equal(noData.coverage,'no-data')
 const fillAnalysis=async page=>{
  await page.getByText('Analyze retained metric samples',{exact:true}).click()
  const form=page.locator('form[action="/app/import/replay"]')
  await form.locator('select[name="targetId"]').selectOption(body.targetId)
  for(const key of ['service','environment','team','from','through'])await form.locator(`input[name="${key}"]`).fill(body[key])
 }
 await capture('move-in-analysis-form','/app/import',fillAnalysis)
 await capture('move-in-replay','/app/import',async page=>{
  await page.getByText('Analyze retained metric samples',{exact:true}).click()
  const form=page.locator('form[action="/app/import/replay"]')
  await form.locator('select[name="targetId"]').selectOption(body.targetId)
  for(const key of ['service','environment','team','from','through'])await form.locator(`input[name="${key}"]`).fill(body[key])
  await form.getByRole('button',{name:'Analyze retained samples',exact:true}).click()
  await page.getByRole('heading',{name:'Retained sample replay'}).waitFor()
  const result=JSON.parse(await page.locator('pre').innerText());assert.deepEqual(result.points,replay.points)
 })
 await capture('move-in-replay-refused','/app/import',async page=>{
  await page.getByText('Analyze retained metric samples',{exact:true}).click()
  const form=page.locator('form[action="/app/import/replay"]')
  await form.locator('select[name="targetId"]').selectOption('splunk:detectors:synthetic-porthole-100')
  for(const key of ['service','environment','team','from','through'])await form.locator(`input[name="${key}"]`).fill(body[key])
  await form.getByRole('button',{name:'Analyze retained samples',exact:true}).click()
  await page.getByRole('heading',{name:'Replay unavailable'}).waitFor();assert.ok(await page.getByRole('alert').isVisible())
 })
 console.log('SignalFlow retained-sample replay: native OTLP gauges, aligned mean, exact threshold sequence, source identity, no-data and unsupported timing refusal passed; source lifecycle parity remains unqualified')
}
