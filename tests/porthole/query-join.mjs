import assert from 'node:assert/strict'
/** Retained log and trace correlation uses only actual public intake records. */
export async function queryJoinJourney({origin,cookie,call,backend,pauseNextQuery}){
 const post=(path,body,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const scope={services:['checkout','billing'],environments:['query-join'],teams:['commerce','payments'],signals:['logs','traces'],actions:['telemetry.write']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Retained correlation corpus',class:'ingest',scope}),201)
 const time=BigInt(Date.now())*1000000n,trace='a'.repeat(32),missing='b'.repeat(32),attr=(key,stringValue)=>({key,value:{stringValue}})
 const resource=(team='commerce')=>({attributes:[attr('service.name','checkout'),attr('deployment.environment.name','query-join'),attr('team.name',team)]})
 const emit=(signal,body,id)=>post('/v1/'+signal,body,{authorization:'Bearer '+source.secret,'x-porthole-batch-id':id})
 const log=await emit('logs',{resourceLogs:[{resource:resource(),scopeLogs:[{logRecords:[{timeUnixNano:String(time),traceId:trace,body:{stringValue:'Checkout retained match'}},{timeUnixNano:String(time+1n),traceId:missing,body:{stringValue:'Checkout missing retained trace'}},{timeUnixNano:String(time+2n),body:{stringValue:'Checkout without correlation key'}}]}]}]},'synthetic-porthole-2120')
 assert.equal(log.status,200);const logBatch=log.headers.get('x-porthole-batch')
 const spans=await emit('traces',{resourceSpans:[{resource:resource(),scopeSpans:[{spans:[{name:'Checkout retained span',traceId:trace,spanId:'c'.repeat(16),startTimeUnixNano:String(time),endTimeUnixNano:String(time+1000n),kind:2}]}]},{resource:resource('payments'),scopeSpans:[{spans:[{name:'Restricted span with reused trace ID',traceId:trace,spanId:'d'.repeat(16),startTimeUnixNano:String(time),endTimeUnixNano:String(time+1000n),kind:2}]}]}]},'synthetic-porthole-2121')
 assert.equal(spans.status,200);const traceBatch=spans.headers.get('x-porthole-batch')
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Retained correlation reader',class:'read',scope:{services:['checkout'],environments:['query-join'],teams:['commerce'],signals:['logs','traces'],actions:['telemetry.read']}}),201),headers={authorization:'Bearer '+reader.secret}
 const expression="SELECT * FROM logs JOIN traces ON logs.trace_id = traces.trace_id WHERE service='checkout' AND environment='query-join' AND team='commerce'",query={dialect:'sql',expression,from:String(time),through:String(time+1000n)}
 const first=await value(await post('/api/porthole/v1/query',{...query,scanLimit:2},headers));assert.equal(first.coverage.state,'partial');assert.equal(first.records.length,1);assert.equal(first.records[0].left.id,logBatch+':0');assert.equal(first.records[0].right.id,traceBatch+':0');assert.equal(first.records[0].right.team,'commerce');assert.equal(first.joinResult.availability[0].availability,'Unknown');assert.equal(first.analytical?.role,backend==='local'?undefined:'primary')
 const next=await value(await post('/api/porthole/v1/query',{...query,snapshot:first.snapshot,cursor:first.cursor,scanLimit:2},headers));assert.equal(next.coverage.state,'complete');assert.equal(next.records.length,0);assert.equal(next.joinResult.availability[0].logId,logBatch+':2');assert.equal(next.coverage.retainedOnly,true)
 const bounded=await value(await post('/api/porthole/v1/query',{...query,from:String(time+1n)},headers));assert.equal(bounded.records.length,0,'the right side cannot cross the original time boundary to invent a pair')
 const run=await value(await post('/api/porthole/v1/query/runs',{query,scanLimit:1},headers),201),root='/api/porthole/v1/query/runs/'+run.id
 const stopped=await value(await post(root+'/cancel',{revision:run.revision},headers));assert.equal(stopped.state,'canceled');assert.deepEqual((await value(await post(root+'/advance',{revision:stopped.revision},headers))).records,[])
 if(pauseNextQuery){
  const active=await value(await post('/api/porthole/v1/query/runs',{query,scanLimit:1},headers),201),path='/api/porthole/v1/query/runs/'+active.id,gate=pauseNextQuery()
  const advancing=post(path+'/advance',{revision:active.revision},headers)
  try{
   await Promise.race([gate.entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('join did not reach actual analytical trace read')),10000);timer.unref()})])
   const cancel=await value(await post(path+'/cancel',{revision:active.revision},headers));assert.equal(cancel.state,'canceled')
  }finally{gate.release()}
  const late=await advancing;assert.equal(late.status,409,'canceling an executing join prevents its actual late provider result from escaping');assert.equal((await late.json()).error,'query_run_changed')
  const final=await value(await call(path,{headers}));assert.equal(final.state,'canceled');assert.equal(final.coverage.matchedRecords,0)
 }
 for(const expression of [query.expression+" OR team='payments'",query.expression+'; DELETE FROM logs',"SELECT * FROM logs JOIN traces ON logs.trace_id = traces.trace_id WHERE team='payments'"]){const response=await post('/api/porthole/v1/query',{...query,expression},headers);assert.ok([400,403].includes(response.status))}
 const exportResponse=await call(first.replay+'/export',{headers});assert.equal(exportResponse.status,200);const exported=(await exportResponse.text()).trim().split('\n').map(JSON.parse);assert.equal(exported[1].record.right.id,traceBatch+':0')
 const logOnly=await value(await post('/app/settings/credentials/mint',{name:'Correlation log-only reader',class:'read',scope:{services:['checkout'],environments:['query-join'],teams:['commerce'],signals:['logs'],actions:['telemetry.read']}}),201)
 assert.equal((await post('/api/porthole/v1/query',query,{authorization:'Bearer '+logOnly.secret})).status,403,'log visibility cannot grant trace visibility')
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}));assert.equal((await call(first.replay,{headers})).status,401)
 return query
}
