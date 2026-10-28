import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {cp,mkdtemp,rm,rename} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {stageAnalytics} from '../../scripts/analytical/stage.mjs'

export async function analyticalKernelJourney() {
const execute=promisify(execFile),root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'porthole-analytics-'))
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js'),token='synthetic-porthole-1000',sourceIdentity=randomUUID()
const env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
const servers=[]
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value}
async function start(server){
 server.output=''
 server.child=spawn(process.execPath,[wrangler,'dev','--local','--config',server.config,'--persist-to',server.persist,'--port',String(server.port),'--inspector-port','0','--ip','127.0.0.1','--var',`ANALYTICS_TOKEN:${token}`],{cwd:scratch,env,stdio:['ignore','pipe','pipe']})
 const capture=chunk=>{server.output=(server.output+chunk).slice(-10000)}
 server.child.stdout.on('data',capture);server.child.stderr.on('data',capture)
 for(let i=0;i<120;i++){
  if(server.child.exitCode!==null)throw Error(server.output)
  try{if((await fetch(server.origin+'/health')).ok)return}catch{}
  await pause(250)
 }
 throw Error('Analytical Worker readiness failed')
}
async function stop(server){if(server.child?.exitCode===null){const exited=new Promise(resolve=>server.child.once('exit',resolve));server.child.kill('SIGTERM');await exited}}
const post=(server,path,data,auth=true)=>fetch(server.origin+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)})
async function value(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
try {
 await cp(join(root,'workers/analytics'),join(scratch,'workers/analytics'),{recursive:true,filter:path=>!path.includes('/.staged')&&!path.includes('/.state')})
 for(const product of await stageAnalytics(scratch)){
  const listener=await port(),server={config:join(scratch,product.config),persist:join(scratch,product.role),port:listener,origin:`http://127.0.0.1:${listener}`}
  server.profileMigration=join(scratch,product.productDirectory,'migrations/core/0003_profiles.sql');server.pendingMigration=join(scratch,'profiles-'+product.role+'.sql')
  await rename(server.profileMigration,server.pendingMigration)
  servers.push(server)
  await execute(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',server.config,'--persist-to',server.persist],{cwd:scratch,env})
  await start(server)
 }
 const [primary,standby]=servers,now=Date.now(),scope={services:['checkout'],environments:['production'],teams:['commerce']}
 const batch=sequence=>{
  const id=`synthetic-porthole-${1000+sequence}`,payload={record:{body:{stringValue:`synthetic-porthole-${1010+sequence}`}}}
  return {id,completionSequence:sequence,sourceId:'synthetic-porthole-1020',signal:'logs',digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),acceptedAt:now,completedAt:now+1,records:[{id:id+':0',ordinal:0,team:'commerce',service:'checkout',environment:'production',eventTimeNs:String(BigInt(now)*1000000n+BigInt(sequence)).padStart(20,'0'),traceId:null,spanId:null,payload,indexedAt:now+1,archivedAt:now+7,late:0,outOfOrder:0}]}
 }
 const first=batch(1),second=batch(2),query={sourceIdentity,requiredWatermark:1,signal:'logs',from:'0',through:'18446744073709551615',scope}
 assert.equal((await post(primary,'/v1/query',query,false)).status,401)
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[first]}))
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[first]}))
 let read=await value(await post(primary,'/v1/query',query))
 assert.equal(read.records.length,1);assert.equal(read.records[0].event_time_ns,first.records[0].eventTimeNs);assert.deepEqual(read.records[0].payload,first.records[0].payload)
 const beforeUpgrade=read.records
 for(const server of servers){await stop(server);await rename(server.pendingMigration,server.profileMigration);await execute(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',server.config,'--persist-to',server.persist],{cwd:scratch,env});await start(server)}
 read=await value(await post(primary,'/v1/query',query));assert.deepEqual(read.records,beforeUpgrade,'populated analytical profile migration preserves original rows and sequence coverage')
 const archived=await value(await post(primary,'/v1/query',{...query,archive:true}));assert.equal(archived.records[0].archived_at,now+7);assert.ok(!('indexed_at'in archived.records[0]),'archive receipts are not replaced by indexing receipts')
 const conflict=structuredClone(first);conflict.records[0].payload.record.body.stringValue='synthetic-porthole-1030'
 assert.equal((await post(primary,'/v1/replicate',{sourceIdentity,batches:[conflict]})).status,409)
 assert.equal((await post(primary,'/v1/query',{...query,service:'billing'})).status,403)
 await value(await post(standby,'/v1/replicate',{sourceIdentity,batches:[second]}))
 assert.equal((await post(standby,'/v1/coverage',{sourceIdentity,requiredWatermark:2})).status,409,'a high received sequence cannot hide a missing prefix')
 await value(await post(standby,'/v1/replicate',{sourceIdentity,batches:[first]}))
 assert.equal((await value(await post(standby,'/v1/coverage',{sourceIdentity,requiredWatermark:2}))).watermark,2)
 await stop(primary)
 await assert.rejects(()=>fetch(primary.origin+'/health'))
 read=await value(await post(standby,'/v1/query',{...query,requiredWatermark:2}))
 assert.equal(read.records.length,2,'standby answers while the primary process is actually stopped')
 await start(primary)
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[second,first]}))
 read=await value(await post(primary,'/v1/query',{...query,requiredWatermark:2,snapshot:1}))
 assert.equal(read.records.length,1);assert.equal(read.records[0].id,first.records[0].id)
 const count=await value(await post(primary,'/v1/query',{...query,requiredWatermark:2,mode:'count'}));assert.equal(count.count,2)
 const metrics=[3,4].map((sequence,index)=>{
  const entry=batch(sequence);entry.signal='metrics';entry.records[0].payload={metric:{name:index?'unrelated':'checkout.cpu',unit:'%'},record:{asDouble:index?9999:30}};entry.digest=createHash('sha256').update(JSON.stringify(entry.records[0].payload)).digest('hex');return entry
 })
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:metrics}))
 const metricRead=await value(await post(primary,'/v1/query',{...query,requiredWatermark:4,signal:'metrics',metric:'checkout.cpu'}))
 assert.deepEqual(metricRead.records.map(row=>row.id),[metrics[0].records[0].id]);assert.equal(metricRead.records[0].payload.record.asDouble,30)
 // Analytical transport validates an untrusted plan before consulting coverage.
 const forbidden={version:1,root:{op:'term',field:'service',operator:'eq',value:'billing'}}
 assert.equal((await post(primary,'/v1/query',{...query,requiredWatermark:4,logSearch:forbidden})).status,403)
 for(const root of [{op:'term',field:'payload',operator:'eq',value:'synthetic-porthole-2050'},{op:'term',field:'@http.status_code',operator:'gte',value:'500'},{op:'term',field:'@http.status_code',operator:'eq',value:500,sql:'SELECT 1'}]){
  assert.equal((await post(primary,'/v1/query',{...query,requiredWatermark:999,logSearch:{version:1,root}})).status,400,'a malformed plan refuses before the deliberately unavailable watermark')
 }

 assert.equal((await post(primary,'/v1/query',{...query,requiredWatermark:4,metric:'checkout.cpu'})).status,400)
 console.log('analyticalKernelJourney passed: separate Worker/D1 processes, private auth, exact replication/replay, stale standby refusal, actual process stop and original snapshot recovery; kernel-only probe; product integration is checked separately')
} finally {
 for(const server of servers)await stop(server)
 await rm(scratch,{recursive:true,force:true})
}

}

