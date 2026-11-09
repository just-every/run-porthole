import {reviewRemoval} from './fixture.mjs'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal} from './fixture.mjs'
const execute=promisify(execFile),api='/api/porthole/v1/events'
const address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
const scope={services:['checkout'],environments:['production'],teams:['commerce']}
export async function eventBrowser({origin,cookie,path,name,status=200,exercise}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?950:844}})
  if(cookie)await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const response=await page.goto(origin+path)
  if(process.env.PORTHOLE_EVIDENCE_DIR) {await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,name+'-'+width+'.png'),fullPage:true})}
  if(width===1440) {
   assert.equal(response.status(),status)
   if(exercise)await exercise(page)
   assert.deepEqual(errors,[])
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Events reflow within the viewport')
   assert.equal(await page.locator('a,button').evaluateAll(items=>items.filter(item=>!item.textContent.trim()).length),0,'every event control has a visible word label')
   assert.ok(await page.locator('body').evaluate(body=>[...body.querySelectorAll('p,label,a,button,dt,dd,input,select,textarea')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=13)),'event text is readable')
  }
  await context.close()
 }}finally{await browser.close()}
}

/** Actual command executions enter the versioned HTTP API. Results are checked
 * independently across pages, current native scopes and dashboard references. */
export async function eventJourney({origin,freshOwner,signIn,restartWorker,withEmptyDestination,sql,mutate}) {
 let cookie=await freshOwner()
 const post=(path,data,session=cookie,extra={})=>fetch(origin+path,{...form(origin,session,data),headers:{...form(origin,session,data).headers,...extra}})
 const get=(path,session=cookie,headers={})=>fetch(origin+path,{headers:{cookie:session,...headers}})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const download=async(response)=>{
  assert.equal(response.status,200,await response.clone().text())
  assert.match(response.headers.get('content-type'),/^application\/x-ndjson/)
  assert.match(response.headers.get('content-disposition'),/^attachment;/)
  assert.match(response.headers.get('cache-control'),/no-store/)
  const text=await response.text(),events=text?text.trimEnd().split('\n').map(line=>JSON.parse(line)):[]
  assert.equal(Number(response.headers.get('x-porthole-records')),events.length)
  return {events,snapshot:Number(response.headers.get('x-porthole-snapshot')),cursor:response.headers.get('x-porthole-next-cursor')}
 }
 assert.equal((await get(api+'/export','')).status,401)
 const beforeEffects=await sql('SELECT (SELECT COUNT(*) FROM porthole_monitor_evaluations) AS evaluations,(SELECT COUNT(*) FROM porthole_health_notices) AS notices,(SELECT COUNT(*) FROM porthole_dashboard_publications) AS publications')
 assert.equal((await get(api,'')).status,401)
 const source=await value(await post('/app/settings/credentials/mint',{name:'Local execution telemetry',class:'ingest',scope:{...scope,signals:['logs','metrics','traces'],actions:['telemetry.write']}}),201)
 const reports=[]
 for(const [command,code] of [[['pnpm','run','typecheck'],0],[[process.execPath,'--check','cli/porthole.mjs'],0],[[process.execPath,'tests/porthole/polyglot/otlp.cjs'],0],[[process.execPath,'-e','process.exit(process.env.PORTHOLE_SESSION ? 9 : 7)'],7]]) {
  const result=await execute(process.execPath,['scripts/porthole/event-run.mjs',origin,'checkout','production','commerce','--',...command],{env:{...process.env,PORTHOLE_SESSION:cookie,PORTHOLE_OTLP_ENDPOINT:origin,PORTHOLE_OTLP_SECRET:source.secret,PORTHOLE_OTLP_SERVICE:'checkout',PORTHOLE_OTLP_ENVIRONMENT:'production',PORTHOLE_OTLP_TEAM:'commerce'},timeout:120000}).catch(error=>{assert.equal(error.code,code);return error})
  const report=JSON.parse(result.stdout);assert.equal(report.exit.code,code);assert.equal(report.events.length,2);reports.push(report)
 }
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const telemetry=await value(await get('/api/porthole/v1/ingest/records?signal=logs&service=checkout'))
 assert.equal(telemetry.records.length,1,'the stock SDK recorded the one actual local request')
 const submitted=reports.flatMap(row=>row.events),expected=[...submitted].sort((a,b)=>BigInt(a.input.occurredAt)<BigInt(b.input.occurredAt)?-1:BigInt(a.input.occurredAt)>BigInt(b.input.occurredAt)?1:a.id.localeCompare(b.id))
 const original=await value(await get(api+'/'+expected[0].id)),input=expected[0].input
 assert.equal(original.event.sourceType,'custom');assert.equal(original.event.provenance.kind,'native-custom')
 assert.equal(original.event.occurredAt,input.occurredAt.padStart(20,'0'));assert.ok(original.event.receivedAt>=Number(BigInt(input.occurredAt)/1000000n))
 const first=await value(await get(api+'?source=native-command&limit=2'))
 assert.equal(first.events.length,2);assert.ok(first.cursor)
 assert.equal(first.facets.scope,'snapshot');assert.equal(first.facets.totalEvents,submitted.length)
 assert.deepEqual(first.facets.counts.source,[{value:'native-command',count:submitted.length}])
 const firstExport=await download(await get(api+'/export?source=native-command&limit=2'))
 assert.equal(firstExport.snapshot,first.snapshot);assert.ok(firstExport.cursor)
 assert.deepEqual(firstExport.events,first.events)
 // A later received execution fact keeps its original older occurrence time,
 // and cannot move the first search's receipt watermark.
 const lateInput={...input,sourceId:randomUUID(),occurredAt:String(BigInt(input.occurredAt)-1n),title:'Late local execution evidence'}
 const late=await value(await post(api,lateInput),201)
 await restartWorker()
 const observed=[...first.events];let cursor=first.cursor
 while(cursor) {
  const page=await value(await get(api+'?source=native-command&limit=2&cursor='+encodeURIComponent(cursor)))
  assert.equal(page.snapshot,first.snapshot);assert.deepEqual(page.facets,first.facets);observed.push(...page.events);cursor=page.cursor
 }
 assert.deepEqual(observed.map(row=>row.id),expected.map(row=>row.id))
 assert.deepEqual(observed.map(row=>row.sourceId),expected.map(row=>row.input.sourceId))
 assert.equal(new Set(observed.map(row=>row.id)).size,submitted.length)
 for(const receipt of submitted) {
  const event=observed.find(row=>row.id===receipt.id)
  for(const [key,expectedValue]of Object.entries(receipt.input))assert.deepEqual(event[key],key==='occurredAt'?expectedValue.padStart(20,'0'):expectedValue)
 }
 const anchored=await download(await get(api+'/export?source=native-command&limit=2&cursor='+encodeURIComponent(first.pageCursor)))
 assert.deepEqual(anchored.events,first.events,'exporting a displayed first page keeps its original snapshot after late arrivals')
 const exported=[...firstExport.events];let exportCursor=firstExport.cursor
 while(exportCursor) {
  const page=await download(await get(api+'/export?source=native-command&limit=2&cursor='+encodeURIComponent(exportCursor)))
  assert.equal(page.snapshot,firstExport.snapshot);exported.push(...page.events);exportCursor=page.cursor
 }
 assert.deepEqual(exported,observed,'export reconciles every original field and provenance against independent command receipts, across restart and late arrival')
 assert.equal(new Set(exported.map(event=>event.id)).size,submitted.length)
 assert.equal((await get(api+'/export?source=other&cursor='+encodeURIComponent(firstExport.cursor))).status,409)
 for(const query of ['?cursor=broken','?limit=201','?source=a&source=b']) {
  const refused=await get(api+'/export'+query);assert.equal(refused.status,400);assert.equal(refused.headers.has('content-disposition'),false)
 }
 for(const item of [...submitted].reverse()) {
  const result=await value(await post(api,item.input),201)
  assert.equal(result.event.id,item.id);assert.equal(result.replayed,true)
  assert.deepEqual(result.event,(await value(await get(api+'/'+item.id))).event)
 }
 const replay=await value(await post(api,input),201);assert.deepEqual(replay.event,original.event)
 const conflicting=await post(api,{...input,text:'Different execution outcome'});assert.equal(conflicting.status,409)
 const concurrentInput={...input,sourceId:randomUUID(),title:'Concurrent retry evidence'}
 const retries=await Promise.all([post(api,concurrentInput),post(api,concurrentInput)])
 const receipts=await Promise.all(retries.map(r=>value(r,201)))
 assert.equal(receipts[0].event.id,receipts[1].event.id);assert.equal(receipts.filter(r=>!r.replayed).length,1)
 const storageBefore=await sql('SELECT * FROM porthole_custom_events ORDER BY sequence')
 for(const forged of [{...input,sourceType:'cloudwatch'},{...input,actorRef:randomUUID()},{...input,providerAuthenticated:true},{...input,receivedAt:1},{...input,activateMonitor:true},{...input,publishStatus:true}])assert.equal((await post(api,forged)).status,400)
 assert.deepEqual(await sql('SELECT * FROM porthole_custom_events ORDER BY sequence'),storageBefore)
 for(const path of [api+'?provider=aws',api+'?limit=0',api+'?source=a&source=b',api+'?cursor=broken'])assert.equal((await get(path)).status,400)
 assert.equal((await get(api+'?source=other&cursor='+encodeURIComponent(first.cursor))).status,409)
 const newSearch=await value(await get(api+'?source=native-command&limit=200'))
 assert.equal(newSearch.events[0].id,late.event.id);assert.equal(newSearch.events.length,submitted.length+2)
 const filtered=await value(await get(api+'?service=checkout&text=completed&correlationKey='+reports[0].runId+'&from='+reports[0].events[0].input.occurredAt+'&through='+reports[0].events[1].input.occurredAt))
 assert.deepEqual(filtered.events.map(row=>row.id),[reports[0].events[1].id])
 const completed=await value(await get(api+'?tag=execution%3Acompleted&resource=local-command&limit=200'))
 assert.deepEqual(completed.events.map(event=>event.id),reports.map(report=>report.events[1].id))
 assert.deepEqual(completed.facets.counts.tag,[{value:'execution:completed',count:reports.length}])
 assert.deepEqual(completed.facets.counts.severity,[{value:'error',count:1},{value:'info',count:reports.length-1}])
 const failures=await download(await get(api+'/export?severity=error&tag=execution%3Acompleted&resource=local-command'))
 assert.deepEqual(failures.events.map(event=>event.id),[reports.at(-1).events[1].id])
 assert.match(failures.events[0].text,/Exit code 7/)
 const absent=await download(await get(api+'/export?tag=execution%3Acomplete'))
 assert.deepEqual(absent.events,[]);assert.equal(absent.cursor,'')
 const filter=await value(await post(api+'/filters',{name:'My checkout executions',definition:{service:'checkout',text:'completed',team:'commerce',resource:'local-command',tag:'execution:completed'}}),201)
 assert.equal((await value(await get(api+'?filter='+filter.id))).events.length,reports.length)
 await value(await post(api+'/filters',{id:filter.id,revision:filter.revision,name:'My completed runs',definition:filter.definition}),201)
 assert.equal((await post(api+'/filters',{id:filter.id,revision:filter.revision,name:'Stale filter',definition:{}})).status,409)
 await restartWorker()
 assert.deepEqual((await value(await get(api+'/'+original.event.id))).event,original.event)
 assert.equal((await value(await get(api+'?filter='+filter.id))).events.length,reports.length)
 const filteredExport=await download(await get(api+'/export?filter='+filter.id+'&limit=200'))
 assert.deepEqual(filteredExport.events.map(event=>event.id),reports.map(report=>report.events[1].id))
 const foreign=await value(await post(api,{...input,sourceId:randomUUID(),team:'payments',tags:['restricted:payment'],resource:'private-payment-worker',title:'Restricted payment event'}),201)
 const foreignService=await value(await post(api,{...input,source:'native-restricted',sourceId:randomUUID(),service:'private-worker',tags:['restricted:service'],title:'Restricted service event'}),201)
 const foreignEnvironment=await value(await post(api,{...input,source:'native-restricted',sourceId:randomUUID(),environment:'private-stage',tags:['restricted:environment'],title:'Restricted environment event'}),201)
 await value(await post('/app/settings/members/invite',{email:address(2601),displayName:'Event contractor',role:'restricted contractor',scope}),202)
 let restricted=await signIn(address(2601))
 const members=await sql('SELECT operator_id FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE o.email='+literal(address(2601))),restrictedId=members[0].operator_id
 const scoped=await value(await get(api+'?limit=200',restricted));assert.ok(scoped.events.length>0);assert.ok(!scoped.events.some(row=>row.id===foreign.event.id))
 assert.equal((await get(api+'/'+foreign.event.id,restricted)).status,404)
 const scopedExport=await download(await get(api+'/export?limit=200',restricted))
 assert.deepEqual(scopedExport.events,scoped.events)
 assert.ok(!JSON.stringify(scoped.facets).includes('restricted:payment'))
 assert.ok(!JSON.stringify(scoped.facets).includes('private-payment-worker'))
 for(const [field,hidden,event] of [['service','private-worker',foreignService],['environment','private-stage',foreignEnvironment]]) {
  assert.ok(!scoped.events.some(row=>row.id===event.event.id))
  assert.ok(!JSON.stringify(scoped.facets).includes(hidden))
  assert.equal((await get(api+'/'+event.event.id,restricted)).status,404)
  assert.equal((await get(api+'?'+field+'='+hidden,restricted)).status,403)
 }
 assert.equal(scoped.facets.totalEvents,scoped.events.length)
 assert.deepEqual((await value(await get(api+'?tag=restricted%3Apayment',restricted))).events,[])
 assert.equal((await get(api+'/export?team=payments',restricted)).status,403)
 assert.equal((await get(api+'/export?filter='+filter.id,restricted)).status,404)
 assert.equal((await get(api+'?team=payments',restricted)).status,403)
 assert.equal((await post(api,{...input,sourceId:randomUUID()},restricted)).status,403)
 assert.equal((await get(api+'?filter='+filter.id,restricted)).status,404)
 assert.deepEqual((await value(await get(api+'/filters',restricted))).filters,[])
 assert.equal((await get(api,cookie,{authorization:'Bearer synthetic-porthole-2602'})).status,403)
 assert.equal((await get(api+'/export',cookie,{authorization:'Bearer synthetic-porthole-2602'})).status,403)
 assert.equal((await post(api,{...input,sourceId:randomUUID()},cookie,{authorization:'Bearer synthetic-porthole-2602'})).status,403)
 assert.deepEqual(await sql('SELECT (SELECT COUNT(*) FROM porthole_monitor_evaluations) AS evaluations,(SELECT COUNT(*) FROM porthole_health_notices) AS notices,(SELECT COUNT(*) FROM porthole_dashboard_publications) AS publications'),beforeEffects,'custom submissions have no monitor, notice or publication effects')
 const {eventDashboardJourney}=await import('./dashboard-api.mjs')
 const dashboard=await eventDashboardJourney({origin,cookie,restricted,eventIds:expected.slice(0,3).map(x=>x.id),foreignId:foreign.event.id,scope,value})
 const {eventPublicationJourney}=await import('./publication.mjs')
 const publication=await eventPublicationJourney({origin,cookie,freshOwner,dashboard,eventId:late.event.id,value})
 cookie=await freshOwner()
 await eventBrowser({origin,cookie,path:'/app/events?source=native-command&team=commerce',name:'events-complete',exercise:async page=>{
  assert.equal(await page.locator('[data-event]').count(),submitted.length+2)
  const facet=page.getByRole('region',{name:'Facets in this search'})
  assert.match(await facet.innerText(),new RegExp('execution:completed \\('+reports.length+'\\)'))
  const resource=facet.getByRole('link',{name:'local-command ('+(submitted.length+2)+')',exact:true})
  await resource.focus();await Promise.all([page.waitForURL('**resource=local-command**'),resource.press('Enter')])
  assert.equal(await page.getByLabel('resource',{exact:true}).inputValue(),'local-command')
  const downloadLink=page.getByRole('link',{name:'Export this page as NDJSON'})
  const downloaded=await download(await get(await downloadLink.getAttribute('href')))
  assert.equal(downloaded.events.length,submitted.length+2)
  const search=page.getByRole('button',{name:'Search events',exact:true});await search.focus();assert.equal(await search.evaluate(el=>el===document.activeElement),true)
  await page.getByLabel('text',{exact:true}).fill('No such execution')
  await Promise.all([page.waitForURL('**text=No+such+execution**'),search.press('Enter')])
  assert.match(await page.locator('[aria-label="Event results"]').innerText(),/No matching events/)
 }})
 await eventBrowser({origin,cookie,path:'/app/settings/events',name:'events-settings',exercise:async page=>{
  const f=page.locator('form[action="/app/settings/events/create"]')
  for(const [key,v]of Object.entries({...input,sourceId:randomUUID(),title:'Keyboard event submission'}))if(typeof v==='string'&&key!=='tags'&&key!=='sourceType'){if(key==='severity')await f.getByLabel(key,{exact:true}).selectOption(v);else await f.getByLabel(key,{exact:true}).fill(v)}
  const submit=f.getByRole('button',{name:'Create custom event'});await submit.focus()
  await Promise.all([page.waitForURL('**/app/events/*'),submit.press('Enter')])
  assert.match(await page.locator('body').innerText(),/Keyboard event submission/)
 }})
 await eventBrowser({origin,cookie,path:'/app/events?text=No+such+execution',name:'events-empty'})
 await eventBrowser({origin,cookie,path:'/app/events/'+original.event.id,name:'events-detail'})
 await eventBrowser({origin,cookie:restricted,path:'/app/events/'+foreign.event.id,name:'events-restricted',status:404,exercise:async page=>assert.ok(!(await page.locator('body').innerText()).includes(foreign.event.title))})
 await eventBrowser({origin,cookie,path:'/app/events?severity=unknown',name:'events-invalid',status:400})
 const scopedFilter=await value(await post(api+'/filters',{name:'My contractor executions',definition:{service:'checkout'}},restricted),201)
 const partial=await value(await get(api+'?limit=1',restricted));assert.ok(partial.cursor)
 cookie=await freshOwner()
 await value(await post('/app/settings/members/change',{operatorId:restrictedId,role:'restricted contractor',scope:{...scope,services:['another-service']}}))
 assert.ok([401,409].includes((await get(api+'?limit=1&cursor='+encodeURIComponent(partial.cursor),restricted)).status))
 assert.ok([401,409].includes((await get(api+'/export?limit=1&cursor='+encodeURIComponent(partial.cursor),restricted)).status))
 restricted=await signIn(address(2601))
 assert.deepEqual((await value(await get(api,restricted))).events,[])
 assert.deepEqual((await download(await get(api+'/export',restricted))).events,[])
 assert.equal((await get(api+'?filter='+scopedFilter.id,restricted)).status,403,'saved filters never preserve revoked scope')
 assert.equal((await get(api+'/'+original.event.id,restricted)).status,404)
 assert.ok(!(await (await get('/app/dashboards/'+dashboard.id,restricted)).text()).includes(original.event.title))
 // A second native owner creates real private evidence; removing and erasing
 // that actor must fence both direct reads and dashboard references.
 await value(await post('/app/settings/members/invite',{email:address(2603),displayName:'Event author',role:'responder',scope}),202)
 await signIn(address(2603));const author=(await sql('SELECT id FROM oa_operators WHERE email='+literal(address(2603))))[0]
 cookie=await freshOwner()
 await value(await post('/app/settings/members/change',{operatorId:author.id,role:'owner',confirmEmail:address(2603)}))
 const authorCookie=await signIn(address(2603))
 const authored=await value(await post(api,{...input,sourceId:randomUUID(),title:'Author private execution'},authorCookie),201)
 const ref=await value(await get('/api/porthole/v1/dashboards/'+dashboard.id))
 await value(await post('/api/porthole/v1/dashboards',{id:ref.id,revision:ref.revision,name:ref.name,scope:ref.scope,body:{...ref.body,eventOverlays:[authored.event.id]}}),201)
 await value(await post('/app/settings/members/change',{operatorId:author.id,role:'responder',scope}))
 assert.equal((await post(api,{...input,sourceId:randomUUID()},authorCookie)).status,401)
 await value(await post('/app/settings/members/remove',await reviewRemoval(origin,cookie,author.id)))
 await value(await post('/api/porthole/v1/actors/erase',{actorRef:author.id,confirm:'erase'}))
 assert.equal((await get(api+'/'+authored.event.id)).status,404)
 assert.deepEqual((await download(await get(api+'/export?sourceId='+encodeURIComponent(authored.event.sourceId)))).events,[])
 const erasedFacets=(await value(await get(api+'?sourceId='+encodeURIComponent(authored.event.sourceId)))).facets
 assert.equal(erasedFacets.totalEvents,0);assert.deepEqual(erasedFacets.counts.tag,[])
 assert.ok(!(await (await get('/app/dashboards/'+dashboard.id)).text()).includes(authored.event.title))
 assert.equal((await post(api,{...input,sourceId:authored.event.sourceId})).status,409,'erased event identity cannot be resurrected by replay')
 // A full allowed page is populated by actual local syntax-check executions.
 // This exercises the public upper page bound rather than only tiny fixtures.
 const batch=[]
 for(let i=0;i<205;i++) {
  await execute(process.execPath,['--check','cli/porthole.mjs'],{timeout:10000})
  const execution={...input,source:'native-batch',sourceId:randomUUID(),title:'Syntax check completed',occurredAt:String(BigInt(Date.now())*1000000n),resource:'syntax-run-'+i,tags:['execution:completed',i%2?'batch:odd':'batch:even']}
  const receipt=await value(await post(api,execution),201);batch.push({id:receipt.event.id,input:execution})
 }
 const expectedBatch=[...batch].sort((a,b)=>BigInt(a.input.occurredAt)<BigInt(b.input.occurredAt)?-1:BigInt(a.input.occurredAt)>BigInt(b.input.occurredAt)?1:a.id.localeCompare(b.id))
 const batchFirst=await download(await get(api+'/export?source=native-batch&limit=200'))
 assert.equal(batchFirst.events.length,200);assert.ok(batchFirst.cursor)
 await restartWorker()
 const batchLast=await download(await get(api+'/export?source=native-batch&limit=200&cursor='+encodeURIComponent(batchFirst.cursor)))
 assert.equal(batchLast.events.length,5);assert.equal(batchLast.cursor,'');assert.equal(batchLast.snapshot,batchFirst.snapshot)
 assert.deepEqual([...batchFirst.events,...batchLast.events].map(event=>event.id),expectedBatch.map(receipt=>receipt.id))
 const batchSearch=await value(await get(api+'?source=native-batch&limit=200'))
 assert.deepEqual(batchSearch.events,batchFirst.events)
 assert.equal(batchSearch.facets.totalEvents,205)
 assert.deepEqual(batchSearch.facets.counts.tag,[{value:'batch:even',count:103},{value:'batch:odd',count:102},{value:'execution:completed',count:205}])
 assert.equal(batchSearch.facets.counts.resource.length,205,'facet values beyond the event page remain discoverable')
 assert.ok(batchSearch.facets.counts.resource.every(row=>row.count===1&&/^syntax-run-\d+$/.test(row.value)))
 const continued=await value(await get(api+'?source=native-batch&limit=200&cursor='+encodeURIComponent(batchSearch.cursor)))
 assert.equal(continued.events.length,5);assert.deepEqual(continued.facets,batchSearch.facets,'facets describe the same complete corpus on every page')
 const even=await value(await get(api+'?source=native-batch&tag=batch%3Aeven&limit=1'))
 assert.equal(even.events.length,1);assert.equal(even.facets.totalEvents,103)
 assert.deepEqual(even.facets.counts.tag,[{value:'batch:even',count:103},{value:'execution:completed',count:103}])
 const lastResource=await value(await get(api+'?source=native-batch&resource=syntax-run-204'))
 assert.deepEqual(lastResource.events.map(row=>row.id),[batch[204].id])
 assert.equal(lastResource.facets.totalEvents,1)
 await eventBrowser({origin,cookie,path:'/app/events?source=native-batch&limit=1',name:'events-snapshot-facets',exercise:async page=>{
  assert.equal(await page.locator('[data-event]').count(),1)
  const facets=page.getByRole('region',{name:'Facets in this search'})
  assert.match(await facets.innerText(),/205 matching events/)
  const pivot=facets.getByRole('link',{name:'syntax-run-204 (1)',exact:true})
  await pivot.focus();await Promise.all([page.waitForURL('**resource=syntax-run-204**'),pivot.press('Enter')])
  assert.equal(await page.locator('[data-event]').getAttribute('data-event'),batch[204].id)
 }})
 const {eventArchiveJourney}=await import('./archive.mjs')
 await eventArchiveJourney({origin,freshOwner,withEmptyDestination,eventIds:[original.event.id,late.event.id],dashboardId:dashboard.id,filterId:filter.id,publicationPaths:publication.paths,value})
 cookie=await freshOwner()
 const stable=await sql('SELECT COUNT(*) AS n FROM porthole_custom_events')
 await mutate('ALTER TABLE porthole_custom_events RENAME TO porthole_events_unavailable')
 try {
  assert.equal((await get(api)).status,503)
  assert.equal((await get(api+'/export')).status,503)
  await eventBrowser({origin,cookie,path:'/app/events',name:'events-unavailable',status:503})
 }finally{await mutate('ALTER TABLE porthole_events_unavailable RENAME TO porthole_custom_events')}
 assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_custom_events'),stable)
 const afterEffects=await sql('SELECT (SELECT COUNT(*) FROM porthole_monitor_evaluations) AS evaluations,(SELECT COUNT(*) FROM porthole_health_notices) AS notices')
 assert.equal(afterEffects[0].evaluations,beforeEffects[0].evaluations);assert.equal(afterEffects[0].notices,beforeEffects[0].notices)
 console.log('PROBE PORT-069 native execution: real typecheck and syntax checks -> eight immutable paginated execution events alongside stock SDK request evidence with reconciled IDs, order and provenance')
 console.log('PROBE PORT-069 export and facets: 205 actual syntax checks in 200 and 5 record NDJSON pages, exact resource and tag predicates, failure exit 7, private filter, erased author and revoked membership -> reconciled immutable fields, 205 snapshot-wide resource facets and exact cross-page counts with refused exposure')
 console.log('PROBE PORT-069 replay and authority: concurrent and reordered retries, forged provider fields, private filters, changed scope and erased author -> one logical event and refused exposure')
 console.log('PROBE PORT-069 overlays and custody: native dashboard revisions, public source fences, restart and inactive archive -> authorized reference resolution with no revived public address')
 console.log('PROBE PORT-069 browser: native Events, Settings, empty, invalid, restricted and unavailable states -> keyboard completion and captured 1440 and 390 screens')
}
