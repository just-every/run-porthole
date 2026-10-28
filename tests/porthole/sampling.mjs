import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {assertRed} from './red.mjs'
import {startSamplingCollector} from './sampling-process.mjs'

/** One public-door lifecycle journey using two official Collector processes,
 * independent source credentials, actual Worker restarts, and a finite durable
 * queue. SQL injects a real storage fault; it never substitutes telemetry. */
export async function samplingJourney({origin,freshOwner,restartWorker,signIn,sql,mutate}) {
 let cookie=await freshOwner(),collectors=[]
 const root='/api/porthole/v1/sampling',ingest='/api/porthole/v1/ingest',metrics='/api/porthole/v1/metric-rules'
 const change=mutate??(statement=>restartWorker(()=>sql(statement)))
 const call=(path,data,session=cookie)=>fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{cookie:session,origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const post=async(path,data,status=200,session=cookie)=>{const response=await call(path,data,session);assert.equal(response.status,status,await response.clone().text());return response.json()}
 const scope={services:['sampling-orders'],environments:['production'],teams:['sampling-commerce']},exact={service:scope.services[0],environment:scope.environments[0],team:scope.teams[0]}
 const mint=()=>post('/app/settings/credentials/mint',{name:'Sampling lifecycle stock collector',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']},requestsPerMinute:10000,acceptedBytesPerMinute:100000000},201)
 const sourceA=await mint(),sourceB=await mint()
 const definition={...exact,ordinaryPercent:10,slowThresholdMs:150}
 assert.equal((await call(root,undefined,'')).status,401)
 await post(root+'/preview',{definition:{...definition,ordinaryPercent:101}},400)
 const preview=await post(root+'/preview',{definition}),approval={previewId:preview.id,digest:preview.digest,confirm:'approve-sampling-policy'}
 await post(root+'/approve',{...approval,digest:'0'.repeat(64)},409)
 await post(root+'/approve',approval,201);await post(root+'/approve',approval,409)
 const base={...exact,inputStage:'pre-sampling',name:'sampling_orders_count',spanName:'process_order',kind:'counter',value:'count',unit:'orders',dimensions:[{key:'region',values:['eu','us']},{key:'plan',values:['basic','pro']}],upstream:'complete',costModel:{source:'synthetic-porthole-owner-rate-v1',monthlySpans:1000000,bytesPerPoint:128,usdMicrosPerMillionSpans:2000000,usdMicrosPerSeriesMonth:100000,usdMicrosPerGiBMonth:100000,ceilingUsdMicros:10000000}}
 const rules=[]
 for(const d of [base,{...base,name:'sampling_orders_amount',kind:'sum',value:'amount',unit:'cents'},{...base,name:'sampling_orders_duration',kind:'distribution',value:'duration',unit:'ns'}]) {
  const p=await post(metrics+'/preview',{definition:d});rules.push(await post(metrics+'/approve',{previewId:p.id,digest:p.digest,confirm:'approve-metric-rule'},201))
 }
 const count=1000,at=BigInt(Date.now())*1000000n-10000000000n,range={from:String(at),through:String(at+2000000000n)},packets=[],expected=new Map(),traceIds=[]
 const hash=text=>createHash('sha256').update(text).digest('hex')
 const draw=id=>Number.parseInt(hash(JSON.stringify([exact.team,exact.environment,id])).slice(0,8),16)%10000
 const attrs=[{key:'service.name',value:{stringValue:exact.service}},{key:'deployment.environment.name',value:{stringValue:exact.environment}},{key:'team.name',value:{stringValue:exact.team}}]
 const makePacket=spans=>({resourceSpans:[{resource:{attributes:attrs},scopeSpans:[{scope:{name:'sampling-lifecycle'},spans}]}]})
 for(let begin=0;begin<count;begin+=100) {
  const parent=[],child=[]
  for(let i=begin;i<begin+100;i++) {
   const traceId=hash('sampling-lifecycle-'+i).slice(0,32);traceIds.push(traceId)
   const region=i%2?'eu':'us',plan=Math.floor(i/2)%2?'pro':'basic',key=region+','+plan,amount=i%13+1
   if(!expected.has(key))expected.set(key,{count:0,sum:0,durations:[]})
   for(let n=0;n<2;n++) {
    const duration=n===1&&i>=100&&i<200?200000000:5000000,start=at+BigInt(i)*1000000n
    const span={traceId,spanId:(i*2+n+1).toString(16).padStart(16,'0'),name:'process_order',kind:2,startTimeUnixNano:String(start),endTimeUnixNano:String(start+BigInt(duration)),status:{code:n===1&&i<100?2:1},attributes:[{key:'region',value:{stringValue:region}},{key:'plan',value:{stringValue:plan}},{key:'amount',value:{intValue:String(amount)}},{key:'http.route',value:{stringValue:i%2?'/orders/express':'/orders'}}]}
    ;(n===0?parent:child).push(span)
    const group=expected.get(key);group.count++;group.sum+=amount;group.durations.push(duration)
   }
  }
  packets.push({parent:makePacket(parent),child:makePacket(child)})
 }
 const start=async source=>{const c=await startSamplingCollector({origin,secret:source.secret});collectors.push(c);return c}
 const send=async(collector,packet,status=200)=>{
  const response=await fetch(collector.origin+'/v1/traces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(packet),signal:AbortSignal.timeout(20000)})
  if(status===200)assert.equal(response.status,200,await response.clone().text());else assert.notEqual(response.status,200,'exhaustion cannot be acknowledged by a memory queue')
  return response
 }
 const sample=()=>post(root+'/query',{scope:exact,...range})
 const query=rule=>post(metrics+'/query',{id:rule.id,revision:rule.revision,...range})
 const read=async()=>{const records=[];let cursor=null;do{const parameters=new URLSearchParams({signal:'traces',service:exact.service,environment:exact.environment,team:exact.team,...range,limit:'200',...(cursor?{cursor}:{})});const response=await call(ingest+'/records?'+parameters);assert.equal(response.status,200);const page=await response.json();records.push(...page.records);cursor=page.cursor}while(cursor);return records}
 try {
  let a=await start(sourceA),b=await start(sourceB)
  for(const packet of packets)await send(a,packet.parent)
  const before=await sample();assert.equal(before.summary.accepted,count);assert.equal(before.summary.intentionally_sampled,count-traceIds.filter(id=>draw(id)<1000).length)
  const lateIndex=traceIds.findIndex((id,i)=>i<100&&draw(id)>=1000)
  assert.ok(lateIndex>=0)
  assert.ok(!(await read()).some(row=>row.trace_id===traceIds[lateIndex]),'known ordinary trace initially sampled out')
  await a.stop('SIGKILL')
  await restartWorker();cookie=await freshOwner()
  a=await start(sourceA)
  // Beyond the old collector's two-second decision/cache window, and through
  // a different source and collector, the protected evidence still promotes.
  await new Promise(resolve=>setTimeout(resolve,2200))
  for(const packet of packets)await send(b,packet.child)
  const records=await read(),retainedIds=new Set(records.map(row=>row.span_id)),expectedRetained=[]
  for(let i=0;i<count;i++)if(i<200||draw(traceIds[i])<1000)expectedRetained.push((i*2+1).toString(16).padStart(16,'0'),(i*2+2).toString(16).padStart(16,'0'))
  assert.deepEqual([...retainedIds].sort(),expectedRetained.sort(),'every error/slow trace is whole; ordinary traces share a deterministic decision across collectors')
  assert.equal(records.length,retainedIds.size)
  const promoted=records.filter(row=>row.trace_id===traceIds[lateIndex]);assert.equal(promoted.length,2);assert.ok(promoted.every(row=>row.payload.sampling.reason==='error'&&row.payload.sampling.promotedAt!==null&&row.payload.sampling.weight===1))
  const ordinary=records.filter(row=>row.payload.sampling.reason==='ordinary');assert.ok(ordinary.length>100&&ordinary.length<230,'ordinary cohort is near ten percent of 1600 ordinary spans');assert.ok(ordinary.every(row=>row.payload.sampling.weight===10&&row.payload.sampling.policyRevision===1))
  const verified=await sample();assert.equal(verified.summary.accepted,count*2);assert.equal(verified.summary.queryable,records.length);assert.equal(verified.summary.archived,records.length);assert.equal(verified.summary.intentionally_sampled,count*2-records.length);assert.equal(verified.summary.pending,0);assert.equal(verified.coverage.upstream,'unknown');assert.equal(verified.coverage.independentlyVerified,false)
  const rawSpans=packets.flatMap(packet=>[...packet.parent.resourceSpans[0].scopeSpans[0].spans,...packet.child.resourceSpans[0].scopeSpans[0].spans])
  await assertRed({origin,cookie,scope:exact,range,spans:rawSpans,retained:records.length,security:true})
  const metricBefore=[]
  for(let n=0;n<rules.length;n++) {
   const result=await query(rules[n]);metricBefore.push(result)
   for(const group of result.groups){const wanted=expected.get(group.dimensions.region+','+group.dimensions.plan);assert.equal(group.count,wanted.count);assert.equal(group.sum,n===0?wanted.count:n===1?wanted.sum:wanted.durations.reduce((a,b)=>a+b,0));if(n===2){const sorted=wanted.durations.toSorted((a,b)=>a-b);for(const [key,p]of [['p50',.5],['p95',.95],['p99',.99]])assert.equal(group.quantiles[key],sorted[Math.ceil(sorted.length*p)-1])}}
  }
  // Replaying the same full input after collector and Worker restart preserves
  // ingestion identity and metric/retention counts, including the late decision.
  await restartWorker();cookie=await freshOwner()
  for(const packet of packets)await send(a,packet.parent)
  for(let n=0;n<rules.length;n++)assert.deepEqual(await query(rules[n]),metricBefore[n])
  assert.equal((await sample()).summary.accepted,count*2)
  assert.equal((await read()).length,records.length)
  await assertRed({origin,cookie,scope:exact,range,spans:rawSpans,retained:records.length})
  // The configured durable capacity is exhausted before ACK. The official
  // collector returns failure after its bounded retries; the input stays at
  // the source and the destination emits authenticated rejection receipts.
  const control=(await (await call(ingest+'/status')).json()).control
  await post(ingest+'/control',{paused:true,maxPendingBytes:1})
  const pressureTrace=hash('sampling-lifecycle-pressure-error').slice(0,32),pressure=makePacket([{...packets[0].child.resourceSpans[0].scopeSpans[0].spans[0],traceId:pressureTrace,spanId:'ffffffffffffff01',status:{code:1},attributes:[...packets[0].child.resourceSpans[0].scopeSpans[0].spans[0].attributes,{key:'http.response.status_code',value:{intValue:'503'}}]}])
  await send(b,pressure,429)
  const refused=await sample();assert.equal(refused.summary.accepted,count*2);assert.equal(refused.coverage.status,'incomplete');assert.ok(refused.losses.some(row=>row.kind==='rejected'&&row.reason==='queue_pressure'&&row.records>=1),'automatic buffer exhaustion receipt is visible without a manual loss report')
  await b.stop('SIGKILL');await restartWorker();cookie=await freshOwner();b=await start(sourceB)
  await post(ingest+'/control',{paused:false,maxPendingBytes:control.max_pending_bytes})
  await send(b,pressure)
  assert.ok((await read()).some(row=>row.trace_id===pressureTrace&&row.payload.sampling.reason==='error'),'protected error survives refused attempt and collector restart when source retries')
  // A real decision-storage failure must leave full-input derivation committed,
  // but cannot acknowledge the request. Identical replay resumes that custody.
  const faultTrace=hash('sampling-lifecycle-decision-storage-error').slice(0,32),fault=makePacket([{...packets[0].child.resourceSpans[0].scopeSpans[0].spans[0],traceId:faultTrace,spanId:'ffffffffffffff02',status:{code:1},attributes:[...packets[0].child.resourceSpans[0].scopeSpans[0].spans[0].attributes,{key:'rpc.grpc.status_code',value:{intValue:'13'}}]}])
  await change("CREATE TRIGGER sampling_lifecycle_fail BEFORE INSERT ON porthole_sampling_decisions BEGIN SELECT RAISE(ABORT,'sampling_lifecycle_storage_fault'); END;")
  try {
   await send(a,fault,503)
   const result=await query(rules[0]);assert.equal(result.groups.reduce((sum,g)=>sum+g.count,0),count*2+2,'all accepted inputs derive metrics before a tail decision can commit')
   const state=await sample();assert.equal(state.summary.pending,1);assert.equal(state.summary.queryable,records.length+1)
  } finally {await change('DROP TRIGGER sampling_lifecycle_fail;')}
  await restartWorker();cookie=await freshOwner();await send(a,fault)
  const final=await sample();assert.equal(final.summary.pending,0);assert.equal(final.summary.accepted,count*2+2);assert.equal(final.summary.queryable,records.length+2);assert.equal(final.summary.accepted,final.summary.queryable+final.summary.intentionally_sampled);assert.equal(final.summary.queryable,final.summary.archived)
  assert.ok((await read()).some(row=>row.trace_id===faultTrace&&row.payload.sampling.reason==='error'))
  await post('/app/settings/members/invite',{email:('sampling-lifecycle-analyst'+String.fromCharCode(64)+'example.com'),displayName:'Sampling scoped reader',role:'read-only analyst',scope:{services:['other-service'],environments:['production'],teams:scope.teams}},202)
  const analyst=await signIn(('sampling-lifecycle-analyst'+String.fromCharCode(64)+'example.com'))
  await assertRed({origin,cookie,scope:exact,range,spans:[...rawSpans,pressure.resourceSpans[0].scopeSpans[0].spans[0],fault.resourceSpans[0].scopeSpans[0].spans[0]],retained:final.summary.queryable,loss:true,deniedCookie:analyst})
  await post(root+'/query',{scope:exact,...range},403,analyst);await post(root+'/preview',{definition},403,analyst)
  assert.deepEqual((await (await call(root,undefined,analyst)).json()).policies,[])
  const revised=await post(root+'/preview',{definition:{...definition,ordinaryPercent:0},revision:1});await post(root+'/approve',{previewId:revised.id,digest:revised.digest,confirm:'approve-sampling-policy'},201)
  const afterPolicy=await sample();assert.equal(afterPolicy.summary.queryable,final.summary.queryable,'future policy changes cannot withdraw already protected evidence')
  console.log('PORTHOLE_DURABLE_SAMPLING '+JSON.stringify({accepted:final.summary.accepted,retained:final.summary.queryable,sampled:final.summary.intentionally_sampled,ordinarySource:1600,ordinaryRetained:ordinary.length,protectedTraceSpans:400,metricInputs:2002,collectors:2,collectorRestart:true,workerRestart:true,postWindowDelayMs:2200,automaticPressureReceipts:true,upstream:'unknown',physicalRawStorageReduction:false}))
 } finally {
  for(const collector of collectors)await collector.stop()
  await post(ingest+'/control',{paused:false,maxPendingBytes:33554432}).catch(()=>{})
 }
}
