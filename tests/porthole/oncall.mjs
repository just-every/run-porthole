import assert from 'node:assert/strict'
import {recipientMailJourney} from './health.mjs'

/** Official native Oncall ingress shape at the network edge. All intake,
 * authentication, monitor evaluation and durable work use the emitted Worker. */
export async function oncallJourney() {
 const effects=new Map(),requests=[]
 let mode='accepted'
 const key='synthetic-porthole-1200-synthetic-porthole-1200'
 await recipientMailJourney({
  bindings:{ONCALL_ORIGIN:'https://oncall.example.com',ONCALL_SOURCE_KEY:key},
  services:{ONCALL_SERVICE:async request=>{
   assert.equal(request.url,'https://oncall.example.com/api/ingress/synthetic-porthole-1201')
   assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer '+key)
   const event=await request.json();requests.push(event)
   assert.deepEqual(Object.keys(event).sort(),['source','eventId','service','environment','key','generation','intent','severity','title','observedAt','evidence'].sort())
   assert.equal(event.service,'synthetic-porthole-1202');assert.equal(event.environment,'production')
   assert.ok(['trigger','recover'].includes(event.intent));assert.ok(!JSON.stringify(event).includes(key))
   if(mode==='rate')return new Response(null,{status:429,headers:{'retry-after':'1'}})
   if(mode==='denied')return new Response(null,{status:403})
   const previous=effects.get(event.eventId)
   if(previous)assert.deepEqual(previous,event,'native event identity never changes content')
   else effects.set(event.eventId,event)
   if(mode==='lost')return new Response(null,{status:503})
   return Response.json({id:'synthetic-porthole-'+(1300+effects.size),eventId:event.eventId,service:event.service,duplicate:!!previous,observedAt:event.observedAt},{status:previous?200:201})
  }},
  run:async({origin,cookie,call,post,getDb,restart,browser})=>{
   const path='/api/porthole/v1/integrations/oncall'
   const get=async()=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200);return response.json()}
   assert.equal((await call(path)).status,401)
   assert.equal((await call(path,{headers:{authorization:'Bearer '+key}})).status,403)
   assert.equal((await call(path,{method:'POST',headers:{origin:'https://foreign.example.com',cookie,'content-type':'application/json'},body:'{}'})).status,403)
   const scope={services:['synthetic-porthole-1203'],environments:['production'],teams:['synthetic-porthole-1204']}
   const credential=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1205',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)).json()
   const authenticated=async(path,data)=>{const response=await call(path,{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json','x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':'production'},body:JSON.stringify(data)});assert.equal(response.status,200,await response.clone().text());return response}
   const heartbeat=()=>authenticated('/api/v1/health/heartbeat',{collectorId:'synthetic-porthole-1206',team:scope.teams[0],service:scope.services[0],environment:'production',signal:'logs'})
   await heartbeat()
   await authenticated('/v1/logs',{resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team',value:{stringValue:scope.teams[0]}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(Date.now())*1000000n),body:{stringValue:'synthetic-porthole-1207'}}]}]}]})
   await post('/api/porthole/v1/ingest/drain',{})
   const monitor=await (await post('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-1208',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:1}},201)).json()
   await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
   const route={monitorId:monitor.id,source:'synthetic-porthole-1201',destinationService:'synthetic-porthole-1202',confirm:'send-monitor-events'}
   await post(path,{...route,confirm:'no'},400)
   await post(path,route,201)
   // A fresh record in a longer window avoids relying on machine speed.
   const current=await getDb().prepare('SELECT body FROM porthole_objects WHERE id=?').bind(monitor.id).first()
   // Change the definition through its real product door, then approve the new route.
   const revised=await (await post('/api/porthole/v1/objects',{id:monitor.id,revision:monitor.revision,kind:'monitor',name:'synthetic-porthole-1208',scope,body:{...JSON.parse(current.body),windowSeconds:30}},201)).json()
   await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:revised.revision,confirm:'activate'})
   await post(path,route,201)
   let tick=await (await post('/api/v1/health/tick',{})).json()
   assert.equal(tick.monitors.monitors.find(row=>row.monitorId===monitor.id).status,'Firing')
   assert.equal(tick.oncall.status,'accepted');assert.equal(effects.size,1)
   await post('/api/v1/health/tick',{});assert.equal(effects.size,1);assert.equal(requests.length,1)
   const generation=[...effects.values()][0].generation
   await restart();await heartbeat();await post('/api/v1/health/tick',{})
   assert.equal(effects.size,1,'restart preserves one accepted trigger')
   let summary=await get();assert.equal(summary.events.length,1);assert.equal(summary.events[0].state,'accepted')
   assert.ok(summary.events[0].provider_id);assert.ok(!JSON.stringify(summary).includes(key))
   await browser('/app/health','oncall-firing','Active count monitors evaluated against real retained records.')
   // Remove a real backend table. Missing data must preserve the firing generation.
   await getDb().prepare('ALTER TABLE porthole_telemetry_records RENAME TO porthole_unavailable_records').run()
   try{tick=await (await post('/api/v1/health/tick',{})).json();assert.equal(tick.monitors.monitors.find(row=>row.monitorId===monitor.id).status,'Unknown');assert.equal(effects.size,1)}finally{await getDb().prepare('ALTER TABLE porthole_unavailable_records RENAME TO porthole_telemetry_records').run()}
   // Let the original thirty-second event-time window genuinely expire.
   await new Promise(resolve=>setTimeout(resolve,31000))
   await heartbeat();await post('/api/porthole/v1/ingest/drain',{})
   mode='rate';tick=await (await post('/api/v1/health/tick',{})).json()
   assert.equal(tick.monitors.monitors.find(row=>row.monitorId===monitor.id).status,'Healthy')
   assert.equal(tick.oncall.status,'pending');summary=await get()
   const recovery=summary.events.find(event=>event.intent==='recover')
   assert.equal(recovery.generation,generation);assert.ok(recovery.next_attempt_at>Date.now()+500)
   const before=requests.length;await post('/api/v1/health/tick',{});assert.equal(requests.length,before)
   await restart();mode='accepted'
   await new Promise(resolve=>setTimeout(resolve,1100))
   await post('/api/v1/health/tick',{})
   assert.equal(effects.size,2);assert.equal([...effects.values()][1].generation,generation)
   assert.ok(requests.every(event=>['trigger','recover'].includes(event.intent)),'only alert intake events are sent; no incident transition')
   await browser('/app/health','oncall-recovered','Active count monitors evaluated against real retained records.')
   // A new event starts a fresh generation; an uncertain submission stays held.
   await authenticated('/v1/logs',{resourceLogs:[{scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(Date.now())*1000000n),body:{stringValue:'synthetic-porthole-1209'}}]}]}]})
   await post('/api/porthole/v1/ingest/drain',{});await heartbeat();mode='lost'
   tick=await (await post('/api/v1/health/tick',{})).json();assert.equal(tick.oncall.status,'uncertain')
   const uncertain=(await get()).events.find(event=>event.state==='uncertain')
   assert.ok(uncertain);assert.notEqual(uncertain.generation,generation)
   await restart();mode='accepted';const count=requests.length
   await post('/api/v1/health/tick',{});assert.equal(requests.length,count,'uncertain effect is never automatically repeated')
   mode='denied';await post(path,route,201)
   tick=await (await post('/api/v1/health/tick',{})).json();assert.equal(tick.oncall.status,'rejected')
   const deniedCount=requests.length;await post('/api/v1/health/tick',{});assert.equal(requests.length,deniedCount,'revoked provider scope stops automatic sends')
   await post(path,{monitorId:monitor.id,disable:true})
   assert.ok((await get()).routes.every(row=>!row.enabled))
   assert.ok(!JSON.stringify(await get()).includes(key))
   const api='/api/porthole/v1/archive'
   const exported=await (await post(api+'/exports',{},201)).json(),chunks=[]
   for(let index=0;index<exported.totalChunks;index++) {
    const response=await call(`${api}/exports/${exported.id}/chunks/${index}`,{headers:{cookie}})
    assert.equal(response.status,200);chunks.push(await response.json())
   }
   const manifestResponse=await call(`${api}/exports/${exported.id}/manifest`,{headers:{cookie}})
   assert.equal(manifestResponse.status,200);const manifest=await manifestResponse.json()
   const history=chunks.flatMap(chunk=>chunk.rows).filter(row=>row.table==='porthole_archive_health_history'&&row.row.table_name.startsWith('porthole_oncall_'))
   assert.ok(history.some(row=>row.row.table_name==='porthole_oncall_events'))
   assert.ok(!JSON.stringify({manifest,chunks}).includes(key),'portable archive contains no Oncall source key')
   await recipientMailJourney({ownerEmail:'synthetic-porthole-1250@example.com',run:async({post,call,cookie,getDb,restart})=>{
    const restore=await (await post(api+'/restores',{manifest},201)).json()
    for(const chunk of chunks)await post(`${api}/restores/${restore.id}/chunks`,{chunk})
    await post(`${api}/restores/${restore.id}/commit`,{confirm:manifest.rootHash})
    await restart()
    const restored=await call(path,{headers:{cookie}});assert.equal(restored.status,200)
    const summary=await restored.json();assert.deepEqual(summary.routes,[]);assert.deepEqual(summary.events,[])
    const rows=(await getDb().prepare("SELECT table_name,row,state FROM porthole_archive_health_history WHERE table_name LIKE 'porthole_oncall_%' ORDER BY table_name,row_key").all()).results
    assert.equal(rows.length,history.length);assert.ok(rows.every(row=>row.state==='quarantined'))
    assert.deepEqual(rows.map(row=>row.row).sort(),history.map(row=>row.row.row).sort(),'exact handoff history survives inactive independent-owner restore')
    const tick=await (await post('/api/v1/health/tick',{})).json();assert.equal(tick.oncall.attempted,0)
   }})
   console.log('oncallJourney passed: real evaluation, stable generation, replay, restart, Unknown preservation, matching recovery, provider rate limit, uncertainty, revocation and unchanged human incident; 1440 and 390 pipeline screens')
  }
 })
}
