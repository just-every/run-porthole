import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {clusterBrowser} from './log-clusters.mjs'
const require=createRequire(import.meta.resolve('@opentelemetry/sdk-node'))
const {MeterProvider,MetricReader}=require('@opentelemetry/sdk-metrics')
const {resourceFromAttributes}=require('@opentelemetry/resources')
const {OTLPMetricExporter}=require('@opentelemetry/exporter-metrics-otlp-http')
const scope={service:'synthetic-porthole-9901',environment:'synthetic-porthole-9902',team:'synthetic-porthole-9903'}
const names={turnover:'synthetic-porthole-9904',same:'synthetic-porthole-9905',incompatible:'synthetic-porthole-9906',unsupported:'synthetic-porthole-9907',paged:'synthetic-porthole-9908',counter:'synthetic-porthole-9909'}
class ManualReader extends MetricReader {async onForceFlush(){} async onShutdown(){}}

/** Two independent stock SDK gauge producers, with a pinned producer clock.
 * Only transport is relayed; the exporter wire enters actual OTLP intake. */
async function produce({call,secret,at}){
 const wire=[],receipts=[]
 const relay=createServer(async(request,response)=>{
  try{const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks);wire.push(JSON.parse(body));const accepted=await call('/v1/metrics',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body});receipts.push(accepted.status);response.writeHead(accepted.status,{'content-type':'application/json'});response.end(Buffer.from(await accepted.arrayBuffer()))}catch{response.writeHead(500);response.end()}
 })
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve))
 try{for(const index of [0,1]){
  const reader=new ManualReader(),provider=new MeterProvider({resource:resourceFromAttributes({'service.name':scope.service,'deployment.environment.name':scope.environment,'team.name':scope.team,'service.instance.id':'synthetic-porthole-'+(9910+index)}),readers:[reader]})
  const exporter=new OTLPMetricExporter({url:'http://127.0.0.1:'+relay.address().port+'/v1/metrics'}),meter=provider.getMeter('synthetic-porthole-9912')
  try{
   const counter=meter.createCounter(names.counter,{unit:'ms'})
   const gauges={turnover:meter.createGauge(names.turnover,{unit:index?'s':'ms'}),same:meter.createGauge(names.same,{unit:'ms'}),incompatible:meter.createGauge(names.incompatible,{unit:index?'By':'ms'}),unsupported:meter.createGauge(names.unsupported,{unit:index?'synthetic-porthole-9913':'{request}'}),paged:meter.createGauge(names.paged,{unit:'ms'})}
   for(const offset of index===0?[0]:[0,20000]){
    const now=Date.now;let metrics
    try{Date.now=()=>at+offset
     if(index===offset/20000){gauges.turnover.record(index?3:400,{region:'us-east'});gauges.same.record(index?3000:400,{region:'us-east'})}
     if(offset===0){counter.add(1,{region:'us-east'});gauges.incompatible.record(index?3:400,{region:'us-east'});gauges.unsupported.record(index?3:400,{region:'us-east'});if(index===0)for(let slot=0;slot<205;slot++)gauges.paged.record(1,{region:'us-east',slot})}
     metrics=(await reader.collect()).resourceMetrics
    }finally{Date.now=now}
    await new Promise((resolve,reject)=>exporter.export(metrics,result=>result.code===0?resolve():reject(result.error??Error('stock metric export failed'))))
   }
  }finally{await provider.shutdown();await exporter.shutdown()}
 }}finally{await new Promise(resolve=>relay.close(resolve))}
 assert.ok(receipts.length>=2);assert.ok(receipts.every(status=>status===200),JSON.stringify(receipts))
 return wire
}

