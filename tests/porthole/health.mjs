import assert from 'node:assert/strict'
import { form } from './fixture.mjs'

/** Public-door recovery with real D1/Worker intake, a real firing monitor and
 * actual unavailable analytical table. Only auth's existing mail-edge fixture
 * provisions a native owner grant. No telemetry/evaluation rows are fabricated. */
export async function recoveryJourney({origin,freshOwner,restartWorker,sql}) {
 let cookie=await freshOwner()
 const get=async path=>{const response=await fetch(origin+path,{headers:{cookie}});assert.equal(response.status,200,path);return response.json()}
 const post=async(path,data,status=200)=>{
  const response=await fetch(origin+path,form(origin,cookie,data));assert.equal(response.status,status,path);return response.json()
 }
 for (const path of ['/api/v1/health/configuration','/api/v1/health/tick']) {
  assert.equal((await fetch(origin+path,form(origin,'',{}))).status,401)
 }
 const health=()=>get('/api/v1/health')
 const component=(state,name)=>state.components.find(row=>row.component===name)
 const monitor=(state,id)=>component(state,'monitor-evaluation').evidence.monitors.find(row=>row.monitorId===id)
 const scope={services:['synthetic-porthole-503'],environments:['synthetic-porthole-504'],teams:['synthetic-porthole-505']}
 const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-501',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
 const secret=credential.secret
 assert.equal(typeof secret,'string')
 const heartbeat={collectorId:'synthetic-porthole-502',team:scope.teams[0],service:scope.services[0],environment:scope.environments[0],signal:'logs'}
 const sendHeartbeat=async(data=heartbeat,expected=200)=>{
  const response=await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(data)})
  assert.equal(response.status,expected);return response.json()
 }
 assert.equal((await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(heartbeat)})).status,401)
 await sendHeartbeat({...heartbeat,service:'synthetic-porthole-506'},403)
 await sendHeartbeat()
 let state=await health()
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:'synthetic-porthole-507@example.com'},400)
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:'synthetic-porthole-507@example.com',confirm:'enable-independent-notices'})
 const eventTime=(BigInt(Date.now())*1000000n+123n).toString()
 const packet={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:scope.environments[0]}},{key:'team',value:{stringValue:scope.teams[0]}}]},scopeLogs:[{logRecords:[{timeUnixNano:eventTime,severityNumber:17,body:{stringValue:'synthetic-porthole-508'}}]}]}]}
 const ingest=async identity=>{
  const response=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','x-porthole-batch-id':identity,'x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':scope.environments[0]},body:JSON.stringify(packet)})
  assert.equal(response.status,200);return response.headers.get('x-porthole-batch')
 }
 await post('/api/porthole/v1/ingest/control',{paused:true})
 const batch=await ingest('synthetic-porthole-509')
 assert.equal(component(await health(),'queue').status,'Unknown')
 await restartWorker()
 cookie=await freshOwner()
 await post('/api/porthole/v1/ingest/control',{paused:false})
 const drain=await post('/api/porthole/v1/ingest/drain',{})
 assert.ok(drain.processedBatches>=1);assert.equal(drain.pendingBatches,0)
 const created=await post('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-510',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:3600}},201)
 await post('/api/porthole/v1/objects/activate',{id:created.id,revision:created.revision,confirm:'activate'})
 await sendHeartbeat()
 const first=await post('/api/v1/health/tick',{})
 assert.equal(first.delivery.status,'development_suppressed')
 const firing=monitor(first.state,created.id)
 assert.equal(firing.status,'Firing');assert.equal(firing.observedCount,1);assert.ok(firing.firingEpisode)
 state=await health()
 const originalAccepted=state.lastAcceptedAt, originalQueryable=state.lastQueryableAt
 const originalKnown=component(state,'query').evidence.lastKnown
 // This is actual backend unavailability, never a synthetic application state.
 await restartWorker(()=>sql('ALTER TABLE porthole_telemetry_records RENAME TO porthole_unavailable_records'))
 try {
  state=await health()
  assert.equal(state.status,'Unknown');assert.equal(component(state,'control-plane').status,'Healthy')
  assert.equal(component(state,'query').status,'Unknown');assert.equal(component(state,'storage').status,'Unknown')
  assert.equal(state.lastAcceptedAt,originalAccepted);assert.equal(state.lastQueryableAt,originalQueryable)
  assert.deepEqual(component(state,'query').evidence.lastKnown,originalKnown)
  const outage=await post('/api/v1/health/tick',{})
  const unknown=monitor(outage.state,created.id)
  assert.equal(unknown.status,'Unknown');assert.equal(unknown.lastKnownCount,1);assert.equal(unknown.firingEpisode,firing.firingEpisode)
  const notices=(await health()).notices
  assert.ok(notices.some(row=>row.component==='query'&&row.phase==='failure'))
  await post('/api/v1/health/tick',{})
  const repeated=(await health()).notices
  assert.equal(new Set(repeated.map(row=>`${row.component}:${row.phase}:${row.id}`)).size,repeated.length)
  assert.equal(repeated.filter(row=>row.component==='query'&&row.phase==='failure').length,1)
 } finally {await restartWorker(()=>sql('ALTER TABLE porthole_unavailable_records RENAME TO porthole_telemetry_records'))}
 await sendHeartbeat()
 await post('/api/porthole/v1/ingest/drain',{})
 const recovered=await post('/api/v1/health/tick',{})
 assert.equal(monitor(recovered.state,created.id).status,'Firing')
 assert.equal(monitor(recovered.state,created.id).firingEpisode,firing.firingEpisode)
 // Replayed envelope and drain preserve original nanoseconds and row identity.
 assert.equal(await ingest('synthetic-porthole-509'),batch)
 await post('/api/porthole/v1/ingest/drain',{})
 const records=await get(`/api/porthole/v1/ingest/records?signal=logs&service=${scope.services[0]}`)
 assert.equal(records.records.length,1);assert.equal(records.records[0].event_time_ns,eventTime.padStart(20,'0'))
 state=await health()
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:10,noticesEnabled:true,recipient:'synthetic-porthole-507@example.com',confirm:'enable-independent-notices'})
 await sendHeartbeat()
 // Elapsed wall time proves stale detection; no timestamps are edited in D1.
 await new Promise(resolve=>setTimeout(resolve,10250))
 state=await health()
 assert.equal(component(state,'collector').status,'Unknown')
 const stale=await post('/api/v1/health/tick',{})
 assert.equal(monitor(stale.state,created.id).status,'Unknown')
 assert.equal(monitor(stale.state,created.id).firingEpisode,firing.firingEpisode)
 await restartWorker();cookie=await freshOwner()
 const resumed=await health()
 assert.ok(resumed.notices.some(row=>row.component==='collector'&&row.phase==='failure'))
 await sendHeartbeat();await post('/api/porthole/v1/ingest/drain',{})
 await post('/api/v1/health/configuration',{revision:resumed.configuration.revision,freshnessSeconds:300,noticesEnabled:false})
 console.log('Recovery public doors passed: durable ingest restart/replay, original event nanoseconds, firing-monitor analytical outage, preserved last-known evidence and firing episode, actual collector staleness, durable independent-notice episodes and local suppression; external mail acceptance remains unproved')
}
