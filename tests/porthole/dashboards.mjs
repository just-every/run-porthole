import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const api='/api/porthole/v1/dashboards'
export async function dashboardJourney({origin,cookie,freshOwner,signIn,restartWorker,withEmptyDestination}) {
 cookie=await freshOwner()
 const post=(path,data,session=cookie)=>fetch(origin+path,form(origin,session,data))
 const get=(path,session=cookie)=>fetch(origin+path,{headers:{cookie:session}})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const from=BigInt(Date.now())*1000000n,through=from+1000000000n
 const scope={services:['checkout'],environments:['production','staging'],teams:['commerce','payments']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-180',class:'ingest',scope:{...scope,signals:['metrics','logs','traces'],actions:['telemetry.write']}}),201)
 for(const [team,environment,factor]of [['commerce','production',1],['payments','staging',2]]) {
  const resource={attributes:Object.entries({'service.name':'checkout','deployment.environment.name':environment,'team.name':team}).map(([key,stringValue])=>({key,value:{stringValue}}))}
  const envelopes={metrics:{resourceMetrics:[{resource,scopeMetrics:[{metrics:[{name:'checkout.cpu',unit:'%',gauge:{dataPoints:[{timeUnixNano:String(from),asDouble:20*factor,attributes:[{key:'host.name',value:{stringValue:'checkout-a'}}]},{timeUnixNano:String(from+1n),asDouble:40*factor,attributes:[{key:'host.name',value:{stringValue:'checkout-b'}}]}]}},{name:'unrelated',gauge:{dataPoints:[{timeUnixNano:String(from),asDouble:9999}]}}]}]}]},logs:{resourceLogs:[{resource,scopeLogs:[{logRecords:[{timeUnixNano:String(from),body:{stringValue:'Checkout dependency waiting'}},{timeUnixNano:String(from+1n),body:{stringValue:'Checkout dependency recovered'}}]}]}]},traces:{resourceSpans:[{resource,scopeSpans:[{spans:[100,200,400].map((ms,i)=>({traceId:'a'.repeat(32),spanId:String(i+1).padStart(16,'0'),name:'Checkout payment request',startTimeUnixNano:String(from),endTimeUnixNano:String(from+BigInt(ms*factor)*1000000n)}))}]}]}}
  for(const [signal,body]of Object.entries(envelopes))assert.equal((await fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:`Bearer ${source.secret}`,'content-type':'application/json'},body:JSON.stringify(body)})).status,200)
 }
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const body={variables:{team:'commerce',environment:'production'},range:{from:String(from),through:String(through)},annotations:[{at:String(from),label:'Payment dependency rollout'}],panels:[{id:'cpu',title:'Checkout CPU',signal:'metrics',aggregate:'average',service:'checkout',metric:'checkout.cpu',unit:'%'},{id:'errors',title:'Checkout log count',signal:'logs',aggregate:'count',service:'checkout',unit:'records'},{id:'latency',title:'Checkout latency p95',signal:'traces',aggregate:'p95',service:'checkout',unit:'ms'}]}
 const saved=await value(await post(api,{name:'Checkout performance',scope,body}),201),path='/app/dashboards/'+saved.id
 assert.equal((await post(api,{id:saved.id,revision:0,name:'Stale edit',scope,body})).status,409)
 const restored=await value(await get(api+'/'+saved.id));assert.deepEqual(restored.body,body)
 await restartWorker();assert.deepEqual((await value(await get(api+'/'+saved.id))).body,body)
 const invite=await post('/app/settings/members/invite',{email:'synthetic-porthole-181@example.com',displayName:'Checkout analyst',role:'read-only analyst',scope:{services:['checkout'],environments:['production'],teams:['commerce']}})
 assert.equal(invite.status,202)
 const restrictedCookie=await signIn('synthetic-porthole-181@example.com')
 const restrictedDashboard=await value(await post(api,{name:'Checkout production shared view',scope:{services:['checkout'],environments:['production'],teams:['commerce']},body}),201)
 assert.equal((await get(api+'/'+saved.id,restrictedCookie)).status,403)
 assert.equal((await get(path,restrictedCookie)).status,403)
 assert.equal((await get(api+'/'+saved.id,'')).status,401)
 assert.equal((await get(path+'?team=another-team')).status,403)
 const {explorationJourney,observabilityAgentJourney}=await import('./explore.mjs')
 await explorationJourney({origin,cookie})
 await observabilityAgentJourney({origin,cookie,freshOwner})
 await dashboardBrowser({origin,cookie,path,restrictedCookie,restrictedPath:'/app/dashboards/'+restrictedDashboard.id,expected:body})
 const {widgetJourney}=await import('./widgets.mjs');await widgetJourney({origin,cookie,scope,body,sourceSecret:source.secret})
 const {publicationJourney}=await import('./publication.mjs')
 await publicationJourney({origin,cookie,freshOwner,dashboardId:saved.id,restrictedCookie})
 cookie=await freshOwner()
 const after=await value(await get(api+'/'+saved.id));assert.ok(after.revision>1)
 const archived=await post('/app/dashboards/archive',{id:saved.id,revision:after.revision});assert.equal(archived.status,303)
 assert.equal((await value(await get(api+'/'+saved.id))).state,'archived')
 const cloned=await post('/app/dashboards/clone',{id:saved.id,revision:after.revision+1});assert.equal(cloned.status,303)
 const copy=await value(await get(api+'/'+cloned.headers.get('location').split('/').at(-1)))
 assert.equal(copy.revision,1);assert.equal(copy.state,'active');assert.deepEqual(copy.body,after.body)
 const audit=await value(await get('/api/v1/audit/export'));assert.ok(JSON.stringify(audit).includes(saved.id));assert.ok(!JSON.stringify(audit).includes('Payment dependency rollout'))
 // The existing installation archive door carries current definitions and all
 // historical revisions, with no sharing or authority on the destination.
 const job=await value(await post('/api/porthole/v1/archive/exports',{}),201),chunks=[]
 for(let i=0;i<job.totalChunks;i++)chunks.push(await value(await get(`/api/porthole/v1/archive/exports/${job.id}/chunks/${i}`)))
 const manifest=await value(await get(`/api/porthole/v1/archive/exports/${job.id}/manifest`))
 assert.ok(manifest.tables.porthole_dashboards>=2);assert.ok(manifest.tables.porthole_dashboard_versions>manifest.tables.porthole_dashboards)
 await withEmptyDestination(async destination=>{
  const targetPost=(path,data)=>fetch(origin+path,form(origin,destination.cookie,data))
  const restore=await value(await targetPost('/api/porthole/v1/archive/restores',{manifest}),201)
  for(const chunk of chunks)await value(await targetPost(`/api/porthole/v1/archive/restores/${restore.id}/chunks`,{chunk}))
  await value(await targetPost(`/api/porthole/v1/archive/restores/${restore.id}/commit`,{confirm:manifest.rootHash}))
  const target=await value(await fetch(origin+api+'/'+saved.id,{headers:{cookie:destination.cookie}}))
  assert.equal(target.state,'quarantined');assert.deepEqual(target.body,after.body);assert.deepEqual(target.versions,(await Promise.resolve(after.versions)).concat(after.revision+1).sort((a,b)=>b-a))
 })
 console.log('Dashboard journey passed: three real signals, exact values, variables, ranges and pivots, keyboard and pointer reorder, revisions, private TV links, refusal, restart, audit and inactive archive history')
}
async function dashboardBrowser({origin,cookie,path,restrictedCookie,restrictedPath,expected}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 if(process.env.PORTHOLE_EVIDENCE_DIR)await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();page.on('pageerror',error=>console.error('Dashboard script error: '+error.message));await page.goto(origin+'/app/dashboards')
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-list-${width}.png`),fullPage:true})
  const create=page.locator('form[action="/app/dashboards/save"]')
  await create.getByLabel('name',{exact:true}).fill(`Checkout regional overview ${width}`)
  await create.getByLabel('service',{exact:true}).fill('checkout');await create.getByLabel('metric',{exact:true}).fill('checkout.cpu');await create.getByLabel('team',{exact:true}).fill('commerce')
  await create.getByLabel('from',{exact:true}).fill(expected.range.from);await create.getByLabel('through',{exact:true}).fill(expected.range.through)
  await create.getByRole('button',{name:'Create dashboard'}).click();await page.getByRole('heading',{name:`Checkout regional overview ${width}`,exact:true}).waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-created-${width}.png`),fullPage:true})
  await page.goto(origin+'/app/explore')
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-explore-${width}.png`),fullPage:true})
  await page.goto(origin+path)
  const panel=title=>page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})})
  assert.match(await panel('Checkout CPU').innerText(),/30/);assert.match(await panel('Checkout log count').innerText(),/2 records/);assert.match(await panel('Checkout latency p95').innerText(),/400/)
  for(const link of await page.getByRole('link',{name:/Open underlying/}).all()) {
   const href=await link.getAttribute('href');const url=new URL(href,origin)
   assert.equal(url.searchParams.get('from'),expected.range.from);assert.equal(url.searchParams.get('through'),expected.range.through)
   const response=await context.request.get(url.href);assert.equal(response.status(),200);assert.match(await response.text(),/Query results/)
   if(url.searchParams.get('signal')==='metrics') {
    assert.equal(url.searchParams.get('metric'),'checkout.cpu')
    const query=await context.request.post(origin+'/api/porthole/v1/query',{headers:{origin},data:Object.fromEntries(url.searchParams)})
    assert.equal(query.status(),200);assert.equal((await query.json()).records.length,2)
   }
  }
  await page.getByLabel('team',{exact:true}).fill('payments');await page.getByLabel('environment',{exact:true}).fill('staging');await page.getByRole('button',{name:'Apply variables and range'}).click()
  assert.match(await panel('Checkout CPU').innerText(),/60/);assert.match(await panel('Checkout latency p95').innerText(),/800/)
  await page.getByRole('link',{name:'Private shared link',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('team'),'payments')
  await page.getByText('Arrange panels',{exact:true}).click()
  await page.locator('[data-order-panel="cpu"]').getByRole('button',{name:'Move down'}).focus();await page.keyboard.press('Enter')
  await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('article').first().getByRole('heading').innerText(),'Checkout log count')
  await page.getByText('Arrange panels',{exact:true}).click()
  await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/app/dashboards/reorder'),page.locator('[data-order-panel="cpu"] p').dragTo(page.locator('[data-order-panel="errors"] p'))])
  await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('article').first().getByRole('heading').innerText(),'Checkout CPU')
  await page.getByText('Edit dashboard',{exact:true}).click()
  const edit=page.locator('form[action="/app/dashboards/save"]');await edit.getByLabel('Name',{exact:true}).fill('Checkout performance');await edit.getByRole('button',{name:'Save new revision'}).focus();await page.keyboard.press('Enter');await page.waitForLoadState('networkidle')
  await page.getByText('Edit dashboard',{exact:true}).click()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-editor-${width}.png`),fullPage:true})
  await page.locator('summary').filter({hasText:/^Add panel$/}).click()
  const add=page.locator('form[action="/app/dashboards/panel"]');await add.getByLabel('Title',{exact:true}).fill(`Checkout diagnostic logs ${width}`);await add.getByLabel('Signal',{exact:true}).selectOption('logs');await add.getByRole('button',{name:'Add panel'}).click();await page.waitForLoadState('networkidle');await page.getByRole('heading',{name:`Checkout diagnostic logs ${width}`,exact:true}).waitFor()
  await page.locator('summary').filter({hasText:/^Add annotation$/}).click()
  const annotation=page.locator('form[action="/app/dashboards/annotation"]');await annotation.getByLabel('Annotation',{exact:true}).fill(`Checkout release inspected at ${width}`);await annotation.getByRole('button',{name:'Add annotation'}).click();await page.waitForLoadState('networkidle')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dashboard reflows')
  await page.getByRole('link',{name:'TV mode',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save new revision'}).count(),0)
  assert.equal(await page.getByRole('link',{name:'Open underlying metrics query'}).count(),1)
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-tv-${width}.png`),fullPage:true})}
  await page.getByRole('link',{name:'Exit TV mode',exact:true}).click();await page.getByText('Version history',{exact:true}).click();await page.getByRole('link',{name:'Revision 1',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save new revision'}).count(),0)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-history-${width}.png`),fullPage:true})
  const restricted=await browser.newContext({viewport:{width,height:844}});await restricted.addCookies(restrictedCookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const denied=await restricted.newPage();assert.equal((await denied.goto(origin+restrictedPath+'?team=commerce&environment=production&from='+expected.range.from+'&through='+expected.range.through+'&tv=1')).status(),200);assert.match(await denied.getByRole('article').first().innerText(),/30/);assert.equal(await denied.getByRole('button',{name:'Save new revision'}).count(),0);await denied.getByRole('link',{name:'Private shared link',exact:true}).click();assert.equal(new URL(denied.url()).searchParams.get('from'),expected.range.from)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await denied.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-shared-${width}.png`),fullPage:true})
  assert.equal((await denied.goto(origin+restrictedPath+'?team=payments')).status(),403);assert.equal((await denied.goto(origin+path)).status(),403)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await denied.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-denied-${width}.png`),fullPage:true})
  await restricted.close();await context.close()
 }}finally{await browser.close()}
}
