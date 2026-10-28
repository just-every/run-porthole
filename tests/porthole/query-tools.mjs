import assert from 'node:assert/strict'
/** One public-door continuation, export, history and discovery flow. */
export async function queryToolsJourney({origin,cookie,call,base,snapshot,headers,expected,backend}){
 const post=(path,body,auth=headers)=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...auth},body:JSON.stringify(body)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const query={...base,snapshot,limit:2,scanLimit:2}
 const estimate=await value(await post('/api/porthole/v1/query/estimate',{...base,snapshot}))
 assert.equal(estimate.estimate.candidateRecords,9);assert.equal(estimate.estimate.exact,true);assert.ok(estimate.estimate.payloadBytes>0);assert.equal(estimate.coverage.complete,false);assert.deepEqual(estimate.records,[])
 assert.equal((await post('/api/porthole/v1/query/estimate',{...base,expression:'service:billing'})).status,403)
 let cursor,rows=[],emptyPartial=false,scanned=0,first
 do{
  const page=await value(await post('/api/porthole/v1/query',{...query,...(cursor?{cursor}:{})}))
  first??=page;assert.ok(page.coverage.scannedCandidates<=2);scanned+=page.coverage.scannedCandidates
  rows.push(...page.records);cursor=page.cursor
  if(cursor){assert.equal(page.coverage.state,'partial');emptyPartial ||= page.records.length===0}else assert.equal(page.coverage.state,'complete')
 }while(cursor)
 assert.deepEqual(rows.map(row=>row.id).sort(),expected);assert.ok(emptyPartial);assert.equal(scanned,9,'only currently authorized candidate records are scanned')
 // The immutable query reference, rather than a reconstructed wider scope,
 // selects every export page. Empty pages preserve their continuation.
 let next='/api/porthole/v1/query/'+first.queryRef+'/export',exported=[]
 do{
  const response=await call(next,{headers});assert.equal(response.status,200,await response.clone().text())
  const lines=(await response.text()).trim().split('\n').map(JSON.parse),metadata=lines.shift()
  assert.equal(metadata.source.text,query.expression);assert.equal(metadata.snapshot,snapshot)
  exported.push(...lines.map(line=>line.record));next=metadata.next
 }while(next)
 assert.deepEqual(exported.map(row=>row.id).sort(),expected)
 const suppressed=expected[0]
 await value(await post('/api/porthole/v1/export-exclusions',{confirm:'apply-exclusions',journal:{format:'porthole.export-exclusions.v1',records:[{recordId:suppressed,excludedAt:Date.now()}]}},{cookie}))
 next='/api/porthole/v1/query/'+first.queryRef+'/export';const allowed=[]
 do{const response=await call(next,{headers});assert.equal(response.status,200);const lines=(await response.text()).trim().split('\n').map(JSON.parse),metadata=lines.shift();allowed.push(...lines.map(line=>line.record.id));next=metadata.next}while(next)
 assert.deepEqual(allowed.sort(),expected.filter(id=>id!==suppressed),'portable export exclusions apply to every backend without changing ordinary reads')
 const history=await value(await call('/api/porthole/v1/query/history',{headers}));assert.ok(history.history.some(row=>row.id===first.queryRef&&row.source.expression===query.expression))
 assert.equal((await call('/api/porthole/v1/query/'+first.queryRef+'/export',{headers:{cookie}})).status,404,'private query references are not a grant to another actor')
 const schema=await value(await post('/api/porthole/v1/query/schema',{...base,expression:'service:checkout',snapshot,limit:200,scanLimit:200}))
 const status=schema.attributes.find(row=>row.path==='http.status_code');assert.deepEqual(status.types,['boolean','number','string']);assert.ok(!JSON.stringify(schema).includes('Checkout payment observation'),'discovery has no sample bodies or values')
 const prepare=()=>post('/api/porthole/v1/query/runs',{query:{...base,snapshot},scanLimit:2})
 let run=await value(await prepare(),201),all=[];const root='/api/porthole/v1/query/runs/'+run.id
 assert.equal(run.state,'ready');const stale=run.revision
 run=await value(await post(root+'/advance',{revision:run.revision}));all.push(...run.records);assert.equal(run.state,'partial')
 assert.equal((await post(root+'/advance',{revision:stale})).status,409)
 while(run.state==='partial'){run=await value(await post(root+'/advance',{revision:run.revision}));all.push(...run.records)}
 assert.equal(run.state,'complete');assert.deepEqual(all.map(row=>row.id).sort(),expected);assert.equal(run.coverage.scannedCandidates,9)
 const stopped=await value(await prepare(),201),stopRoot='/api/porthole/v1/query/runs/'+stopped.id
 const canceled=await value(await post(stopRoot+'/cancel',{revision:stopped.revision}));assert.equal(canceled.state,'canceled')
 const after=await value(await post(stopRoot+'/advance',{revision:canceled.revision}));assert.deepEqual(after.records,[]);assert.equal(after.coverage.complete,false)
 // A one-millisecond deadline is deliberately elapsed by the next HTTP door;
 // no dependence on UTC dates or a host's time of day.
 const timed=await value(await post('/api/porthole/v1/query/runs',{query:{...base,snapshot},scanLimit:2,timeoutMs:1}),201)
 await new Promise(resolve=>setTimeout(resolve,10))
 const expired=await value(await post('/api/porthole/v1/query/runs/'+timed.id+'/advance',{revision:timed.revision}));assert.equal(expired.state,'timed_out');assert.deepEqual(expired.records,[])
 assert.equal((await post('/api/porthole/v1/query/runs',{query:{...base,expression:'service:billing'},scanLimit:2})).status,403)
 assert.equal((await call('/api/porthole/v1/query/history',{headers:{}})).status,401)
 if(backend==='local'){
  const scope={services:['checkout'],environments:['query-erasure'],teams:['commerce'],signals:['logs'],actions:['telemetry.write']}
  const source=await value(await post('/app/settings/credentials/mint',{name:'Query erasure source',class:'ingest',scope},{cookie}),201)
  const identifier='synthetic-porthole-2199',packet={resourceLogs:[{resource:{attributes:[['service.name','checkout'],['deployment.environment.name','query-erasure'],['team.name','commerce']].map(([key,stringValue])=>({key,value:{stringValue}}))},scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(Date.now())*1000000n),body:{stringValue:identifier}}]}]}]}
  const emit=()=>post('/v1/logs',packet,{authorization:'Bearer '+source.secret,'x-porthole-batch-id':'synthetic-porthole-2198'})
  assert.equal((await emit()).status,200);await value(await post('/api/porthole/v1/ingest/drain',{},{cookie}))
  const selection={signal:'logs',service:'checkout',environment:'query-erasure',team:'commerce'}
  const saved=await value(await post('/api/porthole/v1/query',selection,{cookie}));assert.equal(saved.records.length,1)
  const active=await value(await post('/api/porthole/v1/query/runs',{query:selection,scanLimit:1},{cookie}),201)
  const preview=await value(await post('/api/porthole/v1/subject-erasure',{identifier},{cookie}));assert.equal(preview.records,1)
  await value(await post('/api/porthole/v1/subject-erasure/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'},{cookie}))
  const interrupted=await value(await call('/api/porthole/v1/query/runs/'+active.id,{headers:{cookie}}));assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.coverage.scannedCandidates,0)
  assert.deepEqual((await value(await call(saved.replay,{headers:{cookie}}))).records,[])
  const gone=await call(saved.replay+'/export',{headers:{cookie}});assert.equal(gone.status,200);assert.equal((await gone.text()).trim().split('\n').length,1)
  assert.equal((await emit()).status,409,'replayed erased capture cannot rehydrate snapshot or export results')
 }
 return {runRoot:root,revision:run.revision,exportPath:'/api/porthole/v1/query/'+first.queryRef+'/export'}
}
