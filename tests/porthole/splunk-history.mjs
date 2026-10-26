import assert from 'node:assert/strict'
export async function splunkHistoryJourney({origin,cookie,capture,member,foreignCookie,selectedDefinitions,emptyDefinitions,upload,finish,snapshot,restartWorker,freshOwner}){
 const post=(path,data,session=cookie,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json',...extra},body:JSON.stringify(data)})
 const get=(path,session=cookie)=>fetch(origin+path,{headers:{cookie:session}})
 const scope={service:'checkout',environment:'test',team:'ops'}
 const immediateDefinition={id:'synthetic-porthole-4359',name:'Imported source comparison',programText:"A = data('requests', filter=filter('service', 'checkout')).mean(); detect(when(A > 10)).publish('high')",rules:[{detectLabel:'high',severity:'Major'}]}
 const timed={id:'synthetic-porthole-4350',name:'Checkout sustained requests',programText:"A = data('requests', filter=filter('service', 'checkout'), resolution=1000, rollup='average', extrapolation='null').mean(); detect(when(A > threshold(10), lasting='2s'), off=when(A < 5, lasting='2s')).publish('checkout-sustained')",rules:[{detectLabel:'checkout-sustained',severity:'Major'}],tags:['team:ops']}
 const trailing={id:'synthetic-porthole-4351',name:'Checkout trailing requests',programText:"data('requests', filter=filter('service', 'checkout'), resolution='1s').mean().mean(over='2s').publish('checkout-trailing')",options:{type:'TimeSeriesChart'},tags:['team:ops']}
 const before=await snapshot(),source={...selectedDefinitions,history:[...selectedDefinitions.history,...emptyDefinitions.history],charts:[...(selectedDefinitions.charts??[]),trailing],detectors:[...(selectedDefinitions.detectors??[]),immediateDefinition,timed],services:{nodes:[{serviceName:'checkout',inferred:false,type:'service'},{serviceName:'payments',inferred:false,type:'service'}],edges:[{fromNode:'checkout',toNode:'payments'}]},rum:[{applicationName:'Porthole checkout',realm:'us0',rumAccessToken:'synthetic-porthole-4352',environment:'test',version:'2026.10.27',debug:false}]}
 const plan=await upload('splunk',source)
 assert.ok(plan.diagnostics.some(item=>item.code==='CREDENTIAL_REMOVED'))
 await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},'splunk','completed')
 let rows=await snapshot(),history=rows.find(row=>row.targetKind==='history'&&row.value.definition.source==='splunk-timeserieswindow'&&Object.keys(row.value.definition.metadata).length>0)
 const service=rows.find(row=>row.targetKind==='services'&&row.value.definition.serviceName==='checkout')
 assert.deepEqual(service.value.sourceTopology,source.services)
 assert.ok(!JSON.stringify(rows).includes('synthetic-porthole-4352'),'a source RUM credential is not retained')
 const emptySource=rows.find(row=>row.targetKind==='history'&&Object.keys(row.value.definition.metadata).length===0)
 const selected=selectedDefinitions.history[0],historyPath='/api/porthole/v1/migration/history?id='+encodeURIComponent(history.targetId)
 for(const [session,status]of [['',401],[member,403],[foreignCookie,401]])assert.equal((await get(historyPath,session)).status,status)
 const response=await get(historyPath);assert.equal(response.status,200,await response.clone().text())
 const imported=await response.json()
 for(const series of imported.series){
  assert.deepEqual(series.metadata,selected.metadata[series.id])
  assert.deepEqual(series.points,selected.response.data[series.id].map(([ms,value])=>({sourceTimestampMs:ms,timeUnixNano:String(BigInt(ms)*1000000n),value})))
 }
 const immediate=rows.find(row=>row.targetId==='splunk:detectors:'+immediateDefinition.id),route='/api/porthole/v1/migration/replay'
 const originalRange={from:String(BigInt(selected.request.startMs)*1000000n),through:String(BigInt(selected.request.endMS)*1000000n)}
 const original={...scope,...originalRange,targetId:immediate.targetId,targetRevision:immediate.revision,historyId:history.targetId}
 const historical=await post(route,original);assert.equal(historical.status,200,await historical.clone().text())
 const replay=await historical.json()
 assert.deepEqual(replay.points.map(point=>({value:point.value,active:point.active})),[{value:6,active:false},{value:16,active:true},{value:6,active:false}])
 assert.equal(replay.historyRevision,history.revision);assert.equal(replay.notifications,'inactive');assert.equal(replay.queryRef,null)
 assert.deepEqual(replay.sourceSeries.map(item=>item.metadata),Object.values(selected.metadata))
 assert.ok(replay.sourceLimitations.some(text=>text.includes('default rollups')))
 assert.equal((await post(route,{...original,team:'other-team'})).status,422,'unmapped source scope cannot be relabelled by a request')
 assert.equal((await post(route,{...original,targetRevision:'synthetic-porthole-4353'})).status,409,'replay is bound to the exact saved source revision')
 const mint=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-4354',class:'ingest',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.write']}})
 assert.equal(mint.status,201);const credential=await mint.json()
 const start=BigInt(Math.floor((Date.now()-60000)/1000))*1000000000n,from=String(start),through=String(start+4000000000n)
 const resources=['a','b'].map(instance=>({resource:{attributes:Object.entries({'service.name':scope.service,'deployment.environment.name':scope.environment,'team.name':scope.team,'service.instance.id':instance}).map(([key,value])=>({key,value:{stringValue:value}}))},scopeMetrics:[{scope:{name:'synthetic-porthole-4355'},metrics:[{name:'requests',unit:'{request}',gauge:{dataPoints:[3,20,20,3,3].map((asDouble,index)=>({timeUnixNano:String(start+BigInt(index)*1000000000n),asDouble}))}}]}]}))
 const intake=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-4356'},body:JSON.stringify({resourceMetrics:resources})})
 assert.equal(intake.status,200,await intake.clone().text());assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const target=rows.find(row=>row.targetId==='splunk:detectors:'+timed.id),input={...scope,from,through,targetId:target.targetId,targetRevision:target.revision}
 const evaluate=await post(route,input);assert.equal(evaluate.status,200,await evaluate.clone().text())
 const sequence=await evaluate.json()
 assert.deepEqual(sequence.points.map(point=>({value:point.value,state:point.state})),[{value:3,state:'Unknown'},{value:20,state:'Unknown'},{value:20,state:'anomalous'},{value:3,state:'anomalous'},{value:3,state:'ok'}])
 assert.deepEqual(sequence.transitions,[{time:String(start+2000000000n),was:'unknown',is:'anomalous'},{time:String(start+4000000000n),was:'anomalous',is:'ok'}])
 assert.equal(sequence.coverage,'complete-aligned-window');assert.equal(sequence.notifications,'inactive')
 const window=rows.find(row=>row.targetId==='splunk:charts:'+trailing.id),windowInput={...input,targetId:window.targetId,targetRevision:window.revision}
 const transformed=await post(route,windowInput);assert.equal(transformed.status,200,await transformed.clone().text())
 assert.deepEqual((await transformed.json()).points.map(point=>point.value),[null,11.5,20,11.5,3])
 const missing=await post(route,{...input,through:String(start+6000000000n)});assert.equal(missing.status,200)
 const unknown=await missing.json();assert.equal(unknown.coverage,'incomplete-aligned-window');assert.deepEqual(unknown.points.slice(-2).map(point=>({value:point.value,state:point.state,heldState:point.heldState})),[{value:null,state:'Unknown',heldState:'ok'},{value:null,state:'Unknown',heldState:'ok'}]);assert.deepEqual(unknown.transitions,sequence.transitions)
 const unaligned=await post(route,{...input,from:String(start+1n)});assert.equal(unaligned.status,422)
 assert.match((await unaligned.json()).detail,/align exactly/)
 await capture('move-in-imported-history','/app/import/history?id='+encodeURIComponent(history.targetId),async page=>{assert.ok(await page.getByRole('cell',{name:'5.25',exact:true}).count());assert.match(await page.locator('body').innerText(),/Retained source rollups/)})
 await capture('move-in-imported-history-metadata','/app/import/history?id='+encodeURIComponent(history.targetId),async page=>{await page.getByText('Source dimensions and tags',{exact:true}).first().click()})
 await capture('move-in-history-empty','/app/import/history?id='+encodeURIComponent(emptySource.targetId),async page=>{assert.match(await page.locator('body').innerText(),/No source samples/);assert.equal(await page.getByRole('table').count(),0)})
 await capture('move-in-history-unauthorized','/app/import/history?id='+encodeURIComponent(history.targetId),async page=>{assert.ok(await page.getByRole('alert').isVisible())},member)
 const fill=async(page,body)=>{
  await page.getByText('Analyze retained metric samples',{exact:true}).click()
  const form=page.locator('form[action="/app/import/replay"]')
  await form.locator('[name=targetRef]').selectOption(JSON.stringify([body.targetId,body.targetRevision]))
  if(body.historyId)await form.getByLabel('Sample source').selectOption(body.historyId)
  for(const key of ['service','environment','team','from','through'])await form.locator(`[name=${key}]`).fill(body[key])
  await form.getByRole('button',{name:'Analyze retained samples',exact:true}).focus();await page.keyboard.press('Enter')
  await page.getByRole('heading',{name:'Retained sample replay',exact:true}).waitFor();await page.getByText('Exact replay data',{exact:true}).click()
 }
 await capture('move-in-aligned-detector','/app/import',async page=>{await fill(page,input);assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).transitions,sequence.transitions);await page.getByText('Exact replay data',{exact:true}).click()})
 await capture('move-in-missing-interval','/app/import',async page=>{await fill(page,{...input,through:String(start+6000000000n)});assert.match(await page.locator('pre').innerText(),/Missing interval/);await page.getByText('Exact replay data',{exact:true}).click();await page.getByRole('cell',{name:'Missing interval',exact:true}).first().scrollIntoViewIfNeeded()})
 await capture('move-in-replay-empty','/app/import',async page=>{await fill(page,{...input,from:String(start-4000000000n),through:String(start-2000000000n)});const empty=JSON.parse(await page.locator('pre').innerText());assert.equal(empty.coverage,'no-data');assert.ok(empty.points.every(point=>point.state==='Unknown'));await page.getByText('Exact replay data',{exact:true}).click()})
 await capture('move-in-source-history-replay','/app/import',async page=>{await fill(page,original);assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).points,replay.points);await page.getByText('Exact replay data',{exact:true}).click()})
 await restartWorker();cookie=await freshOwner()
 const after=(await (await get(historyPath)).json())
 assert.deepEqual(after,imported,'source history remains local after cold restart and without source credentials')
 const repeated=await post(route,input);assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).transitions,sequence.transitions)
 const audit=await (await get('/api/v1/audit/export')).text();assert.match(audit,/migration.history-read/);assert.ok(!audit.includes('sf_metric:requests'))
 // Undo only this selected batch. Earlier imported source and native samples survive.
 await finish('undo',{planId:plan.planId},'splunk','undone')
 assert.deepEqual(await snapshot(),before)
 assert.equal((await get(historyPath)).status,404)
 assert.equal((await post(route,input)).status,404)
 await capture('move-in-history-unavailable','/app/import/history?id='+encodeURIComponent(history.targetId),async page=>{assert.match(await page.getByRole('alert').innerText(),/source record not found/)})
 assert.equal((await post('/app/settings/credentials/revoke',{id:credential.credential.id})).status,200)
 console.log('Splunk selected history and native aligned replay: exact source time, values, dimensions and tags, lasting and clear windows, trailing means, explicit Unknown intervals, stale and scope refusal, cold local reuse and conflict-safe Undo passed; full source parity stays unqualified')
}
