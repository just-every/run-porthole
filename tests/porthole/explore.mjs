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
 const responses=[]
 // This validates query syntax, not audit saturation. Keep the host's two-worker
 // limit while retaining every refusal case and its exact expected response.
 for(let offset=0;offset<refused.length;offset+=2)responses.push(...await Promise.all(refused.slice(offset,offset+2).map(query=>post(query))))
 assert.ok(responses.every(response=>response.status===400),'unsupported syntax and conflicts refuse before execution: '+JSON.stringify(await Promise.all(responses.map(async response=>({status:response.status,error:(await response.clone().json()).error})))))
 assert.equal((await post({dialect:'sql',expression:averageExpression},'')).status,401)
}

export async function observabilityAgentJourney({origin,cookie,freshOwner}) {
 cookie=await freshOwner()
 const query={service:'checkout',environment:'production',team:'commerce'}
 const post=(path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json',...extra},body:JSON.stringify(body)})
 const mint=await post('/app/settings/credentials/mint',{name:'Checkout coding agent',class:'read',scope:{services:['checkout'],environments:['production'],teams:['commerce'],signals:['logs','traces'],actions:['telemetry.read']}})
 assert.equal(mint.status,201)
 const key=await mint.json(),headers={authorization:`Bearer ${key.secret}`}
 // stdin is explicit: the CLI is used exactly as an external coding agent uses it.
 const {spawn}=await import('node:child_process')
 const cli=await new Promise((resolve,reject)=>{
  const processHandle=spawn(process.execPath,['cli/porthole.mjs',origin,'query','--all'],{env:{...process.env,PORTHOLE_CREDENTIAL:key.secret,PORTHOLE_SESSION:''},stdio:['pipe','pipe','pipe']})
  let stdout='',stderr='';processHandle.stdout.on('data',v=>stdout+=v);processHandle.stderr.on('data',v=>stderr+=v);processHandle.on('error',reject);processHandle.on('exit',code=>resolve({code,stdout,stderr}));processHandle.stdin.end(JSON.stringify({...query,signal:'logs',limit:1}))
 })
 assert.equal(cli.code,0,cli.stderr)
 const pages=cli.stdout.trim().split('\n').map(line=>JSON.parse(line)),logs=pages.flatMap(page=>page.records)
 assert.equal(logs.length,2);assert.ok(pages.length>1)
 const rpc=async args=>post('/api/porthole/v1/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'query_telemetry',arguments:args}},headers)
 const spansResponse=await rpc({...query,signal:'traces'});assert.equal(spansResponse.status,200)
 const spans=(await spansResponse.json()).result.structuredContent
 const logResponse=await rpc({...query,signal:'logs',snapshot:pages[0].snapshot});assert.equal(logResponse.status,200)
 const citedLogs=(await logResponse.json()).result.structuredContent
 assert.deepEqual(citedLogs.records.map(row=>row.id),logs.map(row=>row.id))
 const duration=Math.max(...spans.records.map(row=>Number(BigInt(row.payload.record.endTimeUnixNano)-BigInt(row.payload.record.startTimeUnixNano))/1e6))
 assert.equal(duration,400);assert.ok(logs.some(row=>row.payload.record.body.stringValue.includes('dependency waiting')))
 for(const reference of [spans.queryRef,citedLogs.queryRef])assert.match(reference,/^[a-f0-9-]{36}$/)
 assert.equal((await rpc({...query,signal:'logs',team:'payments'})).status,403)
 assert.equal((await post('/api/porthole/v1/approvals',{id:'synthetic-porthole-230',confirm:'approve'},headers)).status,403)
 const observations={hypothesis:'Dependency wait accompanies slow checkout spans',maxObservedDurationMs:duration,citations:[spans.queryRef,citedLogs.queryRef]}
 console.log('Read-only coding-agent observation '+JSON.stringify(observations))
}