export async function metricUnitsJourney({origin,cookie,call=(path,options)=>fetch(origin+path,options),sql,restartWorker,backend='local',screens=true,at=Date.now()-60000}){
 const post=(path,data,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Scalar gauge producers',class:'ingest',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.write']}}),201)
 const T=BigInt(at)*1000000n,wire=await produce({call,secret:source.secret,at})
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const query={...scope,signal:'metrics',dialect:'visual',mode:'range',start:String(T),end:String(T+20000000000n),step:20,lookback:10,groupBy:'service,region',aggregation:'sum'}
 const run=(metric=names.same,extra={},headers)=>post('/api/porthole/v1/query',{...query,metric,...extra},headers)
 const expected=[{timestamp:String(T).padStart(20,'0'),value:400,contributors:1},{timestamp:String(T+20000000000n).padStart(20,'0'),value:3000,contributors:1}]
 const turnoverRaw=await value(await post('/api/porthole/v1/query',{...scope,signal:'metrics',metric:names.turnover}))
 assert.deepEqual(turnoverRaw.records.map(row=>[row.event_time_ns,row.payload.metric.unit,Number(row.payload.record.asDouble??row.payload.record.asInt)]),[[String(T).padStart(20,'0'),'ms',400],[String(T+20000000000n).padStart(20,'0'),'s',3]])
 assert.equal(new Set(turnoverRaw.records.map(row=>row.payload.resource.attributes.find(attribute=>attribute.key==='service.instance.id').value.stringValue)).size,2,'two real stock producers contribute to one group at different instants')
 const same=await value(await run())
 assert.equal(same.range.state,'complete');assert.equal(same.cursor,null);assert.equal(same.range.series.length,1)
 assert.deepEqual(same.range.series[0],{labels:{service:scope.service,region:{stringValue:'us-east'}},unit:'ms',points:expected})
 assert.equal(same.analytical?.role,backend==='local'?undefined:'primary')
 const replay=await value(await call(same.replay,{headers:{cookie}}));assert.deepEqual(replay.range,same.range);assert.equal(replay.snapshot,same.snapshot)
 const paged=await value(await run(names.paged,{end:String(T)}));assert.equal(paged.range.series[0].points[0].value,205);assert.equal(paged.range.series[0].points[0].contributors,205)
 for(const aggregation of ['average','min','max']){const result=await value(await run(names.paged,{end:String(T),aggregation}));assert.equal(result.range.series[0].points[0].value,1)}
 const absent=await value(await run(names.same,{end:String(T+40000000000n)}));assert.deepEqual(absent.range.series[0].points,expected,'missing lookback stays absent, with no zero-fill')
 const separated=await value(await run(names.turnover,{groupBy:'service.instance.id'}));assert.deepEqual(separated.range.series.map(series=>[series.unit,series.points.map(point=>point.value)]).sort(),[['ms',[400]],['s',[3]]])
 for(const extra of [{step:0},{lookback:0},{groupBy:'region,region'},{end:String(T-1n)},{snapshot:same.snapshot+10000},{cursor:'synthetic-porthole-9914'},{dialect:'promql',expression:names.same}])assert.equal((await run(names.same,extra)).status,400)
 assert.equal((await value(await run(names.counter),400)).error,'unsupported_metric_range_type')
 const readRaw=async()=>{const result=await value(await post('/api/porthole/v1/query',{...scope,signal:'metrics',metric:names.incompatible,limit:200}));return result.records}
 const original=await readRaw()
 const dashboard=await value(await post('/api/porthole/v1/dashboards',{name:'Private scalar gauge view',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team]},body:{panels:[{id:'same',title:'Gauge sample',signal:'metrics',service:scope.service,metric:names.same,aggregate:'average',unit:'ms'}],variables:{team:scope.team,environment:scope.environment},range:{from:String(T),through:String(T+20000000000n)},annotations:[]}},{cookie,'idempotency-key':crypto.randomUUID()}),201)
 const readDashboard=()=>call('/api/porthole/v1/dashboards/'+dashboard.id,{headers:{cookie}}).then(value)
 const beforeDashboard=await readDashboard(),before=sql?await sql('SELECT * FROM porthole_query_snapshots ORDER BY id'):null
 for(const metric of [names.turnover,names.incompatible,names.unsupported]){
  const refused=await value(await run(metric),400);assert.equal(refused.error,'incompatible_metric_range_units');assert.ok(!refused.range&&!refused.queryRef,'no misleading completed or saved result')
 }
 if(sql)assert.deepEqual(await sql('SELECT * FROM porthole_query_snapshots ORDER BY id'),before,'refusals create no saved query snapshots')
 assert.deepEqual(await readDashboard(),beforeDashboard);assert.deepEqual(await readRaw(),original,'refusal leaves original metric rows and units unchanged')
 assert.deepEqual((await value(await call(same.replay,{headers:{cookie}}))).range,same.range,'previous saved result remains reproducible')

 if(screens)await metricUnitsBrowser({origin,cookie,call,query,metric:names.same,refused:names.turnover,expected})
 if(restartWorker){await restartWorker();const replayed=await value(await call(same.replay,{headers:{cookie}}));assert.deepEqual(replayed.range,same.range)}
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Range reader',class:'read',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.read']}}),201)
 const headers={authorization:'Bearer '+reader.secret},bearer=await value(await run(names.same,{},headers));assert.deepEqual(bearer.range,same.range)
 assert.equal((await run(names.same,{team:'synthetic-porthole-9999'},headers)).status,403,'bearer scope cannot expand through an owner cookie')
 const limited=await value(await post('/app/settings/credentials/mint',{name:'Bounded gauge reader',class:'read',scope:{services:[scope.service],environments:[scope.environment],teams:[scope.team],signals:['metrics'],actions:['telemetry.read']},scannedBytesPerDay:1}),201)
 const throttled=await run(names.same,{}, {authorization:'Bearer '+limited.secret})
 assert.equal(throttled.status,429);assert.ok(Number(throttled.headers.get('retry-after'))>0);assert.deepEqual(await throttled.json(),{error:'credential_quota_exceeded'})
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))
 assert.equal((await run(names.same,{},headers)).status,401);assert.equal((await call(bearer.replay,{headers})).status,401)
 assert.equal((await run(names.same,{team:'synthetic-porthole-9999'},headers)).status,401)
 const exported=await value(await post('/api/porthole/v1/archive/exports',{}),201),savedRows=[]
 for(let index=0;index<exported.totalChunks;index++){const chunk=await value(await call('/api/porthole/v1/archive/exports/'+exported.id+'/chunks/'+index,{headers:{cookie}}));savedRows.push(...chunk.rows)}
 await value(await call('/api/porthole/v1/archive/exports/'+exported.id+'/manifest',{headers:{cookie}}))
 const portable=savedRows.find(item=>item.table==='porthole_query_snapshots'&&item.row.id===same.queryRef)
 assert.ok(portable,'a completed gauge range remains a valid installation archive snapshot')
 const descriptor=JSON.parse(portable.row.scope);assert.equal(descriptor.mode,'range');assert.equal(descriptor.start,query.start);assert.equal(descriptor.end,query.end);assert.equal(descriptor.groupBy,query.groupBy);assert.equal(descriptor.aggregation,'sum')
 assert.ok(wire.some(packet=>JSON.stringify(packet).includes(names.turnover)))
 console.log('metricUnitsJourney passed ('+backend+'): stock OTLP producers, grouped 400 ms and 3 s turnover refusal, same-unit [400,3000] ms, 205 contributors, incompatible and unsupported no-effect refusals, immutable replay and revocation')
 return {query,same,expected}
}

