import assert from 'node:assert/strict'
import {form} from './fixture.mjs'
import {healthBrowser} from './health.mjs'

const root='/api/porthole/v1/monitors',objects='/api/porthole/v1/objects'
const scope={services:['synthetic-porthole-2300','synthetic-porthole-2301'],environments:['synthetic-porthole-2302'],teams:['synthetic-porthole-2303']}
const body={signal:'logs',operator:'above',threshold:2,windowSeconds:60,windows:[60,120],pendingSeconds:30,recoveryThreshold:1,groupBy:['service','environment','team'],noDataPolicy:'unknown'}
const ns=at=>String(BigInt(at)*1000000n)
async function value(response,status=200) {
 assert.equal(response.status,status,`monitor HTTP ${status}: ${response.status===status?'':await response.clone().text()}`)
 assert.equal(response.headers.get('cache-control'),'no-store')
 return response.json()
}
function transport({origin,cookie,call=(path,init)=>fetch(origin+path,init)}) {
 return {call,get:(path,acting=cookie)=>call(path,{headers:{cookie:acting}}),post:(path,data,status=200,acting=cookie)=>call(path,form(origin,acting,data)).then(response=>value(response,status))}
}
function group(result,service,status,counts) {
 const matches=result.groups.filter(row=>row.labels.service===service&&row.labels.environment===scope.environments[0]&&row.labels.team===scope.teams[0])
 assert.equal(matches.length,1,'one independently measured service group')
 const found=matches[0]
 assert.deepEqual(found.labels,{service,environment:scope.environments[0],team:scope.teams[0]})
 assert.equal(found.status,status);assert.equal(found.count,counts[0]);assert.equal(found.completeness,'measured')
 assert.deepEqual(found.windows.map(row=>({seconds:row.windowSeconds,count:row.count,completeness:row.completeness})),[
  {seconds:60,count:counts[0],completeness:'measured'},
  {seconds:120,count:counts[1],completeness:'measured'},
 ])
 return found
}
function intake({call,post},credential,selection=scope) {
 let sequence=2310,lastCapture
 const headers=(service,id)=>({authorization:'Bearer '+credential.secret,'content-type':'application/json',...(id?{'x-porthole-batch-id':id}:{}),'x-porthole-team':selection.teams[0],'x-porthole-service':service,'x-porthole-environment':selection.environments[0]})
 const resource=service=>({attributes:[{key:'service.name',value:{stringValue:service}},{key:'deployment.environment.name',value:{stringValue:selection.environments[0]}},{key:'team',value:{stringValue:selection.teams[0]}}]})
 const heartbeat=async(signal='logs')=>{
  for(const service of selection.services)await value(await call('/api/v1/health/heartbeat',{method:'POST',headers:headers(service),body:JSON.stringify({collectorId:'synthetic-porthole-2304',service,environment:selection.environments[0],team:selection.teams[0],signal})}))
 }
 const logs=async(service,times)=>{
  const logRecords=times.map(at=>({timeUnixNano:ns(at),severityNumber:17,body:{stringValue:'synthetic-porthole-2305'}}))
  const packet={resourceLogs:[{resource:resource(service),scopeLogs:[{logRecords}]}]}
  lastCapture={method:'POST',headers:headers(service,'synthetic-porthole-'+sequence++),body:JSON.stringify(packet)}
  const response=await call('/v1/logs',lastCapture)
  assert.equal(response.status,200,await response.clone().text());await post('/api/porthole/v1/ingest/drain',{})
 }
 const traces=async(at)=>{
  const spans=[1,2].map(i=>({traceId:i.toString(16).padStart(32,'0'),spanId:i.toString(16).padStart(16,'0'),name:'synthetic-porthole-2306',startTimeUnixNano:ns(at),endTimeUnixNano:ns(at+1),kind:2,status:{code:0}}))
  const packet={resourceSpans:[{resource:resource(selection.services[0]),scopeSpans:[{spans}]}]}
  const response=await call('/v1/traces',{method:'POST',headers:headers(selection.services[0],'synthetic-porthole-'+sequence++),body:JSON.stringify(packet)})
  assert.equal(response.status,200,await response.clone().text());await post('/api/porthole/v1/ingest/drain',{})
 }
 return {heartbeat,logs,traces,replay:async()=>assert.equal((await call('/v1/logs',lastCapture)).status,401)}
}
async function create(post,{name='synthetic-porthole-2307',definition=body,selection=scope}={}) {
 const monitor=await post(objects,{kind:'monitor',name,scope:selection,body:definition},201)
 assert.equal(monitor.state,'inactive')
 await post(objects+'/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
 return monitor
}
async function seedCounts(source,t) {
 await source.heartbeat()
 // Independent literal counts: A=4 recent+2 old, B=1 recent+2 old.
 await source.logs(scope.services[0],[t-10000,t-9999,t-9998,t-9997,t-80000,t-79999])
 await source.logs(scope.services[1],[t-10000,t-80000,t-79999])
}
const browserDispatch=call=>call?((url,init)=>call(new URL(url).pathname+new URL(url).search,init)):undefined

/** Real OTLP and authenticated collector coverage through the public API.
 * freshOwner and signIn substitute only the existing native mail and grant edge.
 * The harness pins Worker time; no telemetry or monitor rows are fabricated.
 */
export async function deterministicMonitorJourney({origin,freshOwner,signIn,restartWorker,withPinnedClock,withEmptyDestination,sql,call,backend='native'}) {
 let cookie=await freshOwner(),http=transport({origin,cookie,call})
 const refresh=async()=>{cookie=await freshOwner();http=transport({origin,cookie,call})}
 const post=(...args)=>http.post(...args),get=(...args)=>http.get(...args)
 const evaluate=(monitor,status=200,acting=cookie)=>post(root+'/evaluate',{id:monitor.id,revision:monitor.revision},status,acting)
 const read=async id=>value(await get(root+'?id='+encodeURIComponent(id)))
 for(const path of [root,'/app/monitors','/app/settings/monitors'])assert.equal((await get(path,'')).status,401)
 await post(root+'/evaluate',{},401,'')
 const health=await value(await get('/api/v1/health'))
 await post('/api/v1/health/configuration',{revision:health.configuration.revision,freshnessSeconds:300,noticesEnabled:false})
 const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2308',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}},201)
 await post(objects,{kind:'monitor',name:'synthetic-porthole-2309',scope,body:{...body,windows:[0,120]}},400)
 const source=intake({call:http.call,post},credential),t=Date.now()
 let monitor,pendingAt,episode
 await withPinnedClock(t,async()=>{
  await seedCounts(source,t);monitor=await create(post)
  const first=await evaluate(monitor)
  assert.equal(first.status,'Pending');assert.equal(first.observedCount,5)
  pendingAt=group(first,scope.services[0],'Pending',[4,6]).pendingSince
  assert.equal(pendingAt,t);group(first,scope.services[1],'Healthy',[1,3]);assert.equal(first.firingEpisode,null)
 })
 await restartWorker();await refresh()
 await withPinnedClock(t+29000,async()=>{
  await source.heartbeat()
  const pending=await evaluate(monitor)
  assert.equal(pending.status,'Pending');assert.equal(group(pending,scope.services[0],'Pending',[4,6]).pendingSince,pendingAt)
  group(pending,scope.services[1],'Healthy',[1,3])
 })
 await withPinnedClock(t+30000,async()=>{
  await source.heartbeat()
  const firing=await evaluate(monitor)
  assert.equal(firing.status,'Firing');episode=firing.firingEpisode;assert.ok(episode)
  group(firing,scope.services[0],'Firing',[4,6]);group(firing,scope.services[1],'Healthy',[1,3])
  const state=await read(monitor.id)
  assert.equal(state.details[monitor.id].revision,monitor.revision);assert.equal(state.details[monitor.id].state,'Firing')
  await monitorScreens({origin,cookie,call,monitor,definition:body})
  await independentDimensions(http,t+20000)
 })
 await withPinnedClock(t+61000,async()=>{
  await source.heartbeat()
  const held=await evaluate(monitor)
  assert.equal(held.status,'Firing');assert.equal(held.firingEpisode,episode)
  group(held,scope.services[0],'Firing',[0,4]);group(held,scope.services[1],'Healthy',[0,1])
 })
 await withPinnedClock(t+111000,async()=>{
  await source.heartbeat()
  const recovered=await evaluate(monitor)
  assert.equal(recovered.status,'Healthy');assert.equal(recovered.observedCount,0);assert.equal(recovered.firingEpisode,null)
  group(recovered,scope.services[0],'Healthy',[0,0]);group(recovered,scope.services[1],'Healthy',[0,0])
  const absent=await create(post,{name:'synthetic-porthole-2340',selection:{...scope,services:['synthetic-porthole-2341']},definition:{...body,pendingSeconds:0}})
  const missing=await evaluate(absent)
  assert.equal(missing.status,'Unknown');assert.equal(missing.observedCount,null)
  assert.equal(missing.lastKnownCount,null,'no heartbeat has ever established a measured empty window')
  assert.ok(missing.groups.length>0);assert.ok(missing.groups.every(row=>row.completeness==='absent'))
  const noDataAlert=await create(post,{name:'synthetic-porthole-2344',selection:{...scope,services:['synthetic-porthole-2341']},definition:{...body,pendingSeconds:0,noDataPolicy:'alert'}})
  const alert=await evaluate(noDataAlert)
  assert.equal(alert.status,'Firing');assert.equal(alert.observedCount,null);assert.ok(alert.firingEpisode)
  assert.ok(alert.groups.length>0);assert.ok(alert.groups.every(row=>row.status==='NoData'&&row.completeness==='absent'&&row.count===null))
  const noDataKeep=await create(post,{name:'synthetic-porthole-2345',selection:{...scope,services:['synthetic-porthole-2341']},definition:{...body,pendingSeconds:0,noDataPolicy:'keep-last'}})
  const kept=await evaluate(noDataKeep)
  assert.equal(kept.status,'Unknown');assert.equal(kept.observedCount,null);assert.equal(kept.lastKnownCount,null)
  await healthBrowser({origin,cookie,dispatch:browserDispatch(call),name:'monitor-recovered',path:'/app/monitors?view=triggered',exercise:async page=>{
   assert.equal(await page.getByRole('link',{name:'synthetic-porthole-2307',exact:true}).count(),0,'measured recovery leaves the triggered view')
   assert.equal(await page.getByRole('link',{name:'synthetic-porthole-2344',exact:true}).count(),1,'an explicit no-data alert remains distinguishable from measured recovery')
  }})
  await source.heartbeat('traces');await source.traces(t+110000)
  const traceMonitor=await create(post,{name:'synthetic-porthole-2342',selection:{...scope,services:[scope.services[0]]},definition:{signal:'traces',operator:'above',threshold:1,windowSeconds:60}})
  const trace=await evaluate(traceMonitor)
  assert.equal(trace.status,'Firing');assert.equal(trace.observedCount,2)
 })
 await withPinnedClock(t+112000,async()=>{
  await source.heartbeat();await source.logs(scope.services[0],[t+112000,t+112000,t+112000,t+112000])
  assert.equal((await evaluate(monitor)).status,'Pending')
 })
 await withPinnedClock(t+142000,async()=>{
  await source.heartbeat()
  const recurrence=await evaluate(monitor)
  assert.equal(recurrence.status,'Firing');assert.equal(recurrence.observedCount,4)
  assert.ok(recurrence.firingEpisode);assert.notEqual(recurrence.firingEpisode,episode)
  await post('/app/settings/credentials/revoke',{id:credential.credential.id})
  await source.replay()
  const lost=await evaluate(monitor)
  assert.equal(lost.status,'Unknown');assert.equal(lost.observedCount,null)
  assert.equal(lost.lastKnownCount,4);assert.equal(lost.firingEpisode,recurrence.firingEpisode)
  assert.ok(lost.groups.every(row=>row.completeness==='source-loss'),'revoked collection never establishes recovery')
  const lostService=lost.groups.find(row=>row.labels.service===scope.services[0])
  assert.equal(lostService.count,null);assert.equal(lostService.lastKnownCount,4)
  await healthBrowser({origin,cookie,dispatch:browserDispatch(call),name:'monitor-source-loss',path:'/app/monitors?id='+monitor.id,exercise:async page=>{
   assert.equal(await page.locator('article strong').innerText(),'Unknown')
  }})
 })
 await post(root+'/state',{id:monitor.id,revision:monitor.revision,state:'inactive',confirm:'inactive'})
 await evaluate(monitor,409)
 const disabled=(await read(monitor.id)).details[monitor.id]
 assert.equal(disabled.state,'Unknown');assert.ok(disabled.history.length>0,'disable retains evaluation history')
 await post(root+'/state',{id:monitor.id,revision:monitor.revision,state:'active',confirm:'active'})
 // Reuse an existing synthetic fixture member, preserving their assignment.
 const members=await value(await get('/auth/operators'))
 const member=members.find(row=>row.productRole==='admin'&&row.status==='active')
 assert.ok(member,'runtime must supply its existing synthetic checkout administrator')
 try {
  await post('/app/settings/members/change',{operatorId:member.id,role:'maintainer',scope})
  const authorized=await signIn(member.email)
  assert.equal((await http.call(root+'/evaluate',form(origin,authorized,{id:monitor.id,revision:monitor.revision}))).status,200)
  await post('/app/settings/members/change',{operatorId:member.id,role:'maintainer',scope:{...scope,services:['synthetic-porthole-2343']}})
  assert.equal((await http.call(root+'/evaluate',form(origin,authorized,{id:monitor.id,revision:monitor.revision}))).status,401,'scope change revokes the old session on the next request')
  const narrowed=await signIn(member.email)
  await evaluate(monitor,403,narrowed)
  assert.ok(!(await value(await get(root,narrowed))).objects.some(row=>row.id===monitor.id))
  await healthBrowser({origin,cookie:narrowed,dispatch:browserDispatch(call),name:'monitor-outside-scope',path:'/app/monitors?id='+monitor.id,expectedStatus:403})
 } finally {await post('/app/settings/members/change',{operatorId:member.id,role:member.productRole,scope:member.scope})}
 const updated=await post(objects,{id:monitor.id,revision:monitor.revision,kind:'monitor',name:'synthetic-porthole-2307',scope,body:{...body,threshold:3}},201)
 assert.equal(updated.state,'inactive');await evaluate(monitor,409)
 await post(objects+'/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'},409)
 const versions=(await read(monitor.id)).revisions.filter(row=>row.id===monitor.id)
 assert.equal(versions.length,2)
 assert.deepEqual(versions.find(row=>row.revision===monitor.revision).body,body,'editing retains the exact earlier definition')
 if(withEmptyDestination)await monitorArchive({origin,cookie,call,withEmptyDestination,monitor:updated})
 await refresh()
 const preview=await post('/api/porthole/v1/subject-erasure',{identifier:'synthetic-porthole-2305'})
 assert.ok(preview.records>0);assert.equal(preview.canApply,true)
 await post('/api/porthole/v1/subject-erasure/apply',{identifier:'synthetic-porthole-2305',digest:preview.digest,confirm:'erase-exact-batches'})
 const erased=await read(monitor.id)
 assert.deepEqual(erased.details[monitor.id].history,[],'erased derived evaluations are no longer exposed')
 assert.equal(erased.details[monitor.id].count,null)
 await source.replay()
 console.log('Deterministic monitor journey passed: grouped windows, durable pending, hysteresis, measured zero, absent coverage, traces, source and member revocation, stale revisions, responsive forms, inactive restore ('+backend+').')
}

