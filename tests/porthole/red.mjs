import assert from 'node:assert/strict'

/** Verify automatic RED through the real Worker against the same unsampled
 * OTLP source spans sent through the official Collector lifecycle journey. */
export async function assertRed({origin,cookie,scope,range,spans,retained,pendingRecords=0,loss=false,deniedCookie,security=false,inputStage='pre-sampling'}) {
 const path='/api/porthole/v1/red/query',body={scope,...range,inputStage}
 const call=(route,data,session=cookie,secret)=>fetch(origin+route,{method:'POST',headers:{origin,'content-type':'application/json',...(secret?{authorization:'Bearer '+secret}:{cookie:session})},body:JSON.stringify(data)})
 const post=async(route,data,status=200,session=cookie,secret)=>{
  const response=await call(route,data,session,secret)
  assert.equal(response.status,status,await response.clone().text())
  return response.json()
 }
 const result=await post(path,body),wanted=new Map()
 for(const span of spans){
  const attrs=Object.fromEntries((span.attributes??[]).map(a=>[a.key,a.value.stringValue??a.value.intValue??a.value.doubleValue]))
  const endpoint=String(attrs['http.route']||span.name||'')
  if(!wanted.has(endpoint))wanted.set(endpoint,{hits:0,errors:0,durations:[]})
  const group=wanted.get(endpoint),http=Number(attrs['http.response.status_code']??attrs['http.status_code']),grpc=Number(attrs['rpc.grpc.status_code'])
  group.hits++
  if(span.status?.code===2||span.status?.code==='STATUS_CODE_ERROR'||http>=500&&http<=599||Number.isFinite(grpc)&&grpc!==0)group.errors++
  const duration=BigInt(span.endTimeUnixNano)-BigInt(span.startTimeUnixNano)
  group.durations.push(duration>=0n&&duration<=BigInt(Number.MAX_SAFE_INTEGER)?Number(duration):null)
 }
 assert.equal(result.inputStage,inputStage)
 assert.equal(result.coverage.acceptedInputs,spans.length)
 assert.equal(result.coverage.derivedInputs,spans.length,'automatic RED uses all accepted source spans')
 assert.equal(result.coverage.missingContributions,0)
 assert.equal(result.coverage.pendingRecords,pendingRecords)
 assert.equal(result.coverage.upstream,'unknown')
 assert.equal(result.coverage.independentlyVerified,false)
 assert.equal(result.query.agentStatsIncluded,false,'native RED must not borrow another population')
 assert.deepEqual(result.groups.map(g=>g.endpoint).sort(),[...wanted.keys()].sort())
 for(const group of result.groups){
  const expected=wanted.get(group.endpoint),valid=expected.durations.filter(value=>value!==null).sort((a,b)=>a-b)
  assert.equal(group.hits,expected.hits)
  assert.equal(group.errors,expected.errors)
  assert.equal(group.duration.count,valid.length)
  if(valid.length===expected.hits)for(const [key,p] of [['p50',.5],['p95',.95],['p99',.99]])assert.equal(group.duration.quantiles[key],valid[Math.ceil(valid.length*p)-1])
  else assert.equal(group.duration.quantiles,null)
 }
 if(retained!==undefined)assert.ok(result.coverage.derivedInputs>retained,'full-input RED survives physical retained-span shrink')
 if(loss){assert.equal(result.coverage.status,'incomplete');assert.ok(result.coverage.lossEvents>0)}
 else assert.equal(result.coverage.status,inputStage==='accepted'||pendingRecords||!spans.length||spans.some(s=>BigInt(s.endTimeUnixNano)-BigInt(s.startTimeUnixNano)>BigInt(Number.MAX_SAFE_INTEGER))?'incomplete':'accepted-input-complete')
 if(deniedCookie)await post(path,body,403,deniedCookie)
 if(security){
  await post(path,body,401,'')
  await post(path,{...body,scope:{...scope,service:'red-forbidden-service'}},200)
  const grant={services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.read']}
  const minted=await post('/app/settings/credentials/mint',{name:'Native RED scoped read journey',class:'read',scope:grant},201)
  const read=await post(path,body,200,'',minted.secret)
  assert.deepEqual(read.groups,result.groups)
  await post(path,{...body,scope:{...scope,service:'red-forbidden-service'}},403,'',minted.secret)
  const wrongSignal=await post('/app/settings/credentials/mint',{name:'Native RED wrong signal journey',class:'read',scope:{...grant,signals:['traces']}},201)
  await post(path,body,403,'',wrongSignal.secret)
  for(const credential of [minted,wrongSignal])await post('/app/settings/credentials/revoke',{id:credential.credential.id})
  await post(path,body,401,'',minted.secret)
 }
 return result
}
