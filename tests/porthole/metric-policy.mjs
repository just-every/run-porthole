import assert from 'node:assert/strict'

// Continue the span metric sanity journey through the same native and bearer doors.
export async function metricPolicyJourney({origin,post,base,source,call,restartWorker,freshOwner}) {
 const root='/api/porthole/v1/metric-rules'
 const definition={...base,name:'settlement_value',spanName:'*',kind:'sum',value:'invoice.value',dimensions:[{key:'channel',values:['web','store']}],predicate:{all:[{field:'invoice.value',op:'gte',value:10},{any:[{field:'region',op:'eq',value:'us'},{field:'span.status',op:'eq',value:2}]},{not:{field:'excluded',op:'eq',value:true}}]}}
 const preview=await post(root+'/preview',{definition}),approval={previewId:preview.id,digest:preview.digest,confirm:'approve-metric-rule'}
 await post(root+'/approve',{...approval,digest:'0'.repeat(64)},409)
 const rule=await post(root+'/approve',approval,201)
 const at=1780000000000000000n,values=[10.5,20.25,8,40,70]
 const packet={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'orders'}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team.name',value:{stringValue:'commerce'}}]},scopeSpans:[{spans:values.map((value,i)=>({name:'POST /orders/settle',traceId:(900000+i).toString(16).padStart(32,'0'),spanId:(900000+i).toString(16).padStart(16,'0'),startTimeUnixNano:String(at+BigInt(i)),endTimeUnixNano:String(at+BigInt(i)+1000000n),status:{code:i===1?2:1},attributes:[{key:'invoice.value',value:{doubleValue:value}},{key:'channel',value:{stringValue:'web'}},{key:'region',value:{stringValue:i===1||i===3?'eu':'us'}},{key:'excluded',value:{boolValue:i===4}}]}))}]}]}
 const send=()=>fetch(origin+(base.inputStage==='pre-sampling'?'/api/porthole/v1/ingest/pre-sampling/traces':'/v1/traces'),{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-policy-1'},body:JSON.stringify(packet)})
 assert.equal((await send()).status,200)
 await post('/api/porthole/v1/ingest/drain',{})
 const selection={id:rule.id,revision:rule.revision,from:String(at),through:String(at+1000000000n)}
 const result=await post(root+'/query',selection)
 assert.equal(result.groups.length,1);assert.equal(result.groups[0].sum,30.75);assert.equal(result.groups[0].count,2);assert.deepEqual(result.groups[0].dimensions,{channel:'web'})
 const reader=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-metric-reader',class:'read',scope:{services:['orders'],environments:['production'],teams:['commerce'],signals:['metrics'],actions:['telemetry.read']}},201)
 const exported=()=>fetch(origin+root+'/export',{method:'POST',headers:{authorization:'Bearer '+reader.secret,'content-type':'application/json'},body:JSON.stringify(selection)})
 let response=await exported();assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.deepEqual(JSON.parse(await response.text()),result)
 assert.equal((await fetch(origin+root+'/preview',{method:'POST',headers:{authorization:'Bearer '+reader.secret,'content-type':'application/json'},body:JSON.stringify({definition})})).status,403)
 await restartWorker();await freshOwner()
 assert.equal((await send()).headers.get('x-porthole-duplicate'),'true')
 response=await exported();assert.equal(response.status,200);assert.equal(JSON.parse(await response.text()).groups[0].sum,30.75)
 await post('/app/settings/credentials/revoke',{id:reader.credential.id})
 assert.equal((await exported()).status,401)
 const changed=await post(root+'/preview',{id:rule.id,revision:1,definition:{...definition,predicate:{field:'invoice.value',op:'gt',value:100}}})
 await post(root+'/approve',{...approval,previewId:changed.id,digest:preview.digest},409)
 assert.equal((await post(root+'/query',selection)).groups[0].sum,30.75,'changed predicates require a new exact preview approval')
 await post(root+'/preview',{definition:{...definition,value:'authorization'}},422)
 await post(root+'/preview',{definition:{...definition,predicate:{field:'email',op:'exists'}}},422)
 await post(root+'/preview',{definition:{...definition,dimensions:[{key:'ssn',values:['synthetic-porthole-private']}]}},422)
 console.log('metricPolicyJourney passed: typed boolean predicates, decimal numeric custom attributes and dimensions, exact bound USD preview, scoped programmatic export, duplicate restart and credential revocation')
}