async function monitorScreens({origin,cookie,call,monitor,definition}) {
 await healthBrowser({origin,cookie,dispatch:browserDispatch(call),name:'monitor-firing',path:'/app/monitors?id='+monitor.id,exercise:async page=>{
  assert.equal(await page.locator('article strong').innerText(),'Firing')
  const history=page.locator('article details');await history.locator('summary').click();assert.ok(await history.locator('li').count()>0)
 }})
 await healthBrowser({origin,cookie,dispatch:browserDispatch(call),name:'monitor-triggered',path:'/app/monitors?view=triggered',exercise:async page=>{
  assert.equal(await page.getByRole('link',{name:'synthetic-porthole-2307',exact:true}).count(),1)
 }})
 await healthBrowser({origin,cookie,dispatch:browserDispatch(call),name:'monitor-configuration',path:'/app/settings/monitors?id='+monitor.id,exercise:async(page,width)=>{
  const edit=page.locator('form[action="/app/settings/monitors/save"]')
  for(const [name,expected]of Object.entries({signal:'logs',operator:'above',threshold:'2',windowSeconds:'60',windows:'60,120',pendingSeconds:'30',recoveryThreshold:'1',groupBy:'service,environment,team',noDataPolicy:'unknown'}))assert.equal(await edit.locator('[name="'+name+'"]').inputValue(),expected)
  await page.goto(origin+'/app/settings/monitors')
  const createForm=page.locator('form[action="/app/settings/monitors/save"]')
  for(const [name,text]of Object.entries({name:'synthetic-porthole-'+(2350+width),service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],threshold:'2',windowSeconds:'60',windows:'60,120',pendingSeconds:'30',recoveryThreshold:'1',groupBy:'service,environment,team'}))await createForm.locator('[name="'+name+'"]').fill(text)
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/app/settings/monitors/save'&&response.request().method()==='POST')
  await createForm.getByRole('button').click();assert.equal((await saved).status(),303);await page.waitForLoadState('networkidle')
  const created=await value(await (call?call(root,{headers:{cookie}}):fetch(origin+root,{headers:{cookie}})))
  const row=created.objects.find(row=>row.name==='synthetic-porthole-'+(2350+width))
  assert.ok(row);assert.equal(row.state,'inactive');assert.deepEqual(row.body,definition)
 }})
}