let estateSequence=0
export async function analyticalEstate() {
 const sequence=++estateSequence
 const execute=promisify(execFile),root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'porthole-connection-')),servers=[]
 const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js'),env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
 let heldQuery=null
 const pauseNextQuery=()=>{
  assert.equal(heldQuery,null);let entered,release
  const gate={entered:new Promise(resolve=>entered=resolve),released:new Promise(resolve=>release=resolve),arrive:()=>entered(),release:()=>{release();if(heldQuery===gate)heldQuery=null}}
  heldQuery=gate;return gate
 }
 async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value}
 async function start(server){server.output='';server.child=spawn(process.execPath,[wrangler,'dev','--local','--config',server.config,'--persist-to',server.persist,'--port',String(server.port),'--inspector-port','0','--ip','127.0.0.1','--var',`ANALYTICS_TOKEN:${server.token}`],{cwd:scratch,env,stdio:['ignore','pipe','pipe']});const record=chunk=>server.output=(server.output+chunk).slice(-5000);server.child.stdout.on('data',record);server.child.stderr.on('data',record);for(let i=0;i<120;i++){if(server.child.exitCode!==null)throw Error('analytical_process_exited');try{if((await fetch(server.origin+'/health')).ok)return}catch{}await pause(250)}throw Error('analytical_process_not_ready')}
 async function stop(server){if(server.child?.exitCode===null){const exited=new Promise(resolve=>server.child.once('exit',resolve));server.child.kill('SIGTERM');await exited}}
 async function dispose(){heldQuery?.release();for(const server of servers)await stop(server);await rm(scratch,{recursive:true,force:true})}
 try{
  await cp(join(root,'workers/analytics'),join(scratch,'workers/analytics'),{recursive:true,filter:path=>!path.includes('/.staged')&&!path.includes('/.state')})
  for(const product of await stageAnalytics(scratch)){
   const listener=await port(),server={role:product.role,config:join(scratch,product.config),persist:join(scratch,product.role),port:listener,origin:'http://127.0.0.1:'+listener,token:'synthetic-porthole-'+(1200+sequence*10+(product.role==='primary'?0:1))};servers.push(server)
   await execute(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',server.config,'--persist-to',server.persist],{cwd:scratch,env});await start(server)
  }
  const find=role=>servers.find(server=>server.role===role)
  const services=Object.fromEntries(servers.map(server=>['ANALYTICS_'+server.role.toUpperCase(),async request=>{
   const path=new URL(request.url).pathname,body=request.method==='POST'?Buffer.from(await request.arrayBuffer()):undefined
   const response=await fetch(server.origin+path,{method:request.method,headers:request.headers,...(body?{body}:{}),redirect:'manual',signal:request.signal})
   // This network edge delays an actual Worker response after its real read.
   // It never substitutes telemetry, storage, authority or query evaluation.
   if(heldQuery&&path==='/v1/query'&&JSON.parse(body).signal==='traces'){const gate=heldQuery;heldQuery=null;gate.arrive();await gate.released}
   if(!response.ok)console.log('Analytical process '+server.role+' '+path+' HTTP '+response.status+' '+String((await response.clone().json()).error));return response
  }]))
  const bindings=Object.fromEntries(servers.map(server=>['ANALYTICS_'+server.role.toUpperCase()+'_TOKEN',server.token]))
  return {bindings,services,pauseNextQuery,stop:role=>stop(find(role)),start:role=>start(find(role)),dispose,origin:role=>find(role).origin}
 }catch(error){await dispose();throw error}
}

