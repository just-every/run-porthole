import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'

/** Behavior assertions run at 1440. The same native state is also captured at
 * 390 for release review; the seed's existing phone smoke owns layout checks. */
export async function notebookBrowser({origin,cookie,path,name,exercise,status=200}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}})
  if(cookie)await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const response=await page.goto(origin+(typeof path==='function'?path():path))
  if(width===1440) {
   assert.equal(response.status(),status)
   if(exercise)await exercise(page)
   assert.equal(await page.locator('a,button').evaluateAll(items=>items.filter(item=>!item.textContent.trim()).length),0,'all notebook controls have visible labels')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'notebook fits the desktop viewport')
   assert.deepEqual(errors,[])
  }
  if(process.env.PORTHOLE_EVIDENCE_DIR) {await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`${name}-${width}.png`),fullPage:true})}
  await context.close()
 }}finally{await browser.close()}
}

/** One native sanity journey: actual OTLP intake, measured alert and recovery,
 * ordered notebook cells, live authority, missing evidence and inert restore. */
export async function notebookJourney({origin,freshOwner,signIn,restartWorker,withPinnedClock,withEmptyDestination}) {
 let cookie=await freshOwner()
 const root='/api/porthole/v1/notebooks'
 const post=async(path,data,status=200,acting=cookie)=>{
  const response=await fetch(origin+path,form(origin,acting,data))
  assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()))
  assert.equal(response.headers.get('cache-control'),'no-store')
  return response.json()
 }
 const get=async(path,status=200,acting=cookie)=>{
  const response=await fetch(origin+path,{headers:acting?{cookie:acting}:{}})
  assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()))
  assert.equal(response.headers.get('cache-control'),'no-store');return response.json()
 }
 await get(root,401,'')
 await get(root+'/evaluations',401,'')
 await post(root,{name:'synthetic-porthole-2400'},400)
 const scope={services:['synthetic-porthole-2401'],environments:['production'],teams:['synthetic-porthole-2402']}
 const otherScope={...scope,services:['synthetic-porthole-2403']},both={...scope,services:[...scope.services,...otherScope.services]}
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2404',class:'ingest',scope:{...both,signals:['logs','metrics'],actions:['telemetry.write']}},201)
 const t=Date.now(),ns=ms=>String(BigInt(ms)*1000000n)
 const resource=selected=>({attributes:[{key:'service.name',value:{stringValue:selected.services[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team',value:{stringValue:scope.teams[0]}},{key:'subject',value:{stringValue:'synthetic-porthole-2405'}}]})
 let sequence=2406
 let originalPacket
 const ingest=async(signal,records,selected=scope,expected=200,packet)=>{
  const body=packet??(signal==='logs'?{resourceLogs:[{resource:resource(selected),scopeLogs:[{logRecords:records}]}]}:{resourceMetrics:[{resource:resource(selected),scopeMetrics:[{metrics:records}]}]})
  if(signal==='logs'&&records?.length===205)originalPacket=body
  const response=await fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-'+sequence++,'x-porthole-team':selected.teams[0],'x-porthole-service':selected.services[0],'x-porthole-environment':'production'},body:JSON.stringify(body)})
  assert.equal(response.status,expected,await response.clone().text())
  if(expected===200)await post('/api/porthole/v1/ingest/drain',{})
 }
 const heartbeat=async()=>{
  const response=await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-2420',service:scope.services[0],environment:'production',team:scope.teams[0],signal:'logs'})})
  assert.equal(response.status,200)
 }
 const metric=(value,at)=>({name:'synthetic_porthole_notebook_value',unit:'ms',gauge:{dataPoints:[{timeUnixNano:ns(at),asDouble:value}]}})
 const monitor=await post('/api/porthole/v1/objects',{kind:'monitor',name:'Notebook firing alert',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:60}},201)
 await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:1,confirm:'activate'})
 await withPinnedClock(t,async()=>{
  await heartbeat()
  await ingest('logs',Array.from({length:205},(_,i)=>({timeUnixNano:ns(t-1000+i),severityNumber:17,body:{stringValue:'synthetic-porthole-log-'+i}})))
  await ingest('metrics',[metric(4,t-900),metric(9,t-800)])
  const state=await post('/api/v1/health/tick',{})
  const measured=state.state.components.find(c=>c.component==='monitor-evaluation').evidence.monitors.find(m=>m.monitorId===monitor.id)
  assert.equal(measured.status,'Firing');assert.equal(measured.observedCount,205)
 })
 const evaluations=(await get(root+'/evaluations')).evaluations
 const firing=evaluations.find(e=>e.monitorId===monitor.id)
 assert.ok(firing);assert.equal(firing.observedCount,205)
 assert.equal(firing.fromNs,ns(t-60000).padStart(20,'0'));assert.equal(firing.throughNs,ns(t).padStart(20,'0'))
 let notebookId
 await notebookBrowser({origin,cookie,name:'notebook-from-firing',path:()=>notebookId?'/app/notebooks/'+notebookId:'/app/notebooks?monitor='+monitor.id,exercise:async page=>{
  await page.getByLabel('Notebook name').fill('Measured incident investigation')
  await page.getByRole('button',{name:'Save investigation notebook'}).click()
  await page.waitForURL(/\/app\/notebooks\/[a-f0-9-]{36}$/)
  notebookId=new URL(page.url()).pathname.split('/').at(-1)
  assert.ok((await page.locator('body').innerText()).includes('firing monitor revision 1'))
 }})
 const endpoint=root+'/'+notebookId,pagePath='/app/notebooks/'+notebookId
 let notebook=await get(endpoint)
 assert.equal(notebook.body.origin.monitorId,monitor.id)
 assert.equal(notebook.body.origin.evaluationId,firing.id)
 const originalOrigin=structuredClone(notebook.body.origin)
 const query={signal:'logs',service:scope.services[0],environment:'production',team:scope.teams[0],from:ns(t-2000),through:ns(t)}
 const attach=async data=>{const result=await post(endpoint+'/cells',{revision:notebook.revision,...data});notebook=await get(endpoint);assert.equal(result.revision,notebook.revision)}
 await attach({cellId:'logs',kind:'query',title:'Original log evidence',query})
 assert.equal(notebook.results[0].count,205)
 assert.equal(notebook.body.cells[0].snapshot.queryRefs.length,2,'all result pages are captured at one watermark')
 assert.deepEqual(notebook.results[0].records.map(r=>r.payload.record.body.stringValue),Array.from({length:205},(_,i)=>'synthetic-porthole-log-'+i))
 await attach({cellId:'chart',kind:'chart',title:'Measured latency',query:{...query,signal:'metrics',metric:'synthetic_porthole_notebook_value'}})
 assert.deepEqual(notebook.results[1].points.map(p=>p.value),[4,9])
 await notebookBrowser({origin,cookie,path:pagePath,name:'notebook-cells',exercise:async page=>{
  await page.locator('summary').filter({hasText:/^Add text cell$/}).click()
  const text=page.locator('form').filter({has:page.getByRole('button',{name:'Add text cell',exact:true})})
  await text.getByLabel('Cell reference').fill('context')
  await text.getByLabel('Text',{exact:true}).fill('Investigate the original measured failure before changing anything.')
  await text.getByRole('button',{name:'Add text cell',exact:true}).click()
  await page.waitForURL(origin+pagePath)
  assert.deepEqual(await page.locator('[data-cell-id]').evaluateAll(cells=>cells.map(c=>c.dataset.cellId)),['logs','chart','context'])
  const chart=page.locator('[data-cell-id="chart"]')
  assert.equal(await chart.locator('svg circle').count(),2)
  await chart.getByRole('button',{name:'Move cell up'}).click()
  await page.waitForURL(origin+pagePath)
  assert.deepEqual(await page.locator('[data-cell-id]').evaluateAll(cells=>cells.map(c=>c.dataset.cellId)),['chart','logs','context'])
 }})
 notebook=await get(endpoint)
 const initialRevision=notebook.revision,initial=structuredClone(notebook)
 assert.deepEqual(notebook.body.cells.map(c=>c.id),['chart','logs','context'])
 const stale=await post(endpoint+'/reorder',{revision:notebook.revision-1,order:['logs','chart','context']},409)
 assert.equal(stale.error,'revision_or_authority_changed')
 await post(endpoint+'/reorder',{revision:notebook.revision,order:['logs','logs','context']},400)
 assert.equal((await get(endpoint)).revision,initialRevision)
 const address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
 const invite=async(n,role,selected)=>{
  await post('/app/settings/members/invite',{email:address(n),displayName:role==='responder'?'Incident responder':role==='restricted contractor'?'Scoped contractor':'Unshared analyst',role,scope:selected},202)
  const signed=await signIn(address(n)),session=await get('/auth/session',200,signed)
  return {cookie:signed,id:session.operator.id}
 }
 const responder=await invite(2421,'responder',both),contractor=await invite(2422,'restricted contractor',scope),unshared=await invite(2423,'read-only analyst',both)
 cookie=await freshOwner()
 await get(endpoint,404,responder.cookie)
 await get(root+'/evaluations',403,responder.cookie)
 await notebookBrowser({origin,cookie,path:'/app/settings/notebooks/'+notebookId,name:'notebook-private-sharing',exercise:async page=>{
  const member=page.locator('form').filter({has:page.getByRole('button',{name:'Share private member link'})})
  await member.getByLabel('Member',{exact:true}).selectOption(responder.id)
  await member.getByRole('button',{name:'Share private member link'}).click()
  await page.waitForURL(origin+'/app/settings/notebooks/'+notebookId)
  assert.ok((await page.locator('body').innerText()).includes('Incident responder'))
 }})
 await post(endpoint+'/share',{revision:notebook.revision,kind:'member',target:contractor.id})
 for(const actor of [responder,contractor]) {
  const scoped=await get(endpoint,200,actor.cookie)
  assert.deepEqual(scoped.results.filter(Boolean).map(r=>r.count),[2,205])
  await notebookBrowser({origin,cookie:actor.cookie,path:pagePath,name:'notebook-'+(actor===responder?'responder':'contractor'),exercise:async page=>{
   assert.equal(await page.locator('form').count(),0)
   assert.ok((await page.locator('body').innerText()).includes('205 records'))
   assert.equal(await page.locator('svg circle').count(),2)
  }})
 }
 await get(endpoint,404,unshared.cookie)
 await get(endpoint,401,'')
 await notebookBrowser({origin,cookie:'',path:pagePath,name:'notebook-signed-out',status:401,exercise:async page=>assert.ok(!(await page.locator('body').innerText()).includes('Measured latency'))})
 await post(endpoint+'/cells',{revision:notebook.revision,cellId:'forbidden',kind:'text',text:'Cannot alter owner evidence'},403,responder.cookie)
 assert.equal((await get(endpoint)).revision,initialRevision)
 const cross=await fetch(origin+endpoint+'/comment',form('https://synthetic-porthole.invalid',cookie,{revision:notebook.revision,text:'forged'}));assert.equal(cross.status,403)
 const readKey=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2424',class:'read',scope:{...scope,signals:['logs'],actions:['telemetry.read']}},201)
 assert.equal((await fetch(origin+endpoint,{headers:{authorization:'Bearer '+readKey.secret}})).status,403,'a telemetry credential cannot confer notebook access')
 await post('/app/settings/credentials/revoke',{id:readKey.credential.id})
 assert.equal((await fetch(origin+endpoint,{headers:{authorization:'Bearer '+readKey.secret}})).status,403,'revoked credentials never become notebook authority')
 const revokedRead=await fetch(origin+'/api/porthole/v1/query',{method:'POST',headers:{authorization:'Bearer '+readKey.secret,'content-type':'application/json'},body:JSON.stringify(query)})
 assert.equal(revokedRead.status,401);assert.ok(!(await revokedRead.text()).includes('synthetic-porthole-log-0'))
 await notebookBrowser({origin,cookie,path:pagePath,name:'notebook-local-mention',exercise:async page=>{
  await page.getByText('Add annotation or local mention',{exact:true}).click()
  await page.getByLabel('Annotation',{exact:true}).fill('Review the measured evidence before rerunning.')
  await page.getByLabel('Mention teammate').selectOption(responder.id)
  await page.getByRole('button',{name:'Save annotation'}).click()
  await page.waitForURL(origin+pagePath)
  assert.ok((await page.locator('body').innerText()).includes('Undelivered. No notification was sent.'))
 }})
 notebook=await get(endpoint)
 assert.deepEqual(notebook.body.comments[0].mentions,[{memberRef:responder.id,status:'undelivered'}])
 await attach({cellId:'mean',kind:'chart',title:'Window mean latency',query:{...query,signal:'metrics',metric:'synthetic_porthole_notebook_value',dialect:'sql',expression:`SELECT AVG(value) FROM metrics WHERE metric='synthetic_porthole_notebook_value' AND service='${scope.services[0]}' AND environment='production' AND team='${scope.teams[0]}'`}})
 assert.equal(notebook.results[3].aggregate.value,6.5)
 assert.deepEqual(notebook.results[3].points.map(p=>p.value),[6.5],'the graph renders the requested window average, not individual observations')
 await attach({cellId:'total',kind:'query',title:'Whole window log count',query:{...query,dialect:'sql',expression:`SELECT COUNT(*) FROM logs WHERE service='${scope.services[0]}' AND environment='production' AND team='${scope.teams[0]}'`}})
 assert.equal(notebook.results[4].aggregate.value,205,'aggregate counts include every native snapshot page')
 await notebookBrowser({origin,cookie,path:pagePath,name:'notebook-window-aggregates',exercise:async page=>{
  const mean=page.locator('[data-cell-id="mean"]')
  assert.equal(await mean.locator('svg circle').count(),1)
  assert.ok((await mean.innerText()).includes('Window average: 6.5 ms'))
  assert.ok((await page.locator('[data-cell-id="total"]').innerText()).includes('Window count: 205 records'))
 }})
 const beforeRerun=notebook.revision
 await withPinnedClock(t+61000,async()=>{
  await heartbeat();await ingest('logs',[{timeUnixNano:ns(t-500),body:{stringValue:'synthetic-porthole-old-event'}}])
  await ingest('metrics',[metric(12,t+61000)])
  const recovered=await post('/api/v1/health/tick',{})
  const measured=recovered.state.components.find(c=>c.component==='monitor-evaluation').evidence.monitors.find(m=>m.monitorId===monitor.id)
  assert.equal(measured.status,'Healthy');assert.equal(measured.observedCount,0,'measured recovery uses the unchanged original monitor')
  await post(endpoint+'/rerun',{revision:notebook.revision,cellId:'chart',from:ns(t+1000),through:ns(t+61000)})
 })
 notebook=await get(endpoint)
 assert.equal(notebook.revision,beforeRerun+1)
 assert.deepEqual(notebook.results[0].points.map(p=>p.value),[12])
 assert.deepEqual(notebook.body.origin,originalOrigin)
 const earlier=await get(endpoint+'?version='+initialRevision)
 assert.deepEqual(earlier.body,initial.body)
 assert.deepEqual(earlier.results[0].points.map(p=>p.value),[4,9])
 assert.equal(earlier.results[1].count,205,'later intake cannot enter the earlier immutable watermark')
 await restartWorker();cookie=await freshOwner()
 assert.deepEqual((await get(endpoint+'?version='+initialRevision)).body,initial.body)
 await notebookBrowser({origin,cookie,path:pagePath,name:'notebook-measured-recovery',exercise:async page=>{
  assert.equal(await page.locator('[data-cell-id="chart"] svg circle').count(),1)
  await page.getByRole('link',{name:'Revision '+initialRevision,exact:true}).click()
  assert.equal(await page.locator('[data-cell-id="chart"] svg circle').count(),2)
 }})
 await post(endpoint+'/unshare',{revision:notebook.revision,kind:'member',target:responder.id})
 await get(endpoint,404,responder.cookie)
 await post(endpoint+'/share',{revision:notebook.revision,kind:'team',target:scope.teams[0]})
 await get(endpoint,200,responder.cookie)
 await ingest('logs',[{timeUnixNano:ns(t-700),body:{stringValue:'synthetic-porthole-other-service'}}],otherScope)
 await attach({cellId:'other-service',kind:'query',title:'Second service evidence',query:{...query,service:otherScope.services[0]}})
 await get(endpoint,404,contractor.cookie)
 await notebookBrowser({origin,cookie:contractor.cookie,path:pagePath,name:'notebook-cell-scope-refusal',status:404,exercise:async page=>assert.ok(!(await page.locator('body').innerText()).includes('Second service evidence'))})
 await get(endpoint,200,responder.cookie)
 await post('/app/settings/members/change',{operatorId:responder.id,role:'responder',scope:otherScope})
 await get(endpoint,401,responder.cookie)
 const narrowed=await signIn(address(2421));await get(endpoint,404,narrowed)
 cookie=await freshOwner()
 await post('/app/settings/members/remove',{operatorId:responder.id})
 await post('/api/porthole/v1/actors/erase',{actorRef:responder.id,confirm:'erase'})
 const preview=await post('/api/porthole/v1/subject-erasure',{identifier:'synthetic-porthole-2405'})
 assert.ok(preview.records>=205);assert.equal(preview.canApply,true)
 await post('/api/porthole/v1/subject-erasure/apply',{identifier:'synthetic-porthole-2405',digest:preview.digest,confirm:'erase-exact-batches'})
 notebook=await get(endpoint+'?version='+initialRevision)
 assert.deepEqual(notebook.body,initial.body)
 assert.equal(notebook.results[1].state,'unavailable');assert.equal(notebook.results[1].count,null);assert.deepEqual(notebook.results[1].records,[])
 await ingest('logs',null,scope,409,originalPacket)
 await restartWorker();cookie=await freshOwner()
 assert.equal((await get(endpoint+'?version='+initialRevision)).results[1].state,'unavailable')
 await notebookBrowser({origin,cookie,path:pagePath,name:'notebook-missing-evidence',exercise:async page=>{
  const text=await page.locator('body').innerText();assert.ok(text.includes('Count unavailable'));assert.ok(text.includes('Erased member'))
  assert.ok(!text.includes('synthetic-porthole-log-0'),'erased log data is absent from notebook results')
 }})
 const {notebookArchiveJourney}=await import('./archive.mjs')
 await notebookArchiveJourney({origin,freshOwner,withEmptyDestination,notebookId,initialRevision})
 console.log('Native notebooks passed: real 205-record alert, multipage snapshots and chart values, ordered cells, immutable rerun after measured recovery, local undelivered mention, scoped private links, next-request revocation, erased and replay-refused evidence, restart and private inert archive restore at 1440 and 390.')
}