async function independentDimensions(http,t) {
 const selection={services:[scope.services[0]],environments:['synthetic-porthole-2370'],teams:['synthetic-porthole-2371']}
 const credential=await http.post('/app/settings/credentials/mint',{name:'synthetic-porthole-2372',class:'ingest',scope:{...selection,signals:['logs'],actions:['telemetry.write']}},201)
 const source=intake(http,credential,selection);await source.heartbeat();await source.logs(selection.services[0],[t,t+1])
 const monitor=await create(http.post,{name:'synthetic-porthole-2373',selection:{...scope,environments:[...scope.environments,...selection.environments],teams:[...scope.teams,...selection.teams]},definition:{...body,pendingSeconds:0}})
 const result=await http.post(root+'/evaluate',{id:monitor.id,revision:monitor.revision})
 assert.equal(result.groups.length,3,'same service stays separate across environment and team')
 const isolated=result.groups.find(row=>row.labels.environment===selection.environments[0])
 assert.deepEqual(isolated.labels,{service:selection.services[0],environment:selection.environments[0],team:selection.teams[0]})
 assert.deepEqual(isolated.windows.map(row=>row.count),[2,2]);assert.equal(isolated.status,'Healthy')
 group(result,scope.services[0],'Firing',[4,6]);group(result,scope.services[1],'Healthy',[1,3])
}

