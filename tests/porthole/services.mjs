import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal,fixture} from './fixture.mjs'
import {serviceCatalogEstate} from './polyglot/estate.mjs'
const api='/api/porthole/v1/services',address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
const scope={services:['checkout','fulfillment'],environments:['production'],teams:['commerce','fulfillment']}
export async function servicesJourney({origin,freshOwner,signIn,sql,restartWorker,withPinnedClock,withEmptyDestination,call=(path,options)=>fetch(origin+path,options),analytical=false,browserDispatch}) {
 let cookie=await freshOwner()
 const send=async(path,data,status=200,acting=cookie)=>{const response=await call(path,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.headers.get('content-type')?.includes('json')?response.json():response}
 const read=async(path=api,acting=cookie)=>{const response=await call(path,{headers:{cookie:acting}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const metaStorage=()=>sql('SELECT * FROM porthole_service_versions ORDER BY id,revision')
 const grants=()=>sql('SELECT operator_id,role,scope,revision FROM porthole_members ORDER BY operator_id')
 const denied=async(path,data,status=403,acting=cookie,headers={})=>{const before=await metaStorage(),response=await call(path,{...form(origin,acting,data),headers:{...form(origin,acting,data).headers,...headers}});assert.equal(response.status,status,await response.clone().text());assert.deepEqual(await metaStorage(),before,'forbidden or stale writes leave metadata unchanged')}
 assert.equal((await call(api)).status,401)
 assert.equal((await read()).services.length,0)
 await servicesBrowser({origin,cookie,path:'/app/services',contains:'No services with retained evidence',name:'services-empty',dispatch:browserDispatch})
 const source=await send('/app/settings/credentials/mint',{name:'synthetic-porthole-8206',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}},201)
 const proof=await serviceCatalogEstate({origin,secret:source.secret,dispatch:call})
 assert.equal(proof.statuses.filter(s=>s===503).length,8,'independently counted application errors')
 assert.equal(proof.statuses.filter(s=>s===200).length,28)
 assert.equal(proof.receipts.find(r=>r.received.length).received.length,36,'all actual queue messages arrived once')
 let pending=1
 for(let pass=0;pass<20&&pending;pass++)pending=(await send('/api/porthole/v1/ingest/drain',{})).pendingBatches
 assert.equal(pending,0)
 console.log('Services: stock export drained; checking source counters and catalog')
 const start=proof.spans.reduce((a,s)=>BigInt(s.startNs)<a?BigInt(s.startNs):a,BigInt(proof.spans[0].startNs)),end=proof.spans.reduce((a,s)=>BigInt(s.startNs)+BigInt(s.durationNs)>a?BigInt(s.startNs)+BigInt(s.durationNs):a,0n)
 const query='?'+new URLSearchParams({from:String(start-1n),through:String(end+1n)}),view=await read(api+query)
 assert.equal(view.coverage.scanComplete,true);assert.equal(view.coverage.fullTraffic,false)
 assert.equal(view.services.length,2);assert.ok(view.services.every(s=>s.versions.includes('synthetic-porthole-8205')))
 assert.ok(view.services.every(s=>s.freshness==='recent'))
 const expectedRequests=proof.spans.filter(s=>s.kind===2||s.kind===5)
 for(const service of view.services){
  const captured=expectedRequests.filter(s=>s.resource['service.name']===service.service),app=proof.receipts.find(r=>r.spans.some(s=>s.resource['service.name']===service.service))
  assert.equal(service.summary.requests,Object.values(app.counts).reduce((a,b)=>a+b,0)+app.received.length,'source counters include server requests and consumers only')
  assert.equal(service.summary.requests,captured.length)
  assert.equal(service.summary.errors,service.service==='checkout'?8:8)
  const durations=captured.map(s=>BigInt(s.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0)
  for(const [key,p]of [['p50Ns',.5],['p95Ns',.95],['p99Ns',.99]])assert.equal(service.summary[key],durations[Math.ceil(durations.length*p)-1].toString(),'exact quantile from independently captured stock spans')
  assert.equal(service.summary.requestsPerSecond,captured.length/(Number(end-start+3n)/1e9))
  for(const endpoint of service.endpoints){
   const spans=captured.filter(s=>(s.attributes['http.route']??s.name)===endpoint.endpoint)
   assert.equal(endpoint.requests,spans.length,'source endpoint membership: '+endpoint.endpoint)
   assert.equal(endpoint.errors,spans.filter(s=>s.status.code===2||Number(s.attributes['http.response.status_code']??s.attributes['http.status_code'])>=500).length)
   const latency=spans.map(span=>BigInt(span.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0)
   for(const [key,p]of [['p50Ns',.5],['p95Ns',.95],['p99Ns',.99]])assert.equal(endpoint[key],latency[Math.ceil(latency.length*p)-1].toString(),'per-endpoint latency reconciles with the original stock spans')
   assert.equal(endpoint.requestsPerSecond,spans.length/(Number(end-start+3n)/1e9))
  }
 }
 const checkout=view.services.find(s=>s.service==='checkout'),fulfillment=view.services.find(s=>s.service==='fulfillment')
 const {serviceTopologyProof}=await import('./traces.mjs')
 await serviceTopologyProof({read,proof,view,checkout,fulfillment})
 await servicesBrowser({origin,cookie,path:'/app/services/'+checkout.id+query,contains:'Observed requests',name:'services-summary',dispatch:browserDispatch,observed:checkout.summary})
 for(const [index,packet]of proof.packets.entries()){
  const replay=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':packet.type,'x-porthole-batch-id':'synthetic-porthole-replay-'+index},body:packet.body})
  assert.equal(replay.status,200,await replay.clone().text())
 }
 await send('/api/porthole/v1/ingest/drain',{})
 const replayed=await read(api+query)
 assert.deepEqual(replayed.services.map(s=>s.summary),view.services.map(s=>s.summary),'replaying the original stock export never adds requests')
 assert.deepEqual(replayed.edges,view.edges)
 const partial=await read(api+query+'&budget=200');assert.equal(partial.coverage.scanComplete,false,'multi-page bounded scans stay partial')
 await servicesBrowser({origin,cookie,path:'/app/services'+query+'&budget=200',contains:'Partial scan',name:'services-partial',dispatch:browserDispatch})
 await send('/app/settings/members/invite',{email:address(8207),displayName:'Eligible service owner',role:'responder',scope:{services:['checkout'],environments:['production'],teams:['commerce']}},202)
 let eligibleCookie=await signIn(address(8207)),eligible=(await read('/auth/session',eligibleCookie)).operator
 const eligibleView=await read(api+query,eligibleCookie)
 assert.deepEqual(eligibleView.services.map(service=>service.service),['checkout'],'the eligible responder remains restricted to the existing checkout scope')
 assert.ok(eligibleView.edges.some(edge=>edge.kind==='unresolved-target'&&edge.to===null),'an outbound call without an authorized receiver remains explicitly unresolved')
 cookie=await freshOwner()
 const owner=(await read('/auth/session')).operator,baselineGrants=await grants(),values={revision:0,ownerRef:owner.id,repository:'https://example.invalid/checkout.git',runbook:'https://restricted.example/runbooks/checkout?view=synthetic-porthole-8209#recovery',criticality:'high',confirm:'save-service-metadata'}
 await send(api+'/'+checkout.id,values,201)
 assert.deepEqual(await grants(),baselineGrants,'attribution grants no membership or scope')
 await denied(api+'/'+checkout.id,values,409)
 await denied(api+'/'+checkout.id,{...values,revision:1},403,eligibleCookie)
 await denied(api+'/'+checkout.id,{...values,revision:1},403,cookie,{origin:'https://foreign.example'})
 await denied(api+'/'+checkout.id,{...values,revision:1},403,cookie,{authorization:'Bearer '+source.secret})
 await denied(api+'/'+checkout.id,{...values,revision:1,runbook:'javascript:alert(1)'},400)
 await send('/app/settings/members/invite',{email:address(8208),displayName:'Restricted responder',role:'restricted contractor',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}},202)
 const restricted=await signIn(address(8208)),restrictedId=(await read('/auth/session',restricted)).operator.id
 cookie=await freshOwner()
 await denied(api+'/'+checkout.id,{...values,revision:1,ownerRef:restrictedId})
 const hidden=await read(api+query,restricted)
 assert.deepEqual(hidden.services.map(s=>s.service),['fulfillment']);assert.ok(hidden.edges.some(e=>e.to===null));assert.ok(!JSON.stringify(hidden).includes('checkout'))
 assert.equal((await call(api+'/'+checkout.id+query,{headers:{cookie:restricted}})).status,404)
 const grantsBeforeReassignment=await grants()
 await send(api+'/'+checkout.id,{...values,revision:1,ownerRef:eligible.id},201)
 assert.deepEqual(await grants(),grantsBeforeReassignment,'reassignment grants no new dataset or membership scope')
 const assigned=await read(api+'/'+checkout.id+query,eligibleCookie)
 assert.equal(assigned.metadata.owner_ref,eligible.id);assert.deepEqual(assigned.history.map(r=>r.revision),[2,1])
 assert.equal(assigned.history[1].owner_ref,owner.id)
 assert.equal((await grants()).find(m=>m.operator_id===eligible.id).role,'responder')
 console.log('Services: scoped metadata refusal checks passed; checking native Settings')
 await servicesBrowser({origin,cookie,path:'/app/settings/services/'+checkout.id+query,contains:'Review service metadata',name:'services-settings',dispatch:browserDispatch,save:true})
 const changed=await read(api+'/'+checkout.id+query)
 assert.equal(changed.metadata.revision,3);assert.equal(changed.metadata.criticality,'critical');assert.equal(changed.metadata.runbook,'https://restricted.example/runbooks/reviewed')
 assert.equal((await sql("SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='services.revise' AND json_extract(entry,'$.phase')='committed'"))[0].n,3,'each immutable revision has an atomic audit fact')
 await restartWorker();cookie=await freshOwner()
 const reloaded=await read(api+'/'+checkout.id+query)
 assert.deepEqual(reloaded.metadata,changed.metadata);assert.deepEqual(reloaded.history,changed.history)
 if(withPinnedClock){const at=Number(end/1000000n)+300001;await withPinnedClock(at,async()=>{const stale=await read(api+query);assert.ok(stale.services.every(s=>s.freshness==='stale'));assert.equal(stale.services.find(s=>s.id===checkout.id).metadata.owner_ref,eligible.id);await servicesBrowser({origin,cookie,path:'/app/services'+query,contains:'Freshness: stale',name:'services-freshness-stale',dispatch:browserDispatch})})}
 await servicesBrowser({origin,cookie:eligibleCookie,path:'/app/services/'+checkout.id+query,contains:'critical',name:'services-responder',dispatch:browserDispatch,follow:true})
 await send('/app/settings/members/change',{operatorId:eligible.id,role:'responder',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}})
 assert.equal((await call(api,{headers:{cookie:eligibleCookie}})).status,401,'scope revocation invalidates the old native session on its next request')
 await denied(api+'/'+checkout.id,{...values,revision:3},401,eligibleCookie)
 eligibleCookie=await signIn(address(8207))
 assert.ok(!(await read(api+query,eligibleCookie)).services.some(s=>s.id===checkout.id),'ownership does not preserve data access after scope revocation')
 await denied(api+'/'+checkout.id,{...values,revision:3},403,eligibleCookie)
 await send('/app/settings/members/remove',{operatorId:restrictedId})
 cookie=await freshOwner()
 await send('/app/settings/members/remove',{operatorId:eligible.id})
 await send('/api/porthole/v1/actors/erase',{actorRef:eligible.id,confirm:'erase'})
 const erased=await read(api+'/'+checkout.id+query)
 assert.equal(erased.names[eligible.id],'Unavailable member');assert.ok(!JSON.stringify(erased).includes('Eligible service owner'),'erased attribution has no retained identity label')
 await denied(api+'/'+checkout.id,{...values,revision:2},409)
 await denied(api+'/'+checkout.id,{...values,revision:3,ownerRef:eligible.id},403)
 assert.equal((await call(api,{headers:{cookie:restricted}})).status,401)
 await servicesBrowser({origin,path:'/app/services',contains:'unauthenticated',name:'services-unauthorized',status:401,dispatch:browserDispatch})
 assert.equal((await call(api+'?budget=3',{headers:{cookie}})).status,400)
 await servicesBrowser({origin,cookie,path:'/app/services?budget=3',contains:'invalid service budget',name:'services-invalid',status:400,dispatch:browserDispatch})
 await send('/app/settings/credentials/revoke',{id:source.credential.id})
 const retainedBefore=await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records')
 assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':proof.packets[0].type},body:proof.packets[0].body})).status,401)
 assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'),retainedBefore,'a revoked source cannot replay more custody')
 if(withEmptyDestination){const {servicesArchiveJourney}=await import('./archive.mjs');await servicesArchiveJourney({origin,freshOwner,withEmptyDestination,id:checkout.id,query,expected:changed.metadata})}
 console.log('PROBE PORT-008 discovery: stock two-team HTTP and Kafka estate -> two scoped services, version and observed dependencies; source server and consumer counters reconciled')
 console.log('PROBE PORT-008 summaries: 36 counted checkout requests, eight errors and eight slow requests -> exact observed counts, rates, endpoint values and p50, p95 and p99 from captured stock spans; client spans excluded')
 console.log('PROBE PORT-008 metadata: native reviewed owner reassignment, Settings edit, reload and restart -> three immutable audited revisions; stale, foreign, bearer and forbidden writes leave metadata unchanged')
 console.log('PROBE PORT-008 authority: restricted and revoked native readers -> hidden services absent and unresolved parent links; metadata grants no access; external runbook remains private')
 console.log('servicesJourney passed '+(analytical?'analytical':'local')+': source counters and stock spans, multi-page bounds, ownership and native browser states')
 return {view,query,checkoutId:checkout.id}
}

export async function servicesBrowser({origin,cookie='',path,contains,name,status=200,dispatch,save=false,follow=false,observed}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  if(cookie)await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  if(dispatch)await context.route(origin+'/**',async route=>{const r=route.request(),response=await dispatch(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:r.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
  const page=await context.newPage(),response=await page.goto(origin+path)
  assert.equal(response.status(),status);assert.ok((await page.locator('body').innerText()).includes(contains))
  if(observed){const body=await page.locator('body').innerText();assert.ok(body.includes(observed.requests+' requests · '+observed.errors+' errors'));for(const name of ['p50','p95','p99'])assert.ok(body.includes(name+' '+(Number(observed[name+'Ns'])/1e6).toFixed(2)+' ms'),'Services shows the independently reconciled '+name);const href=await page.getByRole('link',{name:'Read this snapshot as JSON',exact:true}).getAttribute('href');const linked=await page.goto(origin+href);assert.equal(linked.status(),200);const json=await linked.json();assert.equal(json.summary.requests,observed.requests);assert.equal(json.summary.errors,observed.errors);assert.equal(json.summary.p95Ns,observed.p95Ns);await page.goto(origin+path)}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native Services reflows')
  assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0,'every control has a text label')
  assert.ok(await page.locator('main').evaluate(node=>[...node.querySelectorAll('p,a,button,label,input,select,dt,dd,li')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)),'ordinary text is at least 13px')
  const link=page.getByRole('link',{name:'All services',exact:true});if(await link.count()){await link.focus();assert.ok(await link.evaluate(n=>n===document.activeElement))}
  if(save){
   const stale=await context.newPage();await stale.goto(origin+path)
   await page.getByLabel('Runbook URL').fill('https://restricted.example/runbooks/reviewed');await page.getByLabel('Criticality',{exact:true}).selectOption('critical');await page.getByLabel('I approve these exact values').check()
   await Promise.all([page.waitForURL(origin+'/app/settings/services/'+path.split('/').at(-1).split('?')[0]),page.getByRole('button',{name:'Save reviewed metadata'}).click()])
   assert.match(await page.locator('body').innerText(),/Revision\s+3/)
   await stale.getByLabel('I approve these exact values').check()
   const refusal=stale.waitForResponse(r=>r.request().method()==='POST')
   await stale.getByRole('button',{name:'Save reviewed metadata'}).click()
   assert.equal((await refusal).status(),409);assert.match(await stale.locator('body').innerText(),/service revision changed/)
   if(process.env.PORTHOLE_EVIDENCE_DIR)for(const width of [1440,390]){await stale.setViewportSize({width,height:width===1440?900:844});await stale.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'services-stale-revision-'+width+'.png'),fullPage:true})}
   await stale.close()
  }
  if(follow){
   let requestHeaders
   await context.route('https://restricted.example/**',async route=>{requestHeaders=route.request().headers();await route.fulfill({status:401,body:'Private runbook: authorization required'})})
   await page.getByRole('link',{name:'Open runbook',exact:true}).click();assert.ok((await page.locator('body').innerText()).includes('authorization required'));assert.ok(!requestHeaders.cookie,'native session is never sent to the runbook destination')
   await page.goto(origin+path)
  }
  // Assertions run once at 1440. The same changed state is captured at both
  // widths; 390 is browser evidence, not a second permanent assertion suite.
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?900:844});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,name+'-'+width+'.png'),fullPage:true})}}
  await context.close()
 }finally{await browser.close()}
}
