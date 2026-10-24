import assert from 'node:assert/strict'

/** Runs after the dashboard journey has ingested its three real signals. */
export async function explorationJourney({origin,cookie}) {
 const post=(body,session=cookie)=>fetch(origin+'/api/porthole/v1/query',{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify(body)})
 const value=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
 const scope={service:'checkout',environment:'production',team:'commerce'}
 const ids=rows=>rows.map(row=>row.id).sort()
 const metric=await value(await post({...scope,signal:'metrics',metric:'checkout.cpu'}))
 assert.equal(metric.records.length,2)
 const selector='{__name__="checkout.cpu",service="checkout",environment="production",team="commerce"}'
 const selected=await value(await post({...scope,dialect:'promql',expression:selector,snapshot:metric.snapshot}))
 assert.deepEqual(ids(selected.records),ids(metric.records))
 assert.equal(selected.parameters.metric,'checkout.cpu');assert.equal(selected.source.text,selector)
 assert.ok(!selected.aggregate,'selector exploration returns samples without a fabricated Prometheus evaluation')
 const first=await value(await post({dialect:'promql',expression:selector,snapshot:metric.snapshot,limit:1}))
 assert.equal(first.records.length,1);assert.ok(first.cursor)
 const next=await value(await post({dialect:'promql',expression:selector,snapshot:first.snapshot,limit:1,cursor:first.cursor}))
 assert.deepEqual(ids([...first.records,...next.records]),ids(metric.records))
 const averageExpression="SELECT AVG(value) FROM metrics WHERE metric='checkout.cpu' AND service='checkout' AND environment='production' AND team='commerce'"
 const average=await value(await post({dialect:'sql',expression:averageExpression,snapshot:metric.snapshot}))
 assert.deepEqual(ids(average.records),ids(metric.records));assert.equal(average.aggregate.value,30)
 assert.equal(average.aggregate.state,'complete');assert.equal(average.aggregate.count,2)
 const logs=await value(await post({...scope,signal:'logs'}))
 assert.equal(logs.records.length,2)
 const count=await value(await post({...scope,dialect:'sql',expression:"SELECT COUNT(*) FROM logs WHERE service='checkout' AND environment='production' AND team='commerce'",snapshot:logs.snapshot}))
 assert.deepEqual(ids(count.records),ids(logs.records));assert.equal(count.aggregate.value,logs.records.length)
 const lucene=await value(await post({dialect:'lucene',expression:'service:checkout AND environment:production AND team:commerce',snapshot:logs.snapshot}))
 assert.deepEqual(ids(lucene.records),ids(logs.records))
 const traces=await value(await post({...scope,signal:'traces'}))
 assert.equal(traces.records.length,3)
 const percentile=await value(await post({dialect:'sql',expression:"SELECT PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration) FROM traces WHERE service='checkout' AND environment='production' AND team='commerce'",snapshot:traces.snapshot}))
 assert.deepEqual(ids(percentile.records),ids(traces.records));assert.equal(percentile.aggregate.value,400)
 const range={from:metric.records[0].event_time_ns,through:metric.records.at(-1).event_time_ns}
 const ranged=await value(await post({...scope,...range,dialect:'sql',expression:averageExpression,snapshot:metric.snapshot}))
 assert.deepEqual(ids(ranged.records),ids(metric.records));assert.equal(ranged.parameters.from,range.from);assert.equal(ranged.parameters.through,range.through)
 const visual=await value(await post({...scope,signal:'metrics',metric:'checkout.cpu',dialect:'visual',expression:'',from:'',through:'',cursor:'',snapshot:'',limit:'',trace:''}))
 assert.deepEqual(ids(visual.records),ids(metric.records))
 const refused=[
  {dialect:'promql',expression:`avg(${selector})`},
  {dialect:'promql',expression:'{__name__="checkout.cpu",service=~".*"}'},
  {dialect:'promql',expression:'{__name__="checkout.cpu",unknown="ignored"}'},
  {dialect:'sql',expression:"SELECT AVG(value) FROM metrics WHERE metric='checkout.cpu' OR team='commerce'"},
  {dialect:'sql',expression:'SELECT COUNT(*) FROM logs; DELETE FROM logs'},
  {dialect:'sql',expression:"SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) FROM traces"},
  {dialect:'sql',expression:averageExpression,team:'payments'},
  {dialect:'sql',expression:averageExpression,metric:'unrelated'},
  {dialect:'sql',expression:averageExpression,signal:'logs'},
  {dialect:'lucene',expression:'service:checkout "Checkout dependency waiting"'},
  {dialect:'lucene',expression:'service:checkout -team:payments'},
  {dialect:'visual',expression:'service:checkout',signal:'logs'},
  {dialect:'sql',expression:averageExpression,unknown:'filter'},
 ]
 const responses=await Promise.all(refused.map(query=>post(query)))
 assert.ok(responses.every(response=>response.status===400),'unsupported syntax and conflicts refuse before execution')
 assert.equal((await post({dialect:'sql',expression:averageExpression},'')).status,401)
}