/** Separate analytical Worker fixture: actual OTLP and exact group and window
 * counts, without depending on its control-plane clock or browser listener. */
export async function countMonitorBackendJourney({origin,cookie,call}) {
 const http=transport({origin,cookie,call}),{post}=http
 const health=await value(await http.get('/api/v1/health'))
 await post('/api/v1/health/configuration',{revision:health.configuration.revision,freshnessSeconds:300,noticesEnabled:false})
 const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2360',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
 const source=intake(http,credential);await seedCounts(source,Date.now())
 const monitor=await create(post,{name:'synthetic-porthole-2361',definition:{...body,pendingSeconds:0}})
 const result=await post(root+'/evaluate',{id:monitor.id,revision:monitor.revision})
 assert.equal(result.status,'Firing');assert.equal(result.observedCount,5);assert.equal(result.groups.length,2)
 group(result,scope.services[0],'Firing',[4,6]);group(result,scope.services[1],'Healthy',[1,3])
 await independentDimensions(http,Date.now()-1000)
 return {monitor,result}
}

async function monitorArchive({origin,cookie,call,withEmptyDestination,monitor}) {
 const api='/api/porthole/v1/archive',http=transport({origin,cookie,call})
 const job=await http.post(api+'/exports',{},201),chunks=[]
 for(let i=0;i<job.totalChunks;i++)chunks.push(await value(await http.get(api+'/exports/'+job.id+'/chunks/'+i)))
 const manifest=await value(await http.get(api+'/exports/'+job.id+'/manifest'))
 await withEmptyDestination(async destination=>{
  const owner=await destination.freshOwner(),target=transport({origin:destination.origin,cookie:owner,call:destination.call})
  const restore=await target.post(api+'/restores',{manifest},201)
  for(const chunk of chunks)await target.post(api+'/restores/'+restore.id+'/chunks',{chunk})
  await target.post(api+'/restores/'+restore.id+'/commit',{confirm:manifest.rootHash})
  const restored=await value(await target.get(root+'?id='+monitor.id))
  assert.equal(restored.objects.find(row=>row.id===monitor.id).state,'quarantined')
  await target.post(root+'/evaluate',{id:monitor.id,revision:monitor.revision},409)
  await healthBrowser({origin:destination.origin,cookie:owner,name:'monitor-restored',path:'/app/monitors?id='+monitor.id,exercise:async page=>{
   assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('article strong').innerText(),'Unknown')
  }})
 })
}
