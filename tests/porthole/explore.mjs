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
  {dialect:'lucene',expression:'service:checkout @http.status_code:>not-a-number'},
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

/** One corpus journey runs through the product with each real query backend. */
export async function nativeLogSearchJourney({origin,cookie,call=(path,options)=>fetch(origin+path,options),backend='local',screens=true,pauseNextQuery,signIn}) {
 const {logSearchPacket,logSearchCases,logSearchExpression}=await import('./log-search-corpus.mjs')
 const post=(path,body,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const scope={services:['checkout'],environments:['log-search'],teams:['commerce'],signals:['logs'],actions:['telemetry.read']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Log search corpus source',class:'ingest',scope:{...scope,services:['checkout','billing'],teams:['commerce','payments'],actions:['telemetry.write']}}),201)
 const time=BigInt(Date.now())*1000000n,packet=logSearchPacket(time)
 const emit=()=>post('/v1/logs',packet,{authorization:'Bearer '+source.secret,'x-porthole-batch-id':'synthetic-porthole-2040'})
 const accepted=await emit();assert.equal(accepted.status,200,await accepted.clone().text());const batch=accepted.headers.get('x-porthole-batch');assert.ok(batch)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Log search corpus reader',class:'read',scope}),201)
 const headers={authorization:'Bearer '+reader.secret}
 const base={dialect:'lucene',environment:'log-search',team:'commerce',limit:2}
 let snapshot
 const query=body=>post('/api/porthole/v1/query',{...base,...body},headers)
 const expectedIds=ordinals=>ordinals.map(index=>batch+':'+index).sort()
 let firstPage
 for(const [expression,ordinals] of logSearchCases){
  let cursor,records=[],pages=0
  do {
   const result=await value(await query({expression,...(snapshot===undefined?{}:{snapshot}),...(cursor?{cursor}:{})}))
   snapshot??=result.snapshot;assert.equal(result.snapshot,snapshot);assert.equal(result.analytical?.role,backend==='local'?undefined:'primary');assert.equal(result.source.text,expression);assert.equal(result.source.dialect,'lucene');assert.equal(result.plan.version,1)
   records.push(...result.records);cursor=result.cursor;assert.ok(++pages<10,'bounded corpus pagination terminates')
   if(expression===logSearchExpression&&!firstPage)firstPage=result
  }while(cursor)
  assert.deepEqual(records.map(row=>row.id).sort(),expectedIds(ordinals),backend+': '+expression)
  assert.equal(records.length,ordinals.length)
  assert.ok(records.every(row=>row.service==='checkout'&&row.team==='commerce'&&row.environment==='log-search'))
 }
 const repeated=await value(await call(firstPage.replay,{headers}))
 assert.deepEqual(repeated.records.map(row=>row.id),firstPage.records.map(row=>row.id));assert.equal(repeated.source.text,logSearchExpression);assert.deepEqual(repeated.plan,firstPage.plan)
 const later=logSearchPacket(time+100n);later.resourceLogs=later.resourceLogs.slice(0,1)
 assert.equal((await post('/v1/logs',later,{authorization:'Bearer '+source.secret,'x-porthole-batch-id':'synthetic-porthole-2041'})).status,200)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const frozen=await value(await query({expression:logSearchExpression,snapshot,limit:200}))
 assert.deepEqual(frozen.records.map(row=>row.id).sort(),expectedIds([0,5,6]),'new completed batches cannot enter a retained snapshot')
 assert.equal((await value(await query({expression:logSearchExpression,limit:200}))).records.length,4)
 const bounded=await value(await query({expression:logSearchExpression,snapshot,from:String(time+1n),through:String(time+5n),limit:200}))
 assert.deepEqual(bounded.records.map(row=>row.id),expectedIds([5]),'native time boundaries intersect the typed log plan')
 for(const expression of ['service:billing','service:checkout OR service:billing','service:checkout -team:payments'])assert.equal((await query({expression,snapshot,team:undefined})).status,403,'explicit forbidden scope refuses: '+expression)
 const auditBefore=await value(await call('/api/v1/audit/export',{headers:{cookie}}))
 for(const expression of ['service:checkout @http.status_code:>nope','service:checkout @http.status_code:[500 TO "599"]','service:checkout @http.status_code:9007199254740993','service:checkout @literal:/star.*/','service:checkout status:error~2','service:checkout status:error^2','service:checkout (status:error OR)','service:checkout AND','service:checkout; DELETE FROM logs',Array(33).fill('@http.status_code:>=500').join(' '),'('.repeat(17)+'service:checkout'+')'.repeat(17)]){
  const response=await query({expression,snapshot});assert.equal(response.status,400,expression+': '+await response.clone().text());const error=await response.json();assert.ok(error.field);assert.ok(error.hint)
 }
 const auditAfter=await value(await call('/api/v1/audit/export',{headers:{cookie}}))
 const refs=audit=>audit.records.filter(row=>row.entry.action==='telemetry.query'&&row.entry.phase==='succeeded'&&row.entry.entityRef).length
 assert.equal(refs(auditAfter),refs(auditBefore),'unsupported expressions create no executable query snapshot')
 assert.equal((await post('/api/porthole/v1/query',{...base,expression:logSearchExpression},{})).status,401)
 const {queryToolsJourney}=await import('./query-tools.mjs')
 const tools=await queryToolsJourney({origin,cookie,call,base:{...base,expression:logSearchExpression},snapshot,headers,expected:expectedIds([0,5,6]),backend,signIn})
 const {metricQueryJourney}=await import('./metric-query.mjs')
 const metric=await metricQueryJourney({origin,cookie,call,backend})
 const {queryJoinJourney}=await import('./query-join.mjs')
 const joinQuery=await queryJoinJourney({origin,cookie,call,backend,pauseNextQuery})
 if(screens)await logSearchBrowser({origin,cookie,base,snapshot,expected:expectedIds([0,5,6]),expression:logSearchExpression,call,backend,metric,joinQuery,tools})
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))
 assert.equal((await query({expression:logSearchExpression,snapshot})).status,401)
 assert.equal((await call(firstPage.replay,{headers})).status,401,'a saved snapshot never revives revoked read authority')
 assert.equal((await call(tools.runRoot,{headers})).status,401)
 assert.equal((await call(tools.exportPath,{headers})).status,401)
 const replay=await emit();assert.equal(replay.status,200);assert.equal(replay.headers.get('x-porthole-batch'),batch)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const owner=await value(await post('/api/porthole/v1/query',{...base,expression:logSearchExpression,snapshot,limit:200}))
 assert.deepEqual(owner.records.map(row=>row.id).sort(),expectedIds([0,5,6]),'capture replay preserves exact row identity and counts')
 console.log('nativeLogSearchJourney passed ('+backend+'): typed ingested corpus, exact IDs and pages, scopes, snapshot replay, refusals and revoked credential')
}