export async function analyticalConnectionJourney() {
 await analyticalKernelJourney()
 const estate=await analyticalEstate();let collector
 try {
  const {recipientMailJourney}=await import('./health.mjs')
  await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
   const {origin,call,post,health,messages,ownerEmail,sessionSecret,browser,restart,getDb,cookie}=context
   const send=async(path,data,status=200)=> (await post(path,data,status)).json()
   const read=async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()}
   const config=()=>read('/api/porthole/v1/analytics/configuration'),component=(state,name)=>state.components.find(row=>row.component===name)
   await browser('/app/settings/analytics','analytics-not-connected','Explicit owner connection required')
   assert.equal((await call('/api/porthole/v1/analytics/configuration')).status,401)
   const configure=async(role,expected=200)=>{const current=await config();return send('/api/porthole/v1/analytics/configuration',{revision:current.revision,role,enabled:true,confirm:'connect-analytical-workers'},expected)}
   await configure('primary')
   const scope={services:['checkout-api'],teams:['commerce-us'],environments:['production']}
   const credential=await send('/app/settings/credentials/mint',{name:'Independent analytical collector',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
   const heartbeat={collectorId:'checkout-analytical',service:scope.services[0],team:scope.teams[0],environment:'production',signal:'logs'}
   const beat=async()=>{const response=await call('/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json'},body:JSON.stringify(heartbeat)});assert.equal(response.status,200)}
   const times=[],batchIds=[]
   const ingest=async index=>{
    const time=times[index]??=(BigInt(Date.now())*1000000n+BigInt(index+1200)).toString()
    const packet={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:'checkout-api'}},{key:'team.name',value:{stringValue:'commerce-us'}},{key:'deployment.environment.name',value:{stringValue:'production'}}]},scopeLogs:[{logRecords:[{timeUnixNano:time,body:{stringValue:'Checkout analytical recovery order US-'+(85000+index)},severityNumber:17}]}]}]}
    const response=await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-'+(1220+index)},body:JSON.stringify(packet)})
    assert.equal(response.status,200);const id=response.headers.get('x-porthole-batch');if(batchIds[index])assert.equal(id,batchIds[index]);else batchIds[index]=id
   }
   const mailConfig=await health()
   await send('/api/v1/health/configuration',{revision:mailConfig.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:ownerEmail,confirm:'enable-independent-notices'})
   await beat();await ingest(0);const initialDrain=await send('/api/porthole/v1/ingest/drain',{});assert.equal(initialDrain.analytical.complete,true,JSON.stringify(initialDrain.analytical))
   const monitor=await send('/api/porthole/v1/objects',{kind:'monitor',name:'Checkout analytical errors',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:3600}},201)
   await send('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
   const tick=()=>send('/api/v1/health/tick',{}),evaluation=state=>component(state,'monitor-evaluation').evidence.monitors.find(row=>row.monitorId===monitor.id)
   const first=await tick();assert.equal(evaluation(first.state).status,'Firing',JSON.stringify(first.state.components.map(({component,status,reason})=>({component,status,reason}))));const episode=evaluation(first.state).firingEpisode
   let product=await read('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')
   assert.equal(product.records.length,1);assert.equal(product.analytical.role,'primary');assert.equal(product.analytical.watermark,1)
   const reader=await send('/app/settings/credentials/mint',{name:'Checkout analytical reader',class:'read',scope:{...scope,signals:['logs'],actions:['telemetry.read']}},201)
   const bearer=path=>call(path,{headers:{authorization:'Bearer '+reader.secret}})
   assert.equal((await bearer('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')).status,200)
   assert.equal((await bearer('/api/porthole/v1/ingest/records?signal=logs&service=another-service')).status,403)
   assert.equal((await bearer('/api/porthole/v1/analytics/configuration')).status,403)
   await send('/app/settings/credentials/revoke',{id:reader.credential.id})
   assert.equal((await bearer('/api/porthole/v1/ingest/records?signal=logs')).status,401)
   await browser('/app/settings/analytics','analytics-primary-connected','Caught up')
   // The existing real collector process uses the authenticated control-plane
   // heartbeat door; no collector or analytical response is fabricated.
   collector=spawn(process.execPath,[new URL('./collector-process.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
   collector.stdin.end(JSON.stringify({origin,secret:credential.secret,heartbeat}))
   await new Promise((resolve,reject)=>{collector.stdout.once('data',resolve);collector.once('exit',()=>reject(Error('collector_failed')))})
   const stopped=new Promise(resolve=>collector.once('exit',resolve));collector.kill('SIGTERM');await stopped;collector=null
   const current=await health();await send('/api/v1/health/configuration',{revision:current.configuration.revision,freshnessSeconds:10,noticesEnabled:true,recipient:ownerEmail,confirm:'enable-independent-notices'})
   await estate.stop('primary');await estate.stop('standby')
   await assert.rejects(()=>fetch(estate.origin('primary')+'/health'))
   await new Promise(resolve=>setTimeout(resolve,10250))
   const failed=await tick()
   assert.equal(component(failed.state,'control-plane').status,'Healthy');assert.equal(component(failed.state,'collector').status,'Unknown')
   for(const name of ['storage','query','monitor-evaluation'])assert.equal(component(failed.state,name).status,'Unknown')
   assert.equal(evaluation(failed.state).firingEpisode,episode)
   assert.equal((await call('/api/porthole/v1/ingest/records?signal=logs',{headers:{cookie}})).status,503,'no local analytical fallback during a real process stop')
   assert.ok(component(failed.state,'query').evidence.lastKnown.some(row=>row.eventTimeNs===times[0].padStart(20,'0')))
   for(let i=0;i<12;i++){const response=await tick();if(response.delivery.status==='idle')break}
   const notices=messages.filter(message=>message.custom_args.rer_delivery_id.startsWith('porthole-health/'))
   assert.ok(notices.some(message=>message.content.some(part=>part.value.includes('query'))),'the independent provider edge receives analytical failure notices')
   await browser('/app/health','analytics-process-outage','Unknown')
   await send('/api/porthole/v1/ingest/control',{paused:true});for(let index=1;index<=23;index++)await ingest(index)
   await restart()
   assert.equal((await health()).components.find(row=>row.component==='queue').evidence.pendingBatches,23)
   await send('/api/porthole/v1/ingest/control',{paused:false});await beat()
   let drain=await send('/api/porthole/v1/ingest/drain',{});assert.equal(drain.processedBatches,20);assert.equal(drain.pendingBatches,3)
   drain=await send('/api/porthole/v1/ingest/drain',{});assert.equal(drain.processedBatches,3);assert.equal(drain.pendingBatches,0)
   collector=spawn(process.execPath,[new URL('./collector-process.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
   collector.stdin.end(JSON.stringify({origin,secret:credential.secret,heartbeat}))
   await new Promise((resolve,reject)=>{collector.stdout.once('data',resolve);collector.once('exit',()=>reject(Error('collector_restart_failed')))})
   await estate.start('standby')
   let paused=await config()
   await send('/api/porthole/v1/analytics/configuration',{revision:paused.revision,role:'standby',enabled:false,confirm:'connect-analytical-workers'},409)
   await send('/api/porthole/v1/analytics/configuration',{revision:paused.revision,role:'primary',enabled:false,confirm:'connect-analytical-workers'})
   await configure('standby',409)
   assert.equal((await config()).role,'primary','pausing cannot bypass a behind destination refusal')
   await configure('primary')
   await configure('standby',409)
   assert.equal((await config()).role,'primary','a behind standby never becomes selected')
   await browser('/app/settings/analytics','analytics-standby-behind','Unavailable or behind')
   let reconciliation=await send('/api/porthole/v1/analytics/reconcile',{});assert.equal(reconciliation.complete,false)
   reconciliation=await send('/api/porthole/v1/analytics/reconcile',{});assert.equal(reconciliation.complete,false,'stopped primary keeps replication coverage incomplete')
   await configure('standby')
   product=await read('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')
   assert.equal(product.analytical.role,'standby');assert.equal(product.analytical.watermark,24);assert.equal(product.records.length,24)
   assert.deepEqual(product.records.map(row=>row.event_time_ns).sort(),times.map(time=>time.padStart(20,'0')).sort());assert.equal(new Set(product.records.map(row=>row.id)).size,24)
   await browser('/app/settings/analytics','analytics-standby-selected','selected standby')
   await estate.start('primary');await configure('primary',409)
   await send('/api/porthole/v1/analytics/reconcile',{});await send('/api/porthole/v1/analytics/reconcile',{})
   await configure('primary');await beat()
   const snapshotQuery=await send('/api/porthole/v1/query',{signal:'logs',service:'checkout-api',environment:'production',team:'commerce-us'})
   assert.equal(snapshotQuery.analytical.role,'primary');assert.equal(snapshotQuery.records.length,24)
   assert.deepEqual((await read('/api/porthole/v1/query/'+snapshotQuery.queryRef)).records,snapshotQuery.records)
   product=await read('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')
   assert.equal(product.analytical.role,'primary');assert.equal(product.records.length,24)
   for(let index=0;index<24;index++)await ingest(index)
   await send('/api/porthole/v1/ingest/drain',{});await send('/api/porthole/v1/analytics/reconcile',{})
   assert.equal((await read('/api/porthole/v1/ingest/records?signal=logs&service=checkout-api')).records.length,24)
   const after=await tick();assert.equal(evaluation(after.state).status,'Firing');assert.equal(evaluation(after.state).firingEpisode,episode)
   const ids=messages.filter(message=>message.custom_args.rer_delivery_id.startsWith('porthole-health/')).map(message=>message.custom_args.rer_delivery_id)
   assert.equal(new Set(ids).size,ids.length,'restart, reconciliation and health replay never submit the same notice twice')
   const audit=await read('/api/v1/audit/export');assert.ok(audit.records.some(row=>row.entry.action==='analytics.configure'&&row.entry.phase==='committed'))
   assert.ok(!JSON.stringify(audit).includes(estate.bindings.ANALYTICS_PRIMARY_TOKEN))
   await browser('/app/settings/analytics','analytics-failed-back','selected primary')
   const {hashToken}=await import('../../src/modules/operator-auth/crypto.mjs')
   const owner=await read('/auth/session')
   const invite=async(role,email)=>{
    await send('/app/settings/members/invite',{email,displayName:role==='owner'?'Recovery destination owner':'Recovery administrator',role:role==='owner'?'admin':role,scope:{services:['*'],environments:['*'],teams:['*']}},202)
    const db=getDb(),member=await db.prepare('SELECT id,version FROM oa_operators WHERE email=?').bind(email).first(),token=randomBytes(32).toString('base64url'),now=Date.now()
    await db.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at) VALUES(?,?,'invite',?,?,?,?, '/app',?,?)").bind(randomUUID(),await hashToken(sessionSecret,'link',token),member.id,member.version,owner.operator.id,owner.operator.version,now,now+120000).run()
    let response=await post('/auth/confirm',{token},303,'')
    if(role==='owner'){
     await send('/app/settings/members/change',{operatorId:member.id,role:'owner',confirmEmail:email,scope:{services:['*'],environments:['*'],teams:['*']}})
     const current=await db.prepare('SELECT id,version FROM oa_operators WHERE id=?').bind(member.id).first(),proof=randomBytes(32).toString('base64url'),at=Date.now()
     await db.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) VALUES(?,?,'magic',?,?,'/app',?,?)").bind(randomUUID(),await hashToken(sessionSecret,'link',proof),current.id,current.version,at,at+120000).run()
     response=await post('/auth/confirm',{token:proof},303,'')
    }
    return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
   }
   const adminCookie=await invite('admin','synthetic-porthole-1280@example.com')
   assert.equal((await call('/api/porthole/v1/analytics/configuration',{headers:{cookie:adminCookie}})).status,403)
   await browser('/app/settings/analytics','analytics-admin-forbidden','owner required',adminCookie,403)
   await browser('/app/settings/analytics','analytics-unauthenticated','unauthenticated','',401)
   const nextOwner=await invite('owner','synthetic-porthole-1281@example.com')
   await send('/app/settings/members/change',{operatorId:owner.operator.id,role:'admin',scope:{services:['*'],environments:['*'],teams:['*']}})
   assert.equal((await call('/api/porthole/v1/ingest/records?signal=logs',{headers:{cookie:nextOwner}})).status,503,'demoting the connection configurer suspends the connection before a new read')
   const nextConfig=await (await call('/api/porthole/v1/analytics/configuration',{headers:{cookie:nextOwner}})).json()
   await post('/api/porthole/v1/analytics/configuration',{revision:nextConfig.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'},200,nextOwner)
   assert.equal((await call('/api/porthole/v1/ingest/records?signal=logs',{headers:{cookie:nextOwner}})).status,200,'a current owner explicitly reauthorizes the connection')
   // Every current signal reader, including the new native trace door, uses
   // the selected analytical store. Archive receipts preserve their own time.
   const signalSource=await (await post('/app/settings/credentials/mint',{name:'Analytical signal coverage',class:'ingest',scope:{...scope,signals:['traces','metrics','profiles'],actions:['telemetry.write']}},201,nextOwner)).json()
   const at=(BigInt(Date.now())*1000000n).toString(),traceId='b'.repeat(32),spanId='c'.repeat(16),resource={attributes:[{key:'service.name',value:{stringValue:'checkout-api'}},{key:'team.name',value:{stringValue:'commerce-us'}},{key:'deployment.environment.name',value:{stringValue:'production'}}]}
   for(const [signal,packet]of [['traces',{resourceSpans:[{resource,scopeSpans:[{spans:[{traceId,spanId,name:'synthetic-porthole-1290',kind:2,startTimeUnixNano:at,endTimeUnixNano:(BigInt(at)+1234n).toString()}]}]}]}],['metrics',{resourceMetrics:[{resource,scopeMetrics:[{metrics:[{name:'synthetic_porthole_1291',gauge:{dataPoints:[{timeUnixNano:at,asDouble:7}]}}]}]}]}]]){
    const response=await call('/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+signalSource.secret,'content-type':'application/json'},body:JSON.stringify(packet)});assert.equal(response.status,200)
   }
   await post('/api/porthole/v1/ingest/drain',{},200,nextOwner)
   const trace=await (await call('/api/porthole/v1/traces/'+traceId,{headers:{cookie:nextOwner}})).json();assert.equal(trace.status,'Connected');assert.equal(trace.spans[0].startTimeNs,at)
   await browser('/app/traces/'+traceId,'analytics-native-trace','Connected',nextOwner)
   const metric=await (await post('/api/porthole/v1/query',{signal:'metrics',service:'checkout-api'},200,nextOwner)).json();assert.equal(metric.analytical.role,'primary');assert.equal(metric.records.length,1)
   const {profileBatch}=await import('./ingest.mjs'),profilePacket=profileBatch(BigInt(at));profilePacket.resourceProfiles[0].resource=resource
   const profileResponse=await call('/v1/profiles',{method:'POST',headers:{authorization:'Bearer '+signalSource.secret,'content-type':'application/json'},body:JSON.stringify(profilePacket)});assert.equal(profileResponse.status,200)
   await post('/api/porthole/v1/ingest/drain',{},200,nextOwner)
   const profileRead=await (await post('/api/porthole/v1/query',{signal:'profiles',service:'checkout-api'},200,nextOwner)).json();assert.equal(profileRead.analytical.role,'primary');assert.equal(profileRead.records.length,1);assert.deepEqual(profileRead.records[0].payload.dictionary,profilePacket.dictionary);assert.equal(profileRead.records[0].event_time_ns,at.padStart(20,'0'))
   const archived=await (await call('/api/porthole/v1/ingest/archive?signal=logs',{headers:{cookie:nextOwner}})).json()
   const receipts=(await getDb().prepare("SELECT id,archived_at FROM porthole_telemetry_archive WHERE signal='logs'").all()).results
   assert.deepEqual(archived.records.map(row=>[row.id,row.archived_at]).sort(),receipts.map(row=>[row.id,row.archived_at]).sort());assert.ok(archived.records.every(row=>!('indexed_at'in row)))
   const {analyticalArchiveSnapshot,restoreAnalyticalSnapshot}=await import('./archive.mjs')
   const saved=await analyticalArchiveSnapshot({context,cookie:nextOwner}),destination=await analyticalEstate()
   try {
    assert.equal((await fetch(destination.origin('primary')+'/v1/health',{headers:{authorization:'Bearer '+estate.bindings.ANALYTICS_PRIMARY_TOKEN}})).status,401,'a source installation connection token cannot read a separately selected destination')
    await recipientMailJourney({bindings:destination.bindings,services:destination.services,ownerEmail:'synthetic-porthole-1282@example.com',run:async restored=>{
     const inactive=await restoreAnalyticalSnapshot({context:restored,saved,times})
     const original=(await getDb().prepare('SELECT source_identity FROM porthole_analytical_configuration').first()).source_identity
     assert.notEqual(inactive.source_identity,original,'restored destination has a new installation identity')
     const configure=async(path,data)=>(await restored.post(path,data)).json()
     await configure('/api/porthole/v1/analytics/configuration',{revision:inactive.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
     await configure('/api/porthole/v1/analytics/reconcile',{});await configure('/api/porthole/v1/analytics/reconcile',{})
     const result=await (await restored.call('/api/porthole/v1/ingest/records?signal=logs',{headers:{cookie:restored.cookie}})).json()
     assert.equal(result.records.length,24);assert.equal(result.analytical.role,'primary')
     assert.equal((await restored.health()).status,'Unknown','reauthorizing historical storage cannot fabricate fresh collector/data coverage')
     await restored.browser('/app/settings/analytics','analytics-inactive-destination','Connection authorized')
    }})
   } finally {await destination.dispose()}
   const {nativeLogSearchJourney}=await import('./explore.mjs')
   const signIn=async email=>{
    const db=getDb(),member=await db.prepare('SELECT id,version FROM oa_operators WHERE email=?').bind(email).first(),issuer=await (await call('/auth/session',{headers:{cookie:nextOwner}})).json(),token=randomBytes(32).toString('base64url'),at=Date.now()
    await db.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at) VALUES(?,?,'invite',?,?,?,?, '/app',?,?)").bind(randomUUID(),await hashToken(sessionSecret,'link',token),member.id,member.version,issuer.operator.id,issuer.operator.version,at,at+120000).run()
    const response=await post('/auth/confirm',{token},303,'')
    return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
   }
   await nativeLogSearchJourney({origin,cookie:nextOwner,call,backend:'analytical',pauseNextQuery:estate.pauseNextQuery,signIn})
   const candidate=(await promisify(execFile)('git',['rev-parse','HEAD'])).stdout.trim()
   console.log('PORTHOLE_ANALYTICAL_RUN '+JSON.stringify({runId:'sx-porthole-c7-recovery-20261022',head:candidate,result:'passed'}))
   console.log('analyticalConnectionJourney passed: real independent primary/standby processes, product query/health/monitor, collector outage and direct provider-edge notice, behind refusal, explicit failover/failback, bounded 20/3 backlog, original ns and no duplicate records/notices')
  }})
 }finally{if(collector?.exitCode===null&&collector.signalCode===null){const stopped=new Promise(resolve=>collector.once('exit',resolve));collector.kill('SIGTERM');await stopped}await estate.dispose()}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await analyticalKernelJourney()
