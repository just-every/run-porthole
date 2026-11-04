import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const execute=promisify(execFile),api='/api/porthole/v1/dashboards',packs='/api/porthole/v1/dashboard-powerpacks'
export async function layoutTraffic({origin,source,call=fetch,service='synthetic-porthole-6800',team='commerce',environment='production',requests=3}) {
 const packets=[],failures=[],bridge=createServer(async(request,response)=>{
  try{const parts=[];for await(const part of request)parts.push(part);const body=Buffer.concat(parts),headers={'content-type':request.headers['content-type'],authorization:'Bearer '+source.secret};packets.push({path:request.url,headers,body});const forwarded=await call(origin+request.url,{method:'POST',headers,body});response.writeHead(forwarded.status,{'content-type':forwarded.headers.get('content-type')??'application/json'});response.end(Buffer.from(await forwarded.arrayBuffer()))}catch(error){failures.push(error);response.writeHead(503);response.end()}
 })
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve))
 try{const child=await execute(process.execPath,['tests/porthole/dashboard-layout-source.cjs'],{timeout:45000,env:{...process.env,NO_PROXY:'localhost,127.0.0.1,::1',PORTHOLE_LAYOUT_INTAKE:'http://127.0.0.1:'+bridge.address().port,PORTHOLE_LAYOUT_SOURCE:source.secret,OTEL_SDK_DISABLED:'false',OTEL_TRACES_SAMPLER:'always_on',PORTHOLE_LAYOUT_SERVICE:service,PORTHOLE_LAYOUT_TEAM:team,PORTHOLE_LAYOUT_ENVIRONMENT:environment,PORTHOLE_LAYOUT_REQUESTS:String(requests)},maxBuffer:1024*1024});assert.match(child.stdout,new RegExp('Actual HTTP requests completed: '+requests));assert.deepEqual(failures,[]);assert.equal(new Set(packets.map(packet=>packet.path)).size,3,'stock-exported signals: '+packets.map(packet=>packet.path).join(', '));return packets}finally{await new Promise(resolve=>{bridge.closeAllConnections();bridge.close(resolve)})}
}
export async function dashboardLayoutJourney({origin,freshOwner,signIn,restartWorker,withEmptyDestination,withPinnedClock,sql}) {
 let cookie=await freshOwner()
 const post=(path,data,session=cookie)=>fetch(origin+path,form(origin,session,data))
 const get=(path,session=cookie)=>fetch(origin+path,{headers:{cookie:session}})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const scope={services:['synthetic-porthole-6800','synthetic-porthole-6830'],environments:['production','staging'],teams:['commerce','payments']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-6804',class:'ingest',scope:{...scope,signals:['metrics','logs','traces'],actions:['telemetry.write']}}),201)
 const from=String(BigInt(Date.now()-1000)*1000000n),packets=[...await layoutTraffic({origin,source}),...await layoutTraffic({origin,source,team:'payments',environment:'staging',requests:2}),...await layoutTraffic({origin,source,service:scope.services[1],team:'payments',environment:'staging',requests:5})],through=String(BigInt(Date.now()+1000)*1000000n)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const params=signal=>new URLSearchParams({signal,service:scope.services[0],team:'commerce',environment:'production',from,through,...(signal==='metrics'?{metric:'synthetic_porthole_6802'}:{})})
 const records={}
 for(const signal of ['metrics','logs','traces'])records[signal]=(await value(await get('/api/porthole/v1/ingest/records?'+params(signal)))).records
 assert.equal(records.logs.length,3);assert.equal(records.traces.length,6);assert.equal(records.metrics.length,1)
 const durations=records.traces.map(row=>Number(BigInt(row.payload.record.endTimeUnixNano)-BigInt(row.payload.record.startTimeUnixNano))/1e6).sort((a,b)=>a-b),p95=durations[5]
 const panels=[{id:'requests',title:'Measured requests',signal:'metrics',service:scope.services[0],aggregate:'average',metric:'synthetic_porthole_6802',unit:'requests'},{id:'logs',title:'Measured logs',signal:'logs',service:scope.services[0],aggregate:'count',unit:'records'},{id:'traces',title:'Measured latency',signal:'traces',service:scope.services[0],aggregate:'p95',unit:'ms'}]
 const base={panels,variables:{team:'commerce',environment:'production'},range:{from,through},annotations:[]}
 const template={...base,layout:[{id:'requests-group',title:'Traffic',width:12,height:1,collapsed:false,children:panels.map(panel=>({panel:panel.id,width:6,height:1}))}]}
 const preview=await value(await post(packs+'/preview',{name:'Measured service pack',scope,body:template}),201)
 assert.equal((await value(await get(packs))).objects.length,0,'preview cannot activate a pack')
 const pack=await value(await post(packs+'/approve',{id:preview.id,digest:preview.digest,confirm:'apply-private-powerpack'}))
 await value(await post(packs+'/approve',{id:preview.id,digest:preview.digest,confirm:'apply-private-powerpack'}),409)
 const first=await value(await post(api,{name:'Private layout one',scope,body:base}),201)
 const {layoutPublicationFence}=await import('./publication.mjs')
 const publicPaths=await layoutPublicationFence({origin,cookie,id:first.id,revision:first.revision})
 const group={id:'native',title:'Native diagnostic group',width:6,height:1,collapsed:false,variables:{team:'commerce',environment:'production'},children:[{panel:'logs',width:12,height:1},{id:'nested',title:'Nested latency',width:12,height:1,collapsed:false,children:[{panel:'traces',width:12,height:1}]},{panel:'requests',width:12,height:1}]}
 let firstBody={...base,layout:[group]}
 await value(await post(api,{id:first.id,revision:first.revision,name:'Private layout one',scope,body:firstBody}),201)
 const bound=await post('/app/dashboards/pack',{id:first.id,revision:2,packId:pack.id,packRevision:1,title:'Reusable service'});assert.equal(bound.status,303,await bound.clone().text())
 let one=await value(await get(api+'/'+first.id))
 const secondBody={...base,panels:[],layout:[{id:'consumer',title:'Second reusable service',width:12,height:1,collapsed:false,variables:{team:'payments',environment:'production'},powerpack:{id:pack.id,revision:1},children:[]}]}
 const second=await value(await post(api,{name:'Private layout two',scope,body:secondBody}),201)
 const boundEmpty=await get('/app/dashboards/'+second.id),emptyText=await boundEmpty.text();assert.equal(boundEmpty.status,200);assert.match(emptyText,/role="status">empty/);assert.match(emptyText,/team=payments/);assert.match(emptyText,/environment=production/)
 const secondBefore=await value(await get(api+'/'+second.id))
 await value(await post(api,{id:second.id,revision:secondBefore.revision,name:secondBefore.name,scope,body:{...secondBefore.body,layout:secondBefore.body.layout.map(group=>({...group,variables:{team:'payments',environment:'staging'}}))}}),201)
 const allBefore=await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id')
 for(const body of [{...one.body,layout:[...one.body.layout,{panel:'logs',width:12,height:1}]},{...one.body,layout:one.body.layout.map((item,index)=>index?item:{...item,variables:{team:'foreign'}})},{...one.body,layout:one.body.layout.map((item,index)=>index?item:{...item,width:0})},{...one.body,layout:one.body.layout.map((item,index)=>index?item:{...item,service:'foreign'})}])assert.ok([400,403].includes((await post(api,{id:first.id,revision:one.revision,name:one.name,scope,body})).status))
 await value(await post(api,{id:first.id,revision:1,name:one.name,scope,body:one.body}),409)
 assert.deepEqual(await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id'),allBefore)
 const {layoutAuthorityJourney}=await import('./dashboard-api.mjs')
 const reader=await layoutAuthorityJourney({origin,cookie,signIn,id:first.id,scope,packId:pack.id,packRevision:1,body:template,sql})
 cookie=await freshOwner()
 const updateBody={...template,panels:panels.map(p=>({...p,title:p.title+' updated'})),layout:[{...template.layout[0],children:[{panel:'traces',width:12,height:1},{panel:'requests',width:6,height:1},{panel:'logs',width:6,height:1}]}]}
 const update=await value(await post(packs+'/preview',{id:pack.id,revision:1,name:'Reviewed updated pack',scope,body:updateBody}),201)
 assert.equal(JSON.parse(update.packet).consumers.length,2)
 const beforeUpdate=await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id')
 await value(await post(packs+'/approve',{id:update.id,digest:'synthetic-porthole-6805',confirm:'apply-private-powerpack'}),409)
 assert.deepEqual(await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id'),beforeUpdate)
 await value(await post(packs+'/approve',{id:update.id,digest:update.digest,confirm:'apply-private-powerpack'},reader),403)
 assert.deepEqual(await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id'),beforeUpdate)
 await packReviewBrowser({origin,cookie,review:update,ids:[first.id,second.id]})
 const two=await value(await get(api+'/'+second.id));one=await value(await get(api+'/'+first.id))
 assert.equal(one.revision,4);assert.equal(two.revision,3)
 for(const row of [one,two]){const g=row.body.layout.find(item=>item.powerpack);assert.equal(g.powerpack.revision,2);assert.deepEqual(g.children[0].children.map(item=>item.panel.split(':').at(-1)),['traces','requests','logs']);assert.ok(row.body.panels.filter(p=>p.id.includes(':')).every(p=>p.title.endsWith(' updated')))}
 const old=await value(await get(api+'/'+second.id+'?version=1'));assert.equal(old.body.layout[0].powerpack.revision,1)
 const history=await value(await get(packs+'/'+pack.id));assert.equal(history.versions.length,2)
 const next=await value(await post(packs+'/preview',{id:pack.id,revision:2,name:'Stale consumer update',scope,body:template}),201)
 await value(await post(api,{id:second.id,revision:two.revision,name:two.name,scope,body:two.body}),201)
 const noWrites=await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id')
 await value(await post(packs+'/approve',{id:next.id,digest:next.digest,confirm:'apply-private-powerpack'}),409)
 assert.deepEqual(await sql('SELECT id,body,revision FROM porthole_dashboards ORDER BY id'),noWrites)
 await withPinnedClock(next.expires_at+1,async()=>{assert.ok([403,409].includes((await post(packs+'/approve',{id:next.id,digest:next.digest,confirm:'apply-private-powerpack'})).status))})
 await restartWorker();one=await value(await get(api+'/'+first.id));assert.equal(one.body.layout[1].powerpack.revision,2)
 const preserved=await value(await get(api+'/'+second.id));assert.deepEqual(preserved.body.layout[0].variables,{team:'payments',environment:'staging'});assert.deepEqual(preserved.body.range,{from,through})
 await boundConsumerBrowser({origin,cookie,id:second.id,otherId:first.id,from,through,service:scope.services[1]})
 for(const packet of packets){const retry=await fetch(origin+packet.path,{method:'POST',headers:packet.headers,body:packet.body});assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')}
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 assert.equal((await value(await get('/api/porthole/v1/ingest/records?'+params('logs')))).records.length,3)
 await layoutPublicationFence({origin,cookie,id:first.id,phase:'refused',paths:publicPaths})
 const audit=await value(await get('/api/v1/audit/export')),committed=audit.records.map(record=>record.entry).filter(entry=>entry.phase==='committed')
 const packFact=committed.find(entry=>entry.action==='dashboards.powerpack-change'&&entry.entityRef===pack.id&&entry.revision===2)
 assert.ok(packFact?.actorRef,'the reviewed owner update has an attributed durable fact')
 for(const [id,revision] of [[first.id,4],[second.id,3]])assert.ok(committed.some(entry=>entry.action==='dashboards.change'&&entry.entityRef===id&&entry.revision===revision&&entry.operationRef===packFact.operationRef),'both consumer facts share the exact pack update transaction')
 await layoutBrowser({origin,cookie,id:first.id,reader,expected:{p95,from,through,service:scope.services[1]},withPinnedClock})
 const {layoutArchiveJourney}=await import('./archive.mjs')
 await layoutArchiveJourney({origin,freshOwner,withEmptyDestination,ids:[first.id,second.id],packId:pack.id,publicPaths})
 cookie=await freshOwner()
 await value(await post('/app/settings/credentials/revoke',{id:source.credential.id}))
 const retainedBefore=await sql('SELECT id,record_count,state FROM porthole_ingest_batches ORDER BY id')
 for(const packet of packets)assert.equal((await fetch(origin+packet.path,{method:'POST',headers:packet.headers,body:packet.body})).status,401)
 assert.deepEqual(await sql('SELECT id,record_count,state FROM porthole_ingest_batches ORDER BY id'),retainedBefore,'revoked source retries cannot persist another capture')
 console.log('PROBE PORT-068 layout: real stock HTTP traffic through three-signal intake -> 3 logs, 6 spans, request metric 3; nested order, scope, source links and rendered values agree')
 console.log('PROBE PORT-068 packs: native owner exact review -> both consumers reflect reviewed updates with immutable history and preserved scope bindings; stale, expired, foreign and delegated attempts refuse without writes')
 console.log('PROBE PORT-068 publication: bind, pack update, replay, restart and inactive restore -> old TV, embed and image addresses remain refused')
 console.log('dashboardLayoutJourney passed')
}
async function boundConsumerBrowser({origin,cookie,id,otherId,from,through,service}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:900}})
   await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
   const page=await context.newPage(),path=origin+'/app/dashboards/'+id
   assert.equal((await page.goto(path)).status(),200)
   if(width===1440) {
    const group=page.locator('[data-layout-group="consumer"]')
    assert.deepEqual(await group.locator('[data-panel]').evaluateAll(nodes=>nodes.map(n=>n.dataset.panel)),['consumer:traces','consumer:requests','consumer:logs'])
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/2 records/)
    assert.match(await group.locator('[data-panel="consumer:requests"]').innerText(),/2 requests/)
    const traceLink=new URL(await group.getByRole('link',{name:'Open underlying traces query'}).getAttribute('href'),origin)
    traceLink.pathname='/api/porthole/v1/ingest/records'
    const traceRecords=(await (await context.request.get(traceLink.href)).json()).records
    assert.equal(traceRecords.length,4,'two independently emitted HTTP requests contribute client and server spans')
    const latency=Math.max(...traceRecords.map(row=>Number(BigInt(row.payload.record.endTimeUnixNano)-BigInt(row.payload.record.startTimeUnixNano))/1e6))
    const traceText=await group.locator('[data-panel="consumer:traces"]').innerText()
    assert.match(traceText,/4 records/)
    assert.match(traceText,new RegExp(String(Number(latency.toFixed(4))).replace('.','\\.')),'the second consumer renders its own measured trace percentile')
    for(const link of await group.getByRole('link',{name:/Open underlying/}).all()) {
     const target=new URL(await link.getAttribute('href'),origin)
     assert.equal(target.searchParams.get('from'),from);assert.equal(target.searchParams.get('through'),through)
     assert.equal(target.searchParams.get('team'),'payments');assert.equal(target.searchParams.get('environment'),'staging')
     assert.equal((await context.request.get(target.href)).status(),200)
    }
    // Pack children are reviewed as one reusable definition. A local child
    // edit must refuse visibly rather than silently discard the requested change.
    await page.getByText('Edit dashboard',{exact:true}).click()
    const editor=page.getByLabel('Dashboard JSON'),body=JSON.parse(await editor.inputValue())
    body.layout[0].children[0].variables={team:'commerce',environment:'production'}
    const before=await (await context.request.get(origin+api+'/'+id)).json()
    await editor.fill(JSON.stringify(body));await page.getByRole('button',{name:'Save new revision',exact:true}).focus()
    const refusal=await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.keyboard.press('Enter')])
    assert.equal(refusal[0].status(),400,'unreviewed pack child changes must not be silently lost')
    assert.match(await page.getByRole('alert').innerText(),/edit powerpack children in settings/)
    if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-unreviewed-child-${width}.png`),fullPage:true})}
    assert.deepEqual(await (await context.request.get(origin+api+'/'+id)).json(),before,'a refused local pack edit leaves its consumer and history unchanged')
    await page.goto(path);await page.getByText('Edit dashboard',{exact:true}).click()
    const local=JSON.parse(await editor.inputValue());local.layout[0].variables={team:'commerce',environment:'production'}
    await editor.fill(JSON.stringify(local));await page.getByRole('button',{name:'Save new revision',exact:true}).focus()
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.keyboard.press('Enter')]);await page.reload()
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/3 records/)
    assert.match(await group.locator('[data-panel="consumer:requests"]').innerText(),/3 requests/)
    // The native group form edits only this consumer's binding. All three
    // signals must switch to the independently emitted five-request service.
    await page.goto(path)
    const bindings=group.getByRole('form',{name:'Group scope bindings'}),settings=group.locator(':scope > .porthole-layout-controls')
    const saveBindings=async(values)=>{
     await settings.getByText('Layout settings',{exact:true}).click()
     for(const [field,value] of Object.entries(values))await bindings.getByLabel(field+' binding',{exact:true}).fill(value)
     await bindings.getByRole('button',{name:'Save bindings',exact:true}).focus()
     await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.keyboard.press('Enter')]);await page.reload()
    }
    const beforeBindings=await (await context.request.get(origin+api+'/'+id)).json()
    await saveBindings({Service:service,Team:'payments',Environment:'staging'})
    const afterBindings=await (await context.request.get(origin+api+'/'+id)).json()
    assert.equal(afterBindings.revision,beforeBindings.revision+1)
    assert.deepEqual(afterBindings.body.layout[0].children,beforeBindings.body.layout[0].children)
    assert.deepEqual(afterBindings.body.panels,beforeBindings.body.panels)
    assert.deepEqual(afterBindings.body.layout[0].powerpack,beforeBindings.body.layout[0].powerpack)
    assert.equal(afterBindings.body.layout[0].service,service)
    assert.deepEqual(afterBindings.body.layout[0].variables,{team:'payments',environment:'staging'})
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/5 records/)
    assert.match(await group.locator('[data-panel="consumer:requests"]').innerText(),/5 requests/)
    const scopedTrace=new URL(await group.getByRole('link',{name:'Open underlying traces query'}).getAttribute('href'),origin)
    scopedTrace.pathname='/api/porthole/v1/ingest/records'
    const serviceTraces=(await (await context.request.get(scopedTrace.href)).json()).records
    assert.equal(serviceTraces.length,10)
    const serviceLatency=Math.max(...serviceTraces.map(row=>Number(BigInt(row.payload.record.endTimeUnixNano)-BigInt(row.payload.record.startTimeUnixNano))/1e6))
    assert.match(await group.locator('[data-panel="consumer:traces"]').innerText(),new RegExp(String(Number(serviceLatency.toFixed(4))).replace('.','\\.')))
    for(const link of await group.getByRole('link',{name:/Open underlying/}).all()) {
     const target=new URL(await link.getAttribute('href'),origin)
     for(const [key,value] of Object.entries({service,team:'payments',environment:'staging',from,through}))assert.equal(target.searchParams.get(key),value)
     assert.equal((await context.request.get(target.href)).status(),200)
    }
    const mutate=async(data,status)=>{
     const response=await context.request.post(origin+'/app/dashboards/layout',{headers:{origin},data:{id,revision:afterBindings.revision,group:'consumer',binding:'scope',service,team:'payments',environment:'staging',...data},maxRedirects:0})
     assert.equal(response.status(),status,await response.text())
    }
    await mutate({revision:beforeBindings.revision},409)
    for(const key of ['service','team','environment'])await mutate({[key]:'foreign'},403)
    await mutate({binding:'unexpected'},400)
    await mutate({team:42},400)
    await mutate({group:'consumer:requests-group'},400)
    assert.deepEqual(await (await context.request.get(origin+api+'/'+id)).json(),afterBindings,'refused stale, foreign and pack-child form edits preserve the consumer and its history')
    await saveBindings({Service:'',Team:'',Environment:''})
    const inherited=await (await context.request.get(origin+api+'/'+id)).json()
    assert.equal(inherited.body.layout[0].service,undefined)
    assert.equal(inherited.body.layout[0].variables,undefined)
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/3 records/)
    assert.match(await group.locator('[data-panel="consumer:requests"]').innerText(),/3 requests/)
    await saveBindings({Team:'payments'})
    assert.match(await group.locator('[data-panel="consumer:logs"] > [role="status"]').first().innerText(),/empty/)
    await saveBindings({Service:'',Team:'payments',Environment:'staging'})
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/2 records/)
    assert.deepEqual((await (await context.request.get(origin+api+'/'+id+'?version='+afterBindings.revision)).json()).body,afterBindings.body,'later binding edits preserve the exact earlier revision')
    // A later reviewed update must preserve each consumer's form-edited scope,
    // not replace it with the reusable definition's own variable defaults.
    await saveBindings({Service:service,Team:'payments',Environment:'staging'})
    const consumerBefore=await (await context.request.get(origin+api+'/'+id)).json(),otherBefore=await (await context.request.get(origin+api+'/'+otherId)).json()
    const packId=consumerBefore.body.layout[0].powerpack.id,packBefore=await (await context.request.get(origin+packs+'/'+packId)).json(),definition=JSON.parse(packBefore.body)
    definition.layout[0].children=[definition.layout[0].children[2],definition.layout[0].children[0],definition.layout[0].children[1]]
    const reviewResponse=await context.request.post(origin+packs+'/preview',{headers:{origin},data:{id:packId,revision:packBefore.revision,name:packBefore.name,scope:JSON.parse(packBefore.scope),body:definition}})
    assert.equal(reviewResponse.status(),201,await reviewResponse.text())
    const review=await reviewResponse.json(),applied=await context.request.post(origin+packs+'/approve',{headers:{origin},data:{id:review.id,digest:review.digest,confirm:'apply-private-powerpack'}})
    assert.equal(applied.status(),200,await applied.text())
    for(const [before,count] of [[consumerBefore,5],[otherBefore,3]]) {
     const after=await (await context.request.get(origin+api+'/'+before.id)).json(),prior=before.body.layout.find(item=>item.powerpack),current=after.body.layout.find(item=>item.powerpack)
     const binding=({children,powerpack,...rest})=>rest
     assert.equal(after.revision,before.revision+1)
     assert.equal(current.powerpack.revision,packBefore.revision+1)
     assert.deepEqual(binding(current),binding(prior))
     assert.deepEqual(current.children[0].children.map(item=>item.panel.split(':').at(-1)),['logs','traces','requests'])
     await page.goto(origin+'/app/dashboards/'+after.id)
     const consumer=page.locator('[data-layout-group]').filter({has:page.locator(`[data-panel="${current.id}:logs"]`)}).first()
     assert.match(await consumer.locator(`[data-panel="${current.id}:logs"]`).innerText(),new RegExp(count+' records'))
     assert.match(await consumer.locator(`[data-panel="${current.id}:requests"]`).innerText(),new RegExp(count+' requests'))
     assert.deepEqual((await (await context.request.get(origin+api+'/'+before.id+'?version='+before.revision)).json()).body,before.body)
    }
    await page.goto(path)
    await saveBindings({Service:'',Team:'payments',Environment:'staging'})
    // Keep the second consumer distinct for the final two viewport captures.
    await page.getByText('Edit dashboard',{exact:true}).click()
    const restored=JSON.parse(await editor.inputValue());restored.layout[0].variables={team:'payments',environment:'staging'}
    await editor.fill(JSON.stringify(restored));await page.getByRole('button',{name:'Save new revision',exact:true}).focus()
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.keyboard.press('Enter')]);await page.reload()
    assert.match(await group.locator('[data-panel="consumer:logs"]').innerText(),/2 records/)
   }
   const settings=page.locator('[data-layout-group="consumer"] > .porthole-layout-controls')
   await settings.getByText('Layout settings',{exact:true}).click()
   if(width===1440){assert.equal(await settings.getByLabel('Team binding',{exact:true}).inputValue(),'payments');assert.equal(await settings.getByLabel('Environment binding',{exact:true}).inputValue(),'staging')}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-bound-consumer-${width}.png`),fullPage:true})}
   if(width===390) {
    await page.getByText('Edit dashboard',{exact:true}).click()
    const editor=page.getByLabel('Dashboard JSON'),body=JSON.parse(await editor.inputValue())
    body.layout[0].children[0].variables={team:'commerce',environment:'production'}
    await editor.fill(JSON.stringify(body));await page.getByRole('button',{name:'Save new revision',exact:true}).click();await page.waitForLoadState('networkidle')
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-unreviewed-child-${width}.png`),fullPage:true})
   }
   await context.close()
  }
 } finally {await browser.close()}
 console.log('PROBE PORT-068 child-bindings: independently emitted commerce production and payments staging traffic -> updated consumers preserve distinct metric, log and trace values, order, original ranges and source links after restart; native JSON save retains consumer variables and refuses unreviewed child edits without writes; keyboard group binding forms switch service and variables, clear overrides to inherit, survive a later reviewed two-consumer update, and reject stale, foreign and reviewed-child changes without writes')
}

async function layoutBrowser({origin,cookie,id,reader,expected,withPinnedClock}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:origin.startsWith('https://127.0.0.1:')});await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),path='/app/dashboards/'+id
  const submit=async(control,keyboard=true)=>{if(keyboard)await control.focus();await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),keyboard?page.keyboard.press('Enter'):control.click()])}
  const shot=async name=>{if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-${name}-${width}.png`),fullPage:true})}}
  assert.equal((await page.goto(origin+path)).status(),200)
  if(width===1440){
   assert.deepEqual(await page.locator('[data-layout-group="native"] [data-panel]').evaluateAll(nodes=>nodes.map(n=>n.dataset.panel)),['logs','traces','requests'])
   assert.match(await page.locator('[data-panel="logs"]').innerText(),/3 records/)
   assert.match(await page.locator('[data-panel="requests"]').innerText(),/3 requests/)
   assert.match(await page.locator('[data-panel="traces"]').innerText(),new RegExp(String(Number(expected.p95.toFixed(4))).replace('.','\\.')))
   for(const link of await page.getByRole('link',{name:/Open underlying/}).all()){const target=new URL(await link.getAttribute('href'),origin);assert.equal(target.searchParams.get('from'),expected.from);assert.equal(target.searchParams.get('through'),expected.through);assert.equal(target.searchParams.get('team'),'commerce');assert.equal(target.searchParams.get('environment'),'production');assert.equal((await context.request.get(target.href)).status(),200)}
   const group=page.locator('[data-layout-group="native"]'),controls=group.locator(':scope > .porthole-layout-controls');await controls.getByText('Layout settings',{exact:true}).click();await controls.getByLabel('Width',{exact:true}).selectOption('12');await controls.getByLabel('Height',{exact:true}).selectOption('2');await submit(controls.getByRole('button',{name:'Save size'}));await page.reload();assert.match(await group.getAttribute('class'),/span-12.*height-2/)
   await controls.getByText('Layout settings',{exact:true}).click();await submit(controls.getByRole('button',{name:'Collapse group'}));assert.equal(await group.locator(':scope > details').first().getAttribute('open'),null);await page.reload();assert.equal(await group.locator(':scope > details').first().getAttribute('open'),null)
   await controls.getByText('Layout settings',{exact:true}).click();await submit(controls.getByRole('button',{name:'Expand group'}),false)
   const child=page.locator('[data-layout-panel="logs"] > .porthole-layout-controls');await child.getByText('Layout settings',{exact:true}).click();await submit(child.getByRole('button',{name:'Move down'}));assert.deepEqual(await group.locator('[data-panel]').evaluateAll(nodes=>nodes.map(n=>n.dataset.panel)),['traces','logs','requests'])
   const nested=page.locator('[data-layout-group="nested"]'),nestedSettings=nested.locator(':scope > .porthole-layout-controls')
   await nestedSettings.getByText('Layout settings',{exact:true}).click()
   for(const [name,value] of Object.entries({Service:expected.service,Team:'payments',Environment:'staging'}))await nestedSettings.getByLabel(name+' binding',{exact:true}).fill(value)
   await submit(nestedSettings.getByRole('button',{name:'Save bindings',exact:true}))
   assert.match(await nested.locator('[data-panel="traces"]').innerText(),/10 records/)
   assert.match(await group.locator('[data-panel="logs"]').innerText(),/3 records/)
   await nestedSettings.getByText('Layout settings',{exact:true}).click()
   for(const name of ['Service','Team','Environment'])await nestedSettings.getByLabel(name+' binding',{exact:true}).fill('')
   await submit(nestedSettings.getByRole('button',{name:'Save bindings',exact:true}));await page.reload()
   assert.match(await nested.locator('[data-panel="traces"]').innerText(),/6 records/)
   const inheritedLink=new URL(await nested.getByRole('link',{name:'Open underlying traces query'}).getAttribute('href'),origin)
   assert.equal(inheritedLink.searchParams.get('team'),'commerce');assert.equal(inheritedLink.searchParams.get('environment'),'production');assert.equal(inheritedLink.searchParams.get('service'),'synthetic-porthole-6800')
   assert.equal(await page.locator('button,a').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0,'all touched controls have text labels')
   assert.ok(await page.locator('main p,main button,main label,main summary').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)))
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'layout fits viewport');await shot('completed')
  await page.goto(origin+path+'?team=payments&environment=production');if(width===1440)assert.match(await page.locator('[data-panel="logs"] > [role="status"]').first().innerText(),/empty/);await shot('empty')
  await page.goto(origin+path+'?from=invalid');if(width===1440)assert.match(await page.getByRole('alert').innerText(),/invalid dashboard range/);await shot('invalid')
  await withPinnedClock(Number(BigInt(expected.through)/1000000n)+700000,async()=>{await page.goto(origin+path);if(width===1440)assert.match(await page.locator('[data-panel="logs"] > [role="status"]').first().innerText(),/stale/);await shot('stale')})
  await page.goto(origin+'/app/settings/dashboard-powerpacks');await shot('settings')
  const denied=await browser.newContext({viewport:{width,height:844}});await denied.addCookies(reader.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})));const refused=await denied.newPage();assert.equal((await refused.goto(origin+path)).status(),403);if(process.env.PORTHOLE_EVIDENCE_DIR)await refused.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-unauthorized-${width}.png`),fullPage:true});await denied.close();await context.close()
 }}finally{await browser.close()}
 console.log('PROBE PORT-068 browser: native layout and Settings at 1440 and 390 -> completed, empty, invalid, stale and unauthorized; keyboard resize, reorder, collapse, save and reload; no overflow')
}

export async function layoutAnalyticalJourney() {
 const {analyticalEstate}=await import('./analytics.mjs'),{recipientMailJourney}=await import('./health.mjs'),estate=await analyticalEstate()
 try {await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async({origin,cookie,call,post,restart})=>{
  const send=async(path,data,status=200)=>(await post(path,data,status)).json()
  const read=async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()}
  let config=await read('/api/porthole/v1/analytics/configuration')
  await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role:'primary',confirm:'connect-analytical-workers'})
  const scope={services:['synthetic-porthole-6800'],teams:['commerce'],environments:['production']},source=await send('/app/settings/credentials/mint',{name:'synthetic-porthole-6820',class:'ingest',scope:{...scope,signals:['metrics','logs','traces'],actions:['telemetry.write']}},201)
  const from=String(BigInt(Date.now()-1000)*1000000n),packets=await layoutTraffic({origin,source,call:(url,options)=>call(new URL(url).pathname,options)}),through=String(BigInt(Date.now()+1000)*1000000n)
  const drain=await send('/api/porthole/v1/ingest/drain',{});assert.equal(drain.analytical.complete,true)
  const panels=[{id:'logs',title:'Analytical measured logs',signal:'logs',service:scope.services[0],aggregate:'count',unit:'records'},{id:'requests',title:'Analytical measured requests',signal:'metrics',service:scope.services[0],aggregate:'average',metric:'synthetic_porthole_6802',unit:'requests'}]
  const body={panels,variables:{team:'commerce',environment:'production'},range:{from,through},annotations:[],layout:[{panel:'logs',width:6,height:1},{panel:'requests',width:6,height:1}]}
  const preview=await send(packs+'/preview',{name:'Analytical reusable pack',scope,body},201),pack=await send(packs+'/approve',{id:preview.id,digest:preview.digest,confirm:'apply-private-powerpack'})
  const ids=[]
  for(let index=0;index<2;index++){const saved=await send(api,{name:'Analytical consumer '+index,scope,body:{...body,panels:[],layout:[{id:'consumer',title:'Measured group',width:12,height:1,collapsed:false,variables:body.variables,powerpack:{id:pack.id,revision:1},children:[]}]}},201);ids.push(saved.id)}
  const next=await send(packs+'/preview',{id:pack.id,revision:1,name:'Analytical reusable pack updated',scope,body:{...body,panels:panels.map(panel=>({...panel,title:panel.title+' updated'})),layout:[body.layout[1],body.layout[0]]}},201)
  await send(packs+'/approve',{id:next.id,digest:next.digest,confirm:'apply-private-powerpack'})
  const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  const check=async(role,width=1440,unavailable=false)=>{
   const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:origin.startsWith('https://127.0.0.1:')});await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
   await context.route(origin+'/**',async route=>{const request=route.request(),response=await call(new URL(request.url()).pathname+new URL(request.url()).search,{method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
   const page=await context.newPage()
   for(const id of ids){assert.equal((await page.goto(origin+'/app/dashboards/'+id)).status(),200);if(width===1440){const group=page.locator('[data-layout-group="consumer"]');assert.deepEqual(await group.locator('[data-panel]').evaluateAll(nodes=>nodes.map(node=>node.dataset.panel)),['consumer:requests','consumer:logs']);if(unavailable){assert.match(await group.innerText(),/unavailable: analytics/s);assert.equal(await group.locator('strong').count(),0)}else{assert.equal(await group.locator('strong').allTextContents().then(values=>values.join(',')),'3,3');assert.equal((await read(api+'/'+id)).revision,2);const link=new URL(await group.getByRole('link',{name:'Open underlying metrics query'}).getAttribute('href'),origin);assert.equal(link.searchParams.get('from'),from);assert.equal(link.searchParams.get('through'),through)}}}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-${role}-${unavailable?'unavailable':'complete'}-${width}.png`),fullPage:true})}
   await context.close()
  }
  try{
   for(const role of ['primary','standby']){config=await read('/api/porthole/v1/analytics/configuration');await send('/api/porthole/v1/analytics/configuration',{revision:config.revision,enabled:true,role,confirm:'connect-analytical-workers'});await check(role)}
   await restart();await check('standby');await check('standby',390)
   for(const packet of packets){const retry=await call(packet.path,{method:'POST',headers:packet.headers,body:packet.body});assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')}
   await send('/api/porthole/v1/ingest/drain',{})
   for(const role of ['primary','standby'])assert.equal((await estate.inspect(role)).filter(row=>row.signal!=='metrics'||JSON.parse(row.payload).metric.name==='synthetic_porthole_6802').length,10,'replicas contain one application metric, three logs and six stock HTTP spans after replay')
   await estate.stop('standby');await check('standby',1440,true);await check('standby',390,true)
  }finally{await browser.close()}
 }})}finally{await estate.dispose()}
 console.log('PROBE PORT-068 analytical: stock traffic and reviewed two-consumer pack update -> exact metric and log values on primary and standby, cold restart and replay; stopped selected worker is explicitly unavailable without fallback')
}

async function packReviewBrowser({origin,cookie,review,ids}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}});await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();assert.equal((await page.goto(origin+'/app/settings/dashboard-powerpacks?review='+review.id)).status(),200)
  if(width===1440){const section=page.getByRole('region',{name:'Exact powerpack review'});for(const id of ids)assert.match(await section.innerText(),new RegExp(id));assert.match(await section.locator('pre').innerText(),/Measured logs updated/)}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`layout-powerpack-review-${width}.png`),fullPage:true})}
  if(width===1440){await page.getByRole('checkbox',{name:'Apply this exact private definition and these consumer revisions'}).check();await page.getByRole('button',{name:'Approve private update',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForURL(/\/app\/settings\/dashboard-powerpacks\/[a-f0-9-]{36}$/)}
  await context.close()
 }}finally{await browser.close()}
}
