import assert from 'node:assert/strict'
/** Independently enumerated scalar corpus, submitted through actual OTLP intake. */
export async function metricQueryJourney({origin,cookie,call,backend}){
 const post=(path,body,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const scope={services:['checkout','billing'],environments:['query-metrics','prod'],teams:['commerce','payments'],signals:['metrics'],actions:['telemetry.write']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Metric query corpus',class:'ingest',scope}),201)
 const time=BigInt(Math.floor(Date.now()/60000)*60)*1000000000n,at=delta=>String(time+BigInt(delta)*1000000000n)
 const attr=(key,stringValue)=>({key,value:{stringValue}})
 const resource=(host,team='commerce',service='checkout')=>({attributes:[attr('host.name',host),attr('service.name',service),attr('team.name',team),attr('deployment.environment.name','query-metrics')]})
 const metrics=(values,unit='%')=>[{name:'system.cpu.user',unit,gauge:{dataPoints:values.map(([second,asDouble])=>({timeUnixNano:at(second),asDouble}))}}]
 const packet={resourceMetrics:[
  {resource:resource('checkout-a'),scopeMetrics:[{metrics:metrics([[0,10],[10,30],[20,50]])}]},
  {resource:resource('checkout-b'),scopeMetrics:[{metrics:metrics([[0,20],[10,40],[20,60]])}]},
  {resource:resource('checkout-z','payments','billing'),scopeMetrics:[{metrics:metrics([[0,900]])}]},
  {resource:{attributes:[attr('host.name','checkout-a'),attr('service.name','checkout'),attr('team.name','commerce'),attr('deployment.environment.name','prod')]},scopeMetrics:[{metrics:metrics([[0,10],[10,30],[20,50]])}]},
  {resource:resource('checkout-types'),scopeMetrics:[{metrics:[{name:'wire.int',unit:'1',gauge:{dataPoints:[{timeUnixNano:at(0),asInt:'23'}]}},{name:'wire.text',unit:'1',gauge:{dataPoints:[{timeUnixNano:at(0),asDouble:'23'}]}},{name:'mixed.unit',unit:'ms',gauge:{dataPoints:[{timeUnixNano:at(0),asDouble:1}]}}]}]},
  {resource:resource('checkout-unit'),scopeMetrics:[{metrics:[{name:'mixed.unit',unit:'s',gauge:{dataPoints:[{timeUnixNano:at(0),asDouble:1}]}}]}]},
  ...Array.from({length:201},(_,index)=>({resource:resource('checkout-page-'+index),scopeMetrics:[{metrics:[{name:'multi.page',unit:'1',gauge:{dataPoints:[{timeUnixNano:at(0),asDouble:index===200?1000:1}]}}]}]})),
 ]}
 assert.equal((await post('/v1/metrics',packet,{authorization:'Bearer '+source.secret,'x-porthole-batch-id':'synthetic-porthole-2100'})).status,200)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Metric query reader',class:'read',scope:{services:['checkout'],environments:['query-metrics','prod'],teams:['commerce'],signals:['metrics'],actions:['telemetry.read']}}),201),headers={authorization:'Bearer '+reader.secret}
 const base={dialect:'datadog',from:at(0),through:at(20),team:'commerce'},selector='avg:system.cpu.user{env:query-metrics,service:checkout} by {host}'
 const query=expression=>post('/api/porthole/v1/query',{...base,expression},headers)
 const average=await value(await query(selector));assert.equal(average.source.text,selector);assert.equal(average.plan.dialect,'datadog-metrics');assert.equal(average.analytical?.role,backend==='local'?undefined:'primary')
 const literal='avg:system.cpu.user{env:prod} by {host}',documented=await value(await query(literal));assert.equal(documented.source.text,literal);assert.deepEqual(documented.metricResult.series[0].points.map(point=>point.value),[10,30,50])
 assert.deepEqual(average.metricResult.series.map(row=>[row.dimensions.host,row.unit,row.points.map(point=>point.value)]),[['checkout-a','%',[10,30,50]],['checkout-b','%',[20,40,60]]])
 const flat=await value(await query('avg:system.cpu.user{env:query-metrics,service:checkout}'))
 assert.deepEqual(flat.metricResult.series[0].points.map(point=>point.value),[15,35,55])
 for(const [aggregation,expected]of [['sum',[30,70,110]],['min',[10,30,50]],['max',[20,40,60]]]){
  const result=await value(await query(aggregation+':system.cpu.user{env:query-metrics,service:checkout}'));assert.deepEqual(result.metricResult.series[0].points.map(point=>point.value),expected)
 }
 const rate=await value(await query('per_second('+selector+')'));assert.deepEqual(rate.metricResult.series.map(row=>row.points.map(point=>point.value)),[[null,2,2],[null,2,2]]);assert.equal(rate.metricResult.series[0].unit,'%/s')
 const rolled=await value(await query(selector+'.rollup(avg,60) * 2'));assert.deepEqual(rolled.metricResult.series.map(row=>row.points.map(point=>point.value)),[[60],[80]])
 const shifted=await value(await post('/api/porthole/v1/query',{...base,from:at(10),through:at(30),expression:'timeshift('+selector+', -10)'},headers));assert.deepEqual(shifted.metricResult.series[0].points.map(point=>[point.timeNs,point.value]),[[at(10),10],[at(20),30],[at(30),50]])
 const divide=await value(await query(selector+' / 0'));assert.ok(divide.metricResult.series.every(row=>row.points.every(point=>point.value===null&&point.missing==='division_by_zero')))
 const replay=await value(await call(shifted.replay,{headers}));assert.deepEqual(replay.metricResult.series,shifted.metricResult.series,'replay retains requested time bounds, rather than shifting them twice')
 const exported=await call(average.replay+'/export',{headers});assert.equal(exported.status,200);assert.deepEqual(JSON.parse((await exported.text()).trim()).metricResult.series,average.metricResult.series)
 const absent=await value(await query('avg:missing.metric{env:query-metrics}'));assert.equal(absent.metricResult.state,'empty');assert.deepEqual(absent.metricResult.series,[])
 const integer=await value(await query('avg:wire.int{env:query-metrics}'));assert.equal(integer.metricResult.series[0].points[0].value,23)
 const complete=await value(await query('avg:multi.page{env:query-metrics}'));assert.equal(complete.metricResult.statistics.usedRecords,201);assert.ok(Math.abs(complete.metricResult.series[0].points[0].value-1200/201)<1e-12,'a second raw page contributes to the complete space aggregate')
 const text=await query('avg:wire.text{env:query-metrics}');assert.equal(text.status,400);assert.equal((await text.json()).error,'non_numeric_metric_value')
 const incompatible=await query('avg:mixed.unit{env:query-metrics}');assert.equal(incompatible.status,400);assert.equal((await incompatible.json()).error,'incompatible_metric_units')
 for(const expression of ['median:system.cpu.user{env:query-metrics}','avg:system.cpu.user{env:query-metrics}.unknown()','avg:system.cpu.user{env:query-metrics,service:billing}','avg:system.cpu.user{team:payments}','avg:system.cpu.user{env:query-metrics} + avg:system.cpu.user{service:billing}']){
  const response=await query(expression);assert.ok([400,403].includes(response.status),await response.clone().text())
 }
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))
 assert.equal((await call(average.replay,{headers})).status,401);assert.equal((await call(average.replay+'/export',{headers})).status,401)
 return {selector:literal,environment:'prod',from:at(0),through:at(20)}
}