async function logSearchBrowser({origin,cookie,base,snapshot,expected,expression,call,backend,metric,joinQuery,tools}) {
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const directory=process.env.PORTHOLE_EVIDENCE_DIR;if(directory)await mkdir(directory,{recursive:true})
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  // Bridge to the emitted Miniflare Worker when the analytical fixture owns it.
  if(backend!=='local')await context.route(origin+'/**',async route=>{
   const request=route.request(),url=new URL(request.url()),response=await call(url.pathname+url.search,{method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})})
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
  })
  const page=await context.newPage(),capture=async name=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow')
   const defects=await page.locator('main').evaluate(element=>[...element.querySelectorAll('p,a,label,input,select,textarea,button,pre,summary,h1')].flatMap(node=>{const style=getComputedStyle(node),borders=['Top','Right','Bottom','Left'].map(side=>parseFloat(style['border'+side+'Width']));return [parseFloat(style.fontSize)<13?'small text':null,parseFloat(style.borderRadius)>0&&borders.some(Boolean)&&!borders.every(value=>value===borders[0])?'one-sided rounded border':null,node.matches('button,a')&&!node.textContent.trim()&&!node.getAttribute('title')?'unlabeled icon control':null].filter(Boolean)}));assert.deepEqual(defects,[])
   if(directory)await page.screenshot({path:join(directory,`log-search-${backend}-${name}-${width}.png`),fullPage:true})
  }
  await page.goto(origin+'/app/explore');await page.getByLabel('Service',{exact:true}).fill('checkout');await page.getByLabel('Environment',{exact:true}).fill(base.environment);await page.getByLabel('Team',{exact:true}).fill(base.team)
  await page.locator('summary').filter({hasText:/^Text query$/}).click();await page.getByLabel('Dialect',{exact:true}).selectOption('lucene');await page.getByLabel('Expression',{exact:true}).fill(expression)
  await capture('editor');await page.getByRole('button',{name:'Run query',exact:true}).click();await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
  const displayed=JSON.parse(await page.locator('pre').innerText());assert.equal(displayed.source.text,expression);assert.equal(displayed.plan.version,1);assert.equal(displayed.records.length,4)
  await capture('results')
  const params=new URLSearchParams({...base,expression,snapshot:String(snapshot)});await page.goto(origin+'/app/explore?'+params)
  const records=JSON.parse(await page.locator('pre').innerText()).records
  await page.getByRole('link',{name:'Next page',exact:true}).click();records.push(...JSON.parse(await page.locator('pre').innerText()).records)
  assert.deepEqual(records.map(row=>row.id).sort(),expected)
  await capture('last-page')
  await page.goto(origin+'/app/explore/history');await page.getByRole('heading',{name:'Query history',exact:true}).waitFor();assert.ok(await page.getByRole('link',{name:/logs ·/}).count());await capture('history')
  const fillEditor=async(environment=base.environment)=>{await page.goto(origin+'/app/explore');await page.getByLabel('Service',{exact:true}).fill('checkout');await page.getByLabel('Environment',{exact:true}).fill(environment);await page.getByLabel('Team',{exact:true}).fill(base.team);await page.getByText('Text query',{exact:true}).click()}
  await fillEditor();await page.getByLabel('Dialect',{exact:true}).selectOption('lucene');await page.getByLabel('Expression',{exact:true}).fill(expression);await page.getByText('Query tools',{exact:true}).click();await page.getByRole('button',{name:'Estimate scan',exact:true}).click();await page.getByRole('heading',{name:'Query estimate',exact:true}).waitFor();const estimated=JSON.parse(await page.locator('pre').innerText());assert.equal(estimated.estimate.candidateRecords,10);assert.equal(estimated.coverage.complete,false);await capture('estimate')
  await fillEditor();await page.getByLabel('Dialect',{exact:true}).selectOption('lucene');await page.getByLabel('Expression',{exact:true}).fill('service:checkout');await page.getByText('Query tools',{exact:true}).click();await page.getByLabel('Candidates per page',{exact:true}).fill('200');await page.getByRole('button',{name:'Discover attributes',exact:true}).click();await page.getByRole('heading',{name:'Observed attributes',exact:true}).waitFor();assert.ok(JSON.parse(await page.locator('pre').innerText()).attributes.some(row=>row.path==='http.status_code'&&row.types.includes('string')));await capture('schema')
  await fillEditor();await page.getByLabel('Dialect',{exact:true}).selectOption('lucene');await page.getByLabel('Expression',{exact:true}).fill(expression);await page.getByText('Query tools',{exact:true}).click();await page.getByLabel('Candidates per page',{exact:true}).fill('2');await page.getByRole('button',{name:'Prepare bounded run',exact:true}).click();await page.getByRole('heading',{name:'Bounded query run',exact:true}).waitFor();assert.equal(JSON.parse(await page.locator('pre').innerText()).state,'ready');await capture('run-ready')
  await page.getByRole('button',{name:'Read next candidate page',exact:true}).click();assert.equal(JSON.parse(await page.locator('pre').innerText()).state,'partial');await capture('run-partial');await page.getByRole('button',{name:'Cancel query',exact:true}).click();assert.equal(JSON.parse(await page.locator('pre').innerText()).state,'canceled');await capture('run-canceled')
  const prepareRun=async timeoutMs=>{const response=await call('/api/porthole/v1/query/runs',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({query:{...base,expression},scanLimit:20,timeoutMs})});assert.equal(response.status,201);return response.json()}
  const completed=await prepareRun(60000);await page.goto(origin+'/app/explore/runs/'+completed.id);await page.getByRole('button',{name:'Read next candidate page',exact:true}).click();assert.equal(JSON.parse(await page.locator('pre').innerText()).state,'complete');await capture('run-complete')
  const timed=await prepareRun(1);await page.goto(origin+'/app/explore/runs/'+timed.id);await page.getByRole('button',{name:'Read next candidate page',exact:true}).click();assert.equal(JSON.parse(await page.locator('pre').innerText()).state,'timed_out');assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).records,[]);await capture('run-timeout')
  await fillEditor(metric.environment);await page.getByLabel('Signal',{exact:true}).selectOption('metrics');await page.getByLabel('From in nanoseconds',{exact:true}).fill(metric.from);await page.getByLabel('Through in nanoseconds',{exact:true}).fill(metric.through);await page.getByLabel('Dialect',{exact:true}).selectOption('datadog');await page.getByLabel('Expression',{exact:true}).fill(metric.selector);await page.getByRole('button',{name:'Run query',exact:true}).click();await page.getByRole('heading',{name:'Query results',exact:true}).waitFor();assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).metricResult.series[0].points.map(point=>point.value),[10,30,50]);await capture('metric-results')
  await page.goto(origin+'/app/explore?'+new URLSearchParams(joinQuery));await page.getByRole('heading',{name:'Query results',exact:true}).waitFor();assert.equal(JSON.parse(await page.locator('pre').innerText()).records.length,1);await capture('join-results')
  const response=await page.goto(origin+'/app/explore?dialect=lucene&expression='+encodeURIComponent('service:checkout @http.status_code:>nope'));assert.equal(response.status(),400);assert.ok(await page.getByRole('alert').isVisible());await capture('refusal')
  const tiny=await page.locator('main').evaluate(element=>[...element.querySelectorAll('p,a,label,input,select,textarea,button,pre,summary')].filter(node=>parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.tagName));assert.deepEqual(tiny,[])
  await context.clearCookies()
  await context.addCookies(tools.contractorCookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  await page.goto(origin+tools.contractorPage);await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
  if(width===1440){
   assert.deepEqual(JSON.parse(await page.locator('pre').innerText()).records.map(row=>row.id).sort(),expected)
   assert.equal(await page.getByRole('link',{name:'Export matching records',exact:true}).count(),0)
  }
  await capture('contractor-results')
  await context.close()
 }}finally{await browser.close()}
}