export async function metricUnitsBrowser({origin,cookie,call,query,metric,refused,expected}){
 const path='/app/explore?'+new URLSearchParams({...query,metric})
 await clusterBrowser({origin,cookie,call,path,name:'metric-range-result',contains:['Range complete','Unit: ms'],exercise:async page=>{const result=JSON.parse(await page.locator('pre').innerText());assert.deepEqual(result.range.series[0].points,expected);assert.equal(result.range.series[0].unit,'ms')}})
 await clusterBrowser({origin,cookie,call,path:'/app/explore?'+new URLSearchParams({...query,metric:refused}),status:400,name:'metric-range-refusal',contains:['incompatible metric range units'],exercise:async page=>{assert.equal(await page.getByRole('heading',{name:'Range complete',exact:true}).count(),0);assert.equal(await page.locator('pre').count(),0)}})
 await clusterBrowser({origin,cookie,call,path:'/app/explore',name:'metric-range-editor',exercise:async page=>{
  await page.getByLabel('Signal',{exact:true}).selectOption('metrics');for(const [label,text]of [['Service',scope.service],['Environment',scope.environment],['Team',scope.team],['Metric name',metric]])await page.getByLabel(label,{exact:true}).fill(text)
  await page.getByText('Gauge range',{exact:true}).click();await page.getByLabel('Evaluation',{exact:true}).selectOption('range')
  for(const [label,key]of [['Start in nanoseconds','start'],['End in nanoseconds','end'],['Step in seconds','step'],['Lookback in seconds','lookback'],['Group labels','groupBy']])await page.getByLabel(label,{exact:true}).fill(String(query[key]))
  await page.getByLabel('Aggregation',{exact:true}).selectOption('sum');await page.getByRole('button',{name:'Run query',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Range complete',exact:true}).waitFor();assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).range.series[0].points,expected)
 }})
}
