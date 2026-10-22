import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'

/** Production-mode emitted Worker, real intake/monitor/health/outbox. Only the
 * SendGrid HTTP edge is replaced by recipientMailJourney's documented fixture.
 * SQL is used solely to interrupt/restore the analytical read path. */
export async function durableRecoveryJourney({origin,call,post,read,health,messages,ownerEmail,sql,restart,browser}) {
 const component=(state,name)=>state.components.find(row=>row.component===name)
 const send=async(path,data)=> (await post(path,data)).json()
 const configure=async freshnessSeconds=>send('/api/v1/health/configuration',{
  revision:(await health()).configuration.revision,freshnessSeconds,noticesEnabled:true,recipient:ownerEmail,confirm:'enable-independent-notices'})
 const scope={services:['checkout-api'],teams:['commerce-us'],environments:['production']}
 const credential=await (await post('/app/settings/credentials/mint',{name:'Checkout recovery collector',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)).json()
 const collector=spawn(process.execPath,[new URL('./collector-process.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
 collector.stdin.end(JSON.stringify({origin,secret:credential.secret,heartbeat:{collectorId:'checkout-us-east',service:scope.services[0],team:scope.teams[0],environment:'production',signal:'logs'}}))
 const stopCollector=async()=>{if(collector.exitCode===null&&collector.signalCode===null){const exited=once(collector,'exit');collector.kill('SIGTERM');await exited}}
 try {
 await Promise.race([once(collector.stdout,'data'),once(collector,'exit').then(()=>{throw Error('collector_start_failed')})])
 const heartbeat=async()=>{
  const response=await call('/api/v1/health/heartbeat',{method:'POST',headers:{authorization:`Bearer ${credential.secret}`,'content-type':'application/json'},body:JSON.stringify({collectorId:'checkout-us-east',service:scope.services[0],team:scope.teams[0],environment:'production',signal:'logs'})})
  assert.equal(response.status,200)
 }
 const times=[],batches=[]
 const ingest=async i=>{
  const time=times[i]??=(BigInt(Date.now())*1000000n+BigInt(i+123)).toString()
  const resource={attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'team',value:{stringValue:scope.teams[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}}]}
  const body={resourceLogs:[{resource,scopeLogs:[{logRecords:[{timeUnixNano:time,severityNumber:17,body:{stringValue:`Checkout payment authorization delayed, order US-${84001+i}`}}]}]}]}
  const response=await call('/v1/logs',{method:'POST',headers:{authorization:`Bearer ${credential.secret}`,'content-type':'application/json','x-porthole-batch-id':`synthetic-porthole-${970+i}`,'x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':'production'},body:JSON.stringify(body)})
  assert.equal(response.status,200);const id=response.headers.get('x-porthole-batch')
  if(batches[i])assert.equal(id,batches[i]);else batches[i]=id
 }
 await configure(60)
 await heartbeat();await ingest(0)
 await send('/api/porthole/v1/ingest/drain',{})
 const created=await (await post('/api/porthole/v1/objects',{kind:'monitor',name:'Checkout payment errors',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:3600}},201)).json()
 await send('/api/porthole/v1/objects/activate',{id:created.id,revision:created.revision,confirm:'activate'})
 const evaluation=state=>component(state,'monitor-evaluation').evidence.monitors.find(row=>row.monitorId===created.id)
 const initial=await send('/api/v1/health/tick',{})
 assert.equal(evaluation(initial.state).status,'Firing')
 const episode=evaluation(initial.state).firingEpisode
 const messageStart=messages.length
 const notices=()=>messages.slice(messageStart).filter(row=>row.custom_args.rer_delivery_id.startsWith('porthole-health/'))
 await configure(10);await heartbeat();await stopCollector()
 await new Promise(resolve=>setTimeout(resolve,10250))
 const stopped=await send('/api/v1/health/tick',{})
 assert.equal(component(stopped.state,'collector').status,'Unknown')
 assert.equal(evaluation(stopped.state).status,'Unknown');assert.equal(evaluation(stopped.state).firingEpisode,episode)
 assert.equal(stopped.delivery.status,'accepted')
 for(let i=0;i<16;i++) {
  const result=await send('/api/v1/health/tick',{})
  if(result.delivery.status==='idle')break
  assert.equal(result.delivery.status,'accepted')
 }
 const collectorFailure=(await health()).notices.find(row=>row.component==='collector'&&row.phase==='failure'&&row.state==='accepted')
 assert.ok(collectorFailure,'stopped collector independently notifies the mail provider')
 await browser('health-collector-stopped')
 // Resume the collector separately before failing the analytical read path.
 await configure(60)
 await heartbeat();await send('/api/porthole/v1/ingest/drain',{})
 await send('/api/v1/health/tick',{})
 const before=await health(),lastKnown=component(before,'query').evidence.lastKnown
 await sql('ALTER TABLE porthole_telemetry_records RENAME TO porthole_recovery_unavailable;')
 try {
  const failed=await send('/api/v1/health/tick',{})
  assert.equal(component(failed.state,'control-plane').status,'Healthy')
  for(const name of ['storage','query','monitor-evaluation'])assert.equal(component(failed.state,name).status,'Unknown')
  assert.equal(failed.state.lastAcceptedAt,before.lastAcceptedAt);assert.equal(failed.state.lastQueryableAt,before.lastQueryableAt)
  assert.deepEqual(component(failed.state,'query').evidence.lastKnown,lastKnown)
  assert.equal(evaluation(failed.state).lastKnownCount,1);assert.equal(evaluation(failed.state).firingEpisode,episode)
  await browser('health-analytical-read-failed')
  await send('/api/porthole/v1/ingest/control',{paused:true})
  for(let i=1;i<=23;i++)await ingest(i)
  const queued=await health()
  assert.equal(component(queued,'queue').evidence.pendingBatches,23)
  const pending=queued.notices.filter(row=>row.state==='pending')
  assert.ok(pending.length>0,'notice work is pending alongside accepted ingest')
  await browser('health-pending-recovery')
  await restart()
  const resumed=await health()
  assert.equal(component(resumed,'queue').evidence.pendingBatches,23)
  assert.deepEqual(resumed.notices.filter(row=>pending.some(old=>old.id===row.id)),pending,'restart preserves exact pending notice identities and attempts')
  assert.deepEqual(component(resumed,'query').evidence.lastKnown,lastKnown)
 } finally {await sql('ALTER TABLE porthole_recovery_unavailable RENAME TO porthole_telemetry_records;')}
 await heartbeat()
 await send('/api/porthole/v1/ingest/control',{paused:false})
 await sql("CREATE TRIGGER synthetic_porthole_recovery_fail BEFORE INSERT ON porthole_telemetry_archive BEGIN SELECT RAISE(ABORT,'synthetic-porthole-999'); END;")
 try {
  await post('/api/porthole/v1/ingest/drain',{},503)
  const failed=await health()
  assert.equal(component(failed,'queue').status,'Unknown','manual drain failure invalidates an earlier successful worker receipt immediately')
  assert.equal(component(failed,'queue').evidence.pendingBatches,23)
  const observed=component(failed,'queue').observedAt
  assert.equal(component(await health(),'queue').observedAt,observed,'reading health never refreshes the drain worker receipt')
  await browser('health-drain-failed')
 } finally {await sql('DROP TRIGGER synthetic_porthole_recovery_fail;')}
 const first=await send('/api/porthole/v1/ingest/drain',{})
 assert.equal(first.processedBatches,20);assert.equal(first.pendingBatches,3,'one pass cannot drain an unbounded backlog')
 const second=await send('/api/porthole/v1/ingest/drain',{})
 assert.equal(second.processedBatches,3);assert.equal(second.pendingBatches,0)
 for(let i=0;i<24;i++)await ingest(i)
 await send('/api/porthole/v1/ingest/drain',{})
 const records=await read('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')
 assert.equal(records.records.length,24)
 assert.equal(new Set(records.records.map(row=>row.id)).size,24)
 assert.deepEqual(records.records.map(row=>row.event_time_ns).sort(),times.map(time=>time.padStart(20,'0')).sort())
 // Drain notices through the same owner action, bounded to one submission/tick.
 for(let i=0;i<32;i++) {
  const count=notices().length,result=await send('/api/v1/health/tick',{})
  assert.ok(notices().length-count<=1)
  assert.equal(evaluation(result.state).status,'Firing');assert.equal(evaluation(result.state).observedCount,24)
  assert.equal(evaluation(result.state).firingEpisode,episode)
  if(result.delivery.status==='idle')break
  assert.equal(result.delivery.status,'accepted')
 }
 const final=await health()
 for(const name of ['control-plane','collector','ingest','queue','storage','query','monitor-evaluation','delivery'])assert.equal(component(final,name).status,'Healthy',name)
 assert.ok(!final.notices.some(row=>row.state==='pending'||row.state==='sending'))
 for(const name of ['collector','query']) {
  const failure=final.notices.find(row=>row.component===name&&row.phase==='failure'&&row.state==='accepted')
  assert.ok(failure,`${name} independent failure submission accepted`)
  assert.ok(notices().some(row=>row.custom_args.rer_delivery_id===`porthole-health/${failure.id}`))
 }
 await browser('health-recovered')
 const accepted=notices().map(row=>row.custom_args.rer_delivery_id)
 assert.equal(new Set(accepted).size,accepted.length)
 await restart();await heartbeat();await send('/api/v1/health/tick',{})
 assert.deepEqual(notices().map(row=>row.custom_args.rer_delivery_id),accepted,'accepted notices never resubmit across restart')
 console.log('durableRecoveryJourney passed: firing monitor, separate collector/read outages, independent provider submissions, restart with pending ingest/notices, bounded reconciliation, original nanoseconds, exact records and no duplicate notice submission')
 } finally {await stopCollector()}
}
