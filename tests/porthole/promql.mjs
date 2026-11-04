import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {prometheusReference,seconds} from './promql-reference.mjs'
const subject='synthetic-porthole-3199'
const scope={services:['checkout-promql'],environments:['promql'],teams:['commerce'],signals:['metrics']}
const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
const text=value=>({stringValue:String(value)})
export function metricPacket(series) {
 return {resourceMetrics:series.map(row=>({resource:{attributes:[{key:'service.name',value:text('checkout-promql')},{key:'deployment.environment.name',value:text('promql')},{key:'team.name',value:text('commerce')},{key:'user.id',value:text(subject)}]},scopeMetrics:[{scope:{name:'synthetic-porthole-3100'},metrics:[{name:row.labels.__name__,unit:row.unit,[row.kind==='counter'?'sum':'gauge']:{...(row.kind==='counter'?{aggregationTemporality:2,isMonotonic:true}:{}),dataPoints:row.samples.map(sample=>({timeUnixNano:sample.time,asDouble:sample.value,attributes:Object.entries(row.labels).filter(([key])=>!['__name__','service','environment','team'].includes(key)).map(([key,value])=>({key,value:text(value)}))}))}}]}]}))}
}
function normalize(result,reference=false) {
 return result.map(row=>({metric:Object.fromEntries(Object.entries(row.metric).sort(([a],[b])=>a.localeCompare(b))),values:(row.values??[row.value]).map(([time,value])=>[reference?secondsToNs(time):String(time),Number(value)])})).sort((a,b)=>JSON.stringify(a.metric).localeCompare(JSON.stringify(b.metric)))
}
function secondsToNs(time){const [whole,fraction='']=String(time).split('.');return whole+fraction.padEnd(9,'0')}
function matches(actual,expected) {
 const a=normalize(actual),b=normalize(expected,true)
 assert.deepEqual(a.map(row=>row.metric),b.map(row=>row.metric),'exact series labels and membership')
 assert.deepEqual(a.map(row=>row.values.map(([time])=>time)),b.map(row=>row.values.map(([time])=>time)),'exact evaluation instants and absent intervals')
 for(let i=0;i<a.length;i++)for(let j=0;j<a[i].values.length;j++)assert.ok(Math.abs(a[i].values[j][1]-b[i].values[j][1])<=1e-9*Math.max(1,Math.abs(b[i].values[j][1])),`reference numeric result ${i}, ${j}: ${a[i].values[j][1]} versus ${b[i].values[j][1]}`)
}
export async function promqlNativeJourney(context,reference,{backend='local',onQuery}={}) {
 const {origin,cookie,call,restart,getDb}=context
 const send=(path,data,headers={})=>call(path,{method:'POST',headers:{origin,cookie,'content-type':'application/json',...headers},body:JSON.stringify(data)})
 const post=async(path,data,status=200)=>value(await send(path,data),status)
 if(backend==='analytical'){
  const config=await value(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}}))
  await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
 }
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-3101',class:'ingest',scope:{...scope,actions:['telemetry.write']}},201)
 const packet=metricPacket(reference.series),headers={authorization:'Bearer '+source.secret,'x-porthole-batch-id':'synthetic-porthole-3102'}
 const intake=()=>send('/v1/metrics',packet,headers)
 await value(await intake());await post('/api/porthole/v1/ingest/drain',{})
 const reader=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-3103',class:'read',scope:{...scope,actions:['telemetry.read']}},201)
 const query=(data,credential=reader.secret)=>send('/api/porthole/v1/query',{dialect:'promql',...data},credential?{authorization:'Bearer '+credential}:{})
 let snapshot,replay,expected,initial
 for(const item of reference.cases) {
  const result=await value(await query({expression:item.expression,...item.settings,...(snapshot===undefined?{}:{snapshot})}))
  snapshot??=result.snapshot
  assert.equal(result.snapshot,snapshot);if(result.evaluation.result.length)assert.equal(result.evaluation.result[0].unit,item.expression.includes('rate(')?('requests'+'/s'):item.expression.includes('increase(')?'requests':'items');assert.equal(result.evaluation.state,'complete');assert.equal(result.cursor,null);assert.equal(result.evaluation.timestampUnit,'unix-nanoseconds')
  assert.equal(result.analytical?.role,backend==='analytical'?'primary':undefined)
  matches(result.evaluation.result,item.expected.result)
  if(!replay){replay=result.replay;expected=item.expected;initial=result}
 }
 if(backend==='analytical') {
  for(const role of ['standby','primary']) {
   const config=await value(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}}))
   await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role,enabled:true,confirm:'connect-analytical-workers'})
   const switched=await value(await query({expression:reference.cases[0].expression,...reference.cases[0].settings,snapshot}))
   assert.equal(switched.analytical.role,role);matches(switched.evaluation.result,reference.cases[0].expected.result)
  }
 }
 assert.equal(initial.evaluation.scannedSamples,288,'selection consumes multiple real native pages')
 const repeated=await value(await call(replay,{headers:{authorization:'Bearer '+reader.secret}}))
 assert.deepEqual(repeated.evaluation,initial.evaluation,'replay preserves exact evaluation settings, expression and original completion watermark')
 await restart()
 const restarted=await value(await call(replay,{headers:{authorization:'Bearer '+reader.secret}}))
 matches(restarted.evaluation.result,expected.result)
 const deniedScope=await query({expression:'synthetic_porthole_queue{service="billing"}',time:reference.end})
 assert.equal(deniedScope.status,403,'foreign scope refuses even when an owner cookie accompanies the bearer')
 const later=metricPacket([{labels:{__name__:'synthetic_porthole_queue',lane:'later'},kind:'gauge',unit:'items',samples:[{time:reference.end,value:999}]}])
 await value(await send('/v1/metrics',later,{authorization:'Bearer '+source.secret}));await post('/api/porthole/v1/ingest/drain',{})
 const frozen=await value(await query({expression:'synthetic_porthole_queue',time:reference.end,snapshot}))
 matches(frozen.evaluation.result,expected.result)
 assert.equal((await value(await query({expression:'synthetic_porthole_queue',time:reference.end}))).evaluation.result.length,49,'a new completion watermark can admit the later series')
 const limited=await query({expression:'synthetic_porthole_queue',time:reference.end,scanLimit:200})
 assert.equal(limited.status,413);assert.equal((await limited.json()).error,'promql_scan_budget_exceeded')
 const quota=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-3104',class:'read',scope:{...scope,actions:['telemetry.read']},scannedBytesPerDay:1},201)
 const refused=await query({expression:'synthetic_porthole_queue',time:reference.end},quota.secret)
 assert.equal(refused.status,429);assert.ok(Number(refused.headers.get('retry-after'))>0);assert.ok(!(await refused.text()).includes('evaluation'))
 for(const input of [
  {expression:'avg(synthetic_porthole_queue)',time:reference.end},
  {expression:'synthetic_porthole_queue{lane=~".*"}',time:reference.end},
  {expression:'rate(synthetic_porthole_queue[30s])',time:reference.end},
  {expression:'rate(synthetic_porthole_requests_total[0s])',time:reference.end},
  {expression:'synthetic_porthole_queue',start:'0',end:reference.end,step:.001},
  {expression:'synthetic_porthole_queue',time:reference.end,from:'0'},
 ]) {const result=await query(input);assert.equal(result.status,400,await result.clone().text());assert.ok(!(await result.text()).includes('"state":"complete"'))}
 const {wireCases}=await import('./promql-wire.mjs'),edges=await wireCases(reference)
 const edgeResponse=await call('/api/v1/write',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'},body:edges.wire})
 assert.equal(edgeResponse.status,204,await edgeResponse.clone().text());await post('/api/porthole/v1/ingest/drain',{})
 for(const item of edges.cases){const result=await value(await query({expression:item.expression,...item.settings}));matches(result.evaluation.result,item.expected.result)}
 const nan=await query({expression:'synthetic_porthole_nan',time:String(BigInt(reference.t)*1000000n)})
 assert.equal(nan.status,400,'ordinary NaN cannot be silently treated as a stale marker')
 const wire=await schemaCases({send,post,query,source,reference,snapshot})
 await promqlBrowser({context,reference,initial,backend,snapshot})
 if(onQuery) {
  let pages=0
  onQuery(async()=>{if(++pages===2)await post('/app/settings/credentials/revoke',{id:reader.credential.id})})
  const denied=await query({expression:'synthetic_porthole_queue',time:reference.end,snapshot})
  onQuery(null)
  assert.ok([401,409].includes(denied.status),await denied.clone().text());assert.ok(!(await denied.text()).includes('"result"'))
  assert.equal(pages,2,'revocation occurred during the second real analytical page')
 }else {
  await post('/app/settings/credentials/revoke',{id:reader.credential.id})
 }
 assert.equal((await call(replay,{headers:{authorization:'Bearer '+reader.secret}})).status,401,'saved evaluation never revives revoked credentials')
 await value(await intake());await post('/api/porthole/v1/ingest/drain',{})
 const owner=await value(await query({expression:'synthetic_porthole_queue',time:reference.end,snapshot},null))
 matches(owner.evaluation.result,expected.result)
 const {promqlArchiveJourney}=await import('./archive.mjs')
 await promqlArchiveJourney({context,reference,replay,expected:initial.evaluation,backend})
 if(backend==='local') {
  const preview=await post('/api/porthole/v1/subject-erasure',{identifier:subject})
  assert.equal(preview.canApply,true)
  await post('/api/porthole/v1/subject-erasure/apply',{identifier:subject,digest:preview.digest,confirm:'erase-exact-batches'})
  const erased=await value(await query({expression:'synthetic_porthole_queue',time:reference.end,snapshot},null))
  assert.deepEqual(erased.evaluation.result,[],'erased subjects remain absent from the saved completion watermark')
  const original=await value(await call(replay,{headers:{cookie}}));assert.deepEqual(original.evaluation.result,[])
  assert.equal((await intake()).status,409,'capture replay cannot resurrect erased metric evidence')
 }
 console.log('PROBE PORT-014 '+backend+': stock gauges, counters, resets, range, grouping, missing inputs, boundaries, pages, restart, replay, quotas, refusals and inactive restore passed; schema cases='+wire)
 return {snapshot,replay}
}
async function schemaCases({send,post,query,source,reference}) {
 const at=BigInt(reference.end),name='synthetic_porthole_typed',base={__name__:name,lane:'synthetic-porthole-3110'}
 const rows=[{labels:base,kind:'gauge',unit:'ms',samples:[{time:at.toString(),value:4}]}]
 const packet=metricPacket(rows)
 // Ordinary OTLP no-recorded-value remains absent; it is never numeric zero.
 packet.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints.push({timeUnixNano:String(at+1000000n),asDouble:0,flags:1,attributes:[{key:'lane',value:text(base.lane)}]})
 await value(await send('/v1/metrics',packet,{authorization:'Bearer '+source.secret}));await post('/api/porthole/v1/ingest/drain',{})
 const absent=await value(await query({expression:name,time:String(at+1000000n)}));assert.deepEqual(absent.evaluation.result,[])
 const wrong=metricPacket([{...rows[0],unit:'s',samples:[{time:String(at+2000000n),value:3}]}])
 await value(await send('/v1/metrics',wrong,{authorization:'Bearer '+source.secret}));await post('/api/porthole/v1/ingest/drain',{})
 assert.equal((await query({expression:name,time:String(at+2000000n)})).status,400,'incompatible source units cannot be silently combined')
 const types=['delta','nonmonotonic','histogram']
 for(const [index,kind] of types.entries()) {
  const body=metricPacket([{...rows[0],labels:{...base,__name__:'synthetic_porthole_type_'+index}}]),metric=body.resourceMetrics[0].scopeMetrics[0].metrics[0]
  const points=metric.gauge.dataPoints;delete metric.gauge
  if(kind==='histogram')metric.histogram={aggregationTemporality:2,dataPoints:points.map(point=>({timeUnixNano:point.timeUnixNano,count:'1',sum:4,bucketCounts:['1'],explicitBounds:[],attributes:point.attributes}))}
  else metric.sum={isMonotonic:kind==='delta',aggregationTemporality:kind==='delta'?1:2,dataPoints:points}
  await value(await send('/v1/metrics',body,{authorization:'Bearer '+source.secret}));await post('/api/porthole/v1/ingest/drain',{})
  const result=await query({expression:metric.name,time:reference.end});assert.equal(result.status,400);assert.equal((await result.json()).error,kind==='histogram'?'unsupported_promql_metric_type':'unsupported_promql_temporality')
 }
const mixed=metricPacket([{...rows[0],labels:{__name__:'synthetic_porthole_units',lane:'ms'}},{...rows[0],labels:{__name__:'synthetic_porthole_units',lane:'s'},unit:'s'}])
 await value(await send('/v1/metrics',mixed,{authorization:'Bearer '+source.secret}));await post('/api/porthole/v1/ingest/drain',{})
 assert.equal((await value(await query({expression:'synthetic_porthole_units',time:reference.end}))).evaluation.result.length,2)
 const grouped=await query({expression:'sum by (team) (synthetic_porthole_units)',time:reference.end});assert.equal(grouped.status,400);assert.equal((await grouped.json()).error,'incompatible_metric_units')
 const start=String(at-20000000000n),end=at.toString(),settings={start,end,step:20,lookback:5}
 const rangeName='synthetic_porthole_range_units',compatibleName='synthetic_porthole_range_same_units'
 const rangeRows=[
  {labels:{__name__:rangeName,lane:'a'},kind:'gauge',unit:'ms',samples:[{time:start,value:100}]},
  {labels:{__name__:rangeName,lane:'b'},kind:'gauge',unit:'s',samples:[{time:end,value:1}]},
 ]
 await value(await send('/v1/metrics',metricPacket([...rangeRows,...rangeRows.map(row=>({...row,labels:{...row.labels,__name__:compatibleName},unit:'ms'}))]),{authorization:'Bearer '+source.secret}))
 await post('/api/porthole/v1/ingest/drain',{})
 const separate=await value(await query({expression:rangeName,...settings}))
 assert.deepEqual(separate.evaluation.result.map(row=>({lane:row.metric.lane,unit:row.unit,values:row.values})),[
  {lane:'a',unit:'ms',values:[[start,100]]},{lane:'b',unit:'s',values:[[end,1]]},
 ],'separate lanes retain their own units and absent intervals')
 const compatible=await value(await query({expression:`sum by (team) (${compatibleName})`,...settings}))
 assert.equal(compatible.evaluation.state,'complete');assert.equal(compatible.evaluation.result.length,1)
 assert.deepEqual(compatible.evaluation.result[0],{metric:{team:'commerce'},unit:'ms',values:[[start,100],[end,1]]},'range sums across different lanes with the same unit remain supported')
 const rangeGroup=await query({expression:`sum by (team) (${rangeName})`,...settings}),body=await rangeGroup.json()
 console.log('PROBE PORT-014 A '+JSON.stringify({backend:separate.analytical?.role??'local',door:'/api/porthole/v1/query',input:{expression:`sum by (team) (${rangeName})`,...settings},status:rangeGroup.status,output:body}))
 assert.equal(rangeGroup.status,400,'range sum refuses incompatible units at nonoverlapping evaluation instants')
 assert.equal(body.error,'incompatible_metric_units');assert.ok(!JSON.stringify(body).includes('"state":"complete"'))
 return types.length+4
}
async function promqlBrowser({context,reference,initial,backend,snapshot}) {
 const {chromium}=await import('@playwright/test'),{origin,cookie,call}=context
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const directory=process.env.PORTHOLE_EVIDENCE_DIR;if(directory)await mkdir(directory,{recursive:true})
 try{for(const width of [1440,390]) {
  const state=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:width===1440?900:844}})
  await state.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
  await state.route(origin+'/**',async route=>{const request=route.request(),url=new URL(request.url()),response=await call(url.pathname+url.search,{method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
  const page=await state.newPage(),capture=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'reflow without horizontal page overflow');if(directory)await page.screenshot({path:join(directory,`promql-${backend}-${name}-${width}.png`),fullPage:true})}
  await page.goto(origin+'/app/explore');await page.getByLabel('Signal',{exact:true}).selectOption('metrics');await page.getByLabel('Service',{exact:true}).fill('checkout-promql');await page.getByLabel('Environment',{exact:true}).fill('promql');await page.getByLabel('Team',{exact:true}).fill('commerce')
  await page.getByText('Text query',{exact:true}).click();await page.getByLabel('Dialect',{exact:true}).selectOption('promql');await page.getByLabel('Expression',{exact:true}).fill('sum by (team) (synthetic_porthole_queue)');await page.getByLabel('Instant time in nanoseconds',{exact:true}).fill(reference.end)
  await page.getByLabel('Expression',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Instant time in nanoseconds',{exact:true}).evaluate(element=>element===document.activeElement),true)
  await capture('editor');await page.getByRole('button',{name:'Run query',exact:true}).click();await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
  if(width===1440){const result=JSON.parse(await page.locator('pre').innerText());assert.equal(result.evaluation.result[0].value[1],48*7+47*48/2+999)}
  await capture('completed')
  for(const [name,expression] of [['empty','synthetic_porthole_queue{lane="missing"}'],['stale-input','synthetic_porthole_stale'],['invalid','avg(synthetic_porthole_queue)']]) {
   const params=new URLSearchParams({dialect:'promql',expression,time:reference.end})
   const response=await page.goto(origin+'/app/explore?'+params)
   if(width===1440){assert.equal(response.status(),name==='invalid'?400:200);if(name!=='invalid')assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).evaluation.result,[]);else assert.ok(await page.getByRole('alert').isVisible())}
   await capture(name)
  }
  const unitResponse=await page.goto(origin+'/app/explore?'+new URLSearchParams({dialect:'promql',expression:'sum by (team) (synthetic_porthole_range_units)',start:String(BigInt(reference.end)-20000000000n),end:reference.end,step:'20',lookback:'5'}))
  assert.equal(unitResponse.status(),400);assert.match(await page.getByRole('alert').innerText(),/incompatible.metric.units/)
  await capture('incompatible-range-units')
  const small=await page.locator('main').evaluate(element=>[...element.querySelectorAll('p,a,label,input,select,textarea,button,pre,summary')].filter(node=>parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.tagName));assert.deepEqual(small,[])
  await state.clearCookies();const response=await page.goto(origin+'/app/explore?'+new URLSearchParams({dialect:'promql',expression:'synthetic_porthole_queue',time:reference.end}));if(width===1440)assert.equal(response.status(),401);await capture('unauthorized')
  await state.close()
 }}finally{await browser.close()}
}
export async function promqlJourney(backend='both') {
 assert.ok(['both','local','analytical'].includes(backend),'explicit supported journey backend')
 const reference=await prometheusReference()
 try {
  const {recipientMailJourney}=await import('./health.mjs')
  if(backend!=='analytical')await recipientMailJourney({run:context=>promqlNativeJourney(context,reference)})
  const {promqlAnalyticalJourney}=await import('./analytics.mjs')
  if(backend!=='local')await promqlAnalyticalJourney(reference)
 }finally{await reference.close()}
 console.log('promqlJourney passed: scalar subset compared with stock Prometheus 3.5.0; backend='+backend)
}
