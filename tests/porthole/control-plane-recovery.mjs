import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,symlink,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {analyticalEstate} from './analytics.mjs'
import {emittedWorker,runtimeTransport} from '../emitted-worker.mjs'
import {ownerSigninDigest} from '../../src/modules/operator-auth/owner-signin-grant.mjs'
import {form} from './fixture.mjs'
import {healthBrowser} from './health.mjs'
import {recoveryCollector} from './recovery-collector.mjs'
import {heartbeatTransportFailure} from '../../collectors/heartbeat/process.mjs'

const execute=promisify(execFile),root=process.cwd(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex')
const mailbox=local=>[local,'example.com'].join(String.fromCharCode(64))
async function port(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const result=socket.address().port;await new Promise(resolve=>socket.close(resolve));return result}
const snapshotTables=['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive','porthole_audit_entries','porthole_archive_audit']

/** Actual rer installation commands, emitted control-plane Worker and separate
 * analytical Worker processes. Only native owner proof uses the established
 * owner-signin edge fixture; no session or telemetry row is fabricated. */
export async function controlPlaneRecoveryJourney(){
 const scratch=await mkdtemp(join(tmpdir(),'porthole-control-recovery-')),workers=[],collectors=[],statuses=[]
 let estate,closeTransport,bufferedCollector
 const receipt={journey:'controlPlaneRecoveryJourney',candidate:(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),runtime:'local emitted Workers; no deployment qualification',steps:[]}
 const record=(step,details={})=>{receipt.steps.push({step,...details});console.log(step,JSON.stringify(details))}
 async function clone(name){
  const directory=join(scratch,name)
  await execute('git',['clone','--quiet','--local','--no-hardlinks',root,directory])
  await execute('git',['-C',directory,'checkout','--quiet','--detach',receipt.candidate])
  await execute('git',['-C',directory,'config','user.name','Run Edit Run fleet'])
  await execute('git',['-C',directory,'config','user.email',['fleet','runeditrun.com'].join(String.fromCharCode(64))])
  await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir')
  return directory
 }
 async function native(cwd,args,{refused=false}={}){
  try{const result=await execute(process.execPath,[join(root,'node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--cwd',cwd],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:240000,maxBuffer:16*1024*1024});assert.equal(refused,false,'native command must refuse');return result}
  catch(error){if(refused&&error.code)return;throw Error(`Native ${args[0]} failed: ${String(error.stderr??error.message).replace(/[A-Za-z0-9_+./=-]{32,}/g,'[redacted]').slice(-3000)}`)}
 }
 async function install(directory,email){await native(directory,['setup','--owner-email',email,'--non-interactive']);record('native setup completed')}
 async function launch(directory,email){
  const listener=await port(),origin='http://127.0.0.1:'+listener
  const worker={directory,email,port:listener,origin,cookie:'',mf:null};workers.push(worker)
  const start=async()=>{worker.mf=await emittedWorker({config:join(root,'dist/server/wrangler.json'),persist:join(directory,'.wrangler/state'),port:listener,inspectorPort:0,bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:email,SESSION_SECRET:'synthetic-porthole-8000-synthetic-porthole-8000',SETUP_TOKEN:'synthetic-porthole-8001-synthetic-porthole-8001',...estate.bindings},services:estate.services});await worker.mf.ready;worker.db=await worker.mf.getD1Database('DB')}
  worker.stop=async()=>{await worker.mf?.dispose();worker.mf=null}
  worker.start=start
  worker.call=(path,options)=>fetch(origin+path,options)
  worker.post=async(path,data,status=200,cookie=worker.cookie)=>{const response=await worker.call(path,form(origin,cookie,data));assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()));return response.headers.get('content-type')?.includes('json')?response.json():response}
  worker.read=async(path,cookie=worker.cookie)=>{const response=await worker.call(path,{headers:{cookie}});assert.equal(response.status,200,path+': '+(response.status===200?'':await response.clone().text()));return response.json()}
  worker.prove=async()=>{
   const owner=await worker.db.prepare("SELECT id,version FROM oa_operators WHERE role='owner' AND status='active' AND email=?").bind(email).first();assert.ok(owner,'native setup bootstraps the destination owner')
   const token=randomBytes(32).toString('base64url'),now=Date.now()
   await worker.db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(randomUUID(),await ownerSigninDigest(token),owner.id,owner.version,now,now+120000).run()
   const response=await worker.call('/auth/owner-signin',form(origin,'',{token}));assert.equal(response.status,303)
   worker.cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
   await worker.call('/setup',{method:'POST',redirect:'manual',headers:{origin,cookie:worker.cookie,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes'})
   return owner
  }
  worker.snapshot=async()=>Object.fromEntries(await Promise.all(snapshotTables.map(async table=>[table,(await worker.db.prepare('SELECT * FROM '+table).all()).results])))
  await start();return worker
 }
 async function collector(worker,secret,heartbeat,intervalSeconds=1){
  const child=spawn(process.execPath,[join(root,'tests/porthole/collector-process.mjs')],{stdio:['pipe','pipe','pipe']});collectors.push(child)
  const rows=[];let pending=''
  child.stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{const row=JSON.parse(line);rows.push(row);statuses.push(row)}catch{}}})
  child.stdin.end(JSON.stringify({origin:worker.origin,secret,heartbeat,supervised:true,intervalSeconds}))
  const wait=async predicate=>{for(let i=0;i<700;i++){const row=rows.find(predicate);if(row)return row;assert.equal(child.exitCode,null,'supervised collector stays running');await pause(100)}throw Error('collector_status_timeout')}
  return {child,rows,wait,stop:async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}}}
 }
 const retained=(snapshot,table)=>snapshot[table].map(row=>canonical(row)).sort()
 try{
  // Refused and malformed HTTP edges must not become successful supervision.
  const {createServer:httpServer}=await import('node:http')
  for(const [status,body,expected]of [[401,'{}',3],[200,'{',4],[200,'{}',4]]){
   const edge=httpServer((request,response)=>{request.resume();request.on('end',()=>{response.writeHead(status,{'content-type':'application/json'});response.end(body)})})
   await new Promise(resolve=>edge.listen(0,'127.0.0.1',resolve))
   try{
    const child=spawn(process.execPath,[join(root,'tests/porthole/collector-process.mjs')],{stdio:['pipe','pipe','pipe']})
    let output='';child.stdout.on('data',chunk=>output+=chunk)
    child.stdin.end(JSON.stringify({origin:'http://127.0.0.1:'+edge.address().port,secret:'synthetic-porthole-8102',heartbeat:{collectorId:'synthetic-porthole-8103',team:'commerce-us',service:'checkout-api',environment:'production',signal:'logs'},supervised:true,once:true}))
    const [exit]=await once(child,'close');assert.equal(exit,expected)
    const row=JSON.parse(output);assert.equal(row.exitStatus,expected);assert.equal(row.lastAccepted,null);assert.equal(row.telemetryHealth,'Unknown');statuses.push(row)
   }finally{await new Promise(resolve=>edge.close(resolve))}
  }
  record('supervisor refuses credential and malformed acknowledgements',{credentialExit:3,malformedExit:4})
  estate=await analyticalEstate();closeTransport=runtimeTransport()
  const sourceDirectory=await clone('source'),sourceEmail=mailbox('synthetic-porthole-8002')
  await install(sourceDirectory,sourceEmail)
  const source=await launch(sourceDirectory,sourceEmail),sourceOwner=await source.prove()
  const configuration=await source.read('/api/porthole/v1/analytics/configuration')
  await source.post('/api/porthole/v1/analytics/configuration',{revision:configuration.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
  const scopes=[{services:['checkout-api'],environments:['production'],teams:['commerce-us']},{services:['billing-api'],environments:['production'],teams:['finance-us']}]
  const credentials=[],beats=[],heartbeats=[],packets=[]
  for(const [index,scope]of scopes.entries()){
   const credential=await source.post('/app/settings/credentials/mint',{name:'Recovery collector '+index,class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201);credentials.push(credential)
   const heartbeat={collectorId:'synthetic-porthole-'+(8010+index),team:scope.teams[0],service:scope.services[0],environment:'production',signal:'logs'};heartbeats.push(heartbeat)
   const check=await collector(source,credential.secret,heartbeat,60);beats.push(check);await check.wait(row=>row.status==='heartbeat_accepted')
  }
  const submit=async(worker,credential,index,{identity='synthetic-porthole-'+(8020+index),expected=200}={})=>{
   const response=await worker.call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json','x-porthole-batch-id':identity},body:JSON.stringify(packets[index])});assert.equal(response.status,expected,await response.clone().text());return response
  }
  const packet=(index,scope)=>({resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'team.name',value:{stringValue:scope.teams[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(Date.now())*1000000n+BigInt(8000+index)),severityNumber:17,body:{stringValue:'synthetic-porthole-'+(8030+index)}}]}]}]})
  for(let i=0;i<6;i++){packets[i]=packet(i,scopes[i%2]);await submit(source,credentials[i%2],i)}
  await source.post('/api/porthole/v1/ingest/drain',{})
  const monitor=await source.post('/api/porthole/v1/objects',{kind:'monitor',name:'Recovery errors',scope:scopes[0],body:{signal:'logs',operator:'above',threshold:0,windowSeconds:3600}},201)
  await source.post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
  const repair=await source.post('/api/porthole/v1/objects',{kind:'repair',name:'Reviewed recovery rollback',scope:scopes[0],body:{steps:[{kind:'rollback',target:'checkout-api',revision:'synthetic-porthole-8110'}],expiresAt:Date.now()+3600000}},201)
  await source.post('/api/porthole/v1/approvals',{id:repair.id,revision:repair.revision,confirm:'approve'})
  const noticeConfig=await source.read('/api/v1/health');await source.post('/api/v1/health/configuration',{revision:noticeConfig.configuration.revision,freshnessSeconds:300,noticesEnabled:true,recipient:sourceEmail,confirm:'enable-independent-notices'})
  assert.equal((await source.db.prepare('SELECT COUNT(*) AS n FROM porthole_object_approvals').first()).n,1)
  assert.equal((await source.db.prepare('SELECT COUNT(*) AS n FROM porthole_health_recipients WHERE confirmed_at IS NOT NULL AND removed_at IS NULL').first()).n,1)
  await source.post('/api/v1/health/tick',{})
  const sourceIdentity=(await source.db.prepare('SELECT source_identity FROM porthole_analytical_configuration').first()).source_identity
  bufferedCollector=await recoveryCollector(scratch)
  await bufferedCollector.start(source.origin,credentials[0].secret)
  const before=await source.snapshot(),file=join(sourceDirectory,'exports','installation.rer')
  await native(sourceDirectory,['export','--output',file])
  const archive=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),manifest=archive.find(row=>row.kind==='manifest'),rows=archive.filter(row=>row.kind==='part').flatMap(row=>row.items).filter(row=>row.kind==='row')
  for(const table of snapshotTables){
   const backup=rows.filter(row=>row.table===table).map(row=>canonical(row.row)).sort()
   assert.equal(backup.length,manifest.tables.find(row=>row.name===table).count)
   if(table!=='porthole_audit_entries')assert.deepEqual(backup,retained(before,table),'source reads agree with archive: '+table)
   else for(const row of retained(before,table))assert.ok(backup.includes(row),'backup preserves every source audit entry')
  }
  record('native populated two-team export reconciled',{tables:Object.fromEntries(snapshotTables.map(table=>[table,{count:rows.filter(row=>row.table===table).length,digest:digest(rows.filter(row=>row.table===table).map(row=>row.row).sort((a,b)=>canonical(a).localeCompare(canonical(b))))}]))})
  // Audit chains are verified independently from the export manifest.
  for(const stream of new Set(rows.filter(row=>row.table==='porthole_archive_audit').map(row=>row.row.stream))){let previous='0'.repeat(64);for(const {row}of rows.filter(row=>row.table==='porthole_archive_audit'&&row.row.stream===stream).sort((a,b)=>a.row.sequence-b.row.sequence)){assert.equal(row.previous_hash,previous);assert.equal(createHash('sha256').update(row.entry).digest('hex'),row.hash);previous=row.hash}}
  {let previous='0'.repeat(64);for(const {row}of rows.filter(row=>row.table==='porthole_audit_entries').sort((a,b)=>a.row.sequence-b.row.sequence)){assert.equal(row.previous_hash,previous);assert.equal(createHash('sha256').update(row.entry).digest('hex'),row.hash);previous=row.hash}}
  // This post-export accepted cohort is deliberately absent from the backup.
  for(let i=6;i<8;i++){packets[i]=packet(i,scopes[i%2]);await submit(source,credentials[i%2],i)}
  await source.post('/api/porthole/v1/ingest/drain',{})
  const after=await source.snapshot();assert.equal(after.porthole_telemetry_records.length-before.porthole_telemetry_records.length,2)
  await source.stop()
  for(const beat of beats){const row=await beat.wait(row=>row.status==='control_plane_unreachable');assert.ok(row.lastAccepted);assert.equal(row.telemetryHealth,'Unknown');assert.equal(beat.child.exitCode,null)}
  for(const role of ['primary','standby'])assert.equal((await estate.inspect(role)).length,8,'analytical worker remains live during control-plane outage')
  record('stopped control plane reported outside it',{status:'control_plane_unreachable',lastAcceptedAcknowledgements:beats.map(beat=>beat.rows.find(row=>row.status==='control_plane_unreachable').lastAccepted),analyticalRecords:8})
  // The collector's source buffer retains original payloads until destination
  // authority is explicitly supplied; no source credential crosses the restore.
  assert.equal(bufferedCollector.alive(),true)
  for(let i=8;i<12;i++){packets[i]=packet(i,scopes[i%2]);for(let retry=0;retry<2;retry++){const response=await fetch(bufferedCollector.origin+'/v1/logs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(packets[i])});assert.equal(response.status,200,'stock collector queues the outage payload')}}
  record('stock collector queued outage telemetry',{uniqueRecords:4,queuedSubmissions:8,processRunning:bufferedCollector.alive()})
  for(const role of ['primary','standby'])await estate.rotate(role,'synthetic-porthole-recovery-'+randomBytes(16).toString('hex'))
  const destinationDirectory=await clone('explicit-destination')
  await native(destinationDirectory,['import','--input',file,'--yes'])
  await install(destinationDirectory,mailbox('synthetic-porthole-8003'))
  const destination=await launch(destinationDirectory,mailbox('synthetic-porthole-8003'))
  assert.equal((await destination.db.prepare('SELECT COUNT(*) AS n FROM porthole_credentials').first()).n,0)
  assert.equal((await destination.db.prepare('SELECT COUNT(*) AS n FROM porthole_object_approvals').first()).n,0)
  assert.equal((await destination.db.prepare('SELECT COUNT(*) AS n FROM porthole_health_recipients').first()).n,0)
  assert.equal((await destination.db.prepare('SELECT state FROM porthole_objects WHERE id=?').bind(repair.id).first()).state,'quarantined')
  assert.equal((await destination.db.prepare('SELECT state FROM porthole_objects WHERE id=?').bind(monitor.id).first()).state,'quarantined')
  assert.equal((await destination.call('/api/v1/health',{headers:{cookie:source.cookie}})).status,401)
  await submit(destination,credentials[0],0,{expected:401})
  assert.equal((await destination.db.prepare('SELECT COUNT(*) AS n FROM porthole_ingest_batches').first()).n,6,'source credential refusal changes no retained batches')
  const noProof={mode:'preview',role:'primary',previousIdentity:sourceIdentity}
  // Bootstrap does not grant fresh step-up: a different native sign-in is due.
  // No source session is used to acquire authority; native setup already made
  // a new owner. Obtain its session through the real owner confirmation door.
  const destinationOwner=await destination.prove();assert.notEqual(destinationOwner.id,sourceOwner.id)
  const snapshot=await destination.snapshot()
  for(const table of snapshotTables){const expected=rows.filter(row=>row.table===table).map(row=>canonical(row.row)).sort(),actual=retained(snapshot,table);if(table==='porthole_audit_entries'){for(const row of expected)assert.ok(actual.includes(row),'restored audit prefix preserved')}else assert.deepEqual(actual,expected,'exact restored table '+table)}
  const health=()=>destination.read('/api/v1/health')
  const unknown=async()=>{const state=await health();assert.ok(state.components.every(row=>row.status==='Unknown'),canonical(state.components.map(row=>[row.component,row.status])));return state}
  await unknown()
  await healthBrowser({origin:destination.origin,cookie:destination.cookie,name:'control-recovery-unknown',contains:'Unknown'})
  // Missing proof, bearer precedence and changed review refuse before any
  // worker custody changes. Native owner proof must be renewed explicitly.
  const proofRows=(await destination.db.prepare('SELECT * FROM oa_step_up_challenges').all()).results
  await destination.db.prepare('UPDATE oa_step_up_challenges SET consumed_at=0').run()
  const beforeRefusal=await Promise.all(['primary','standby'].map(role=>estate.inspect(role)))
  await destination.post('/api/porthole/v1/analytics/recovery',noProof,403)
  for(const row of proofRows)await destination.db.prepare('UPDATE oa_step_up_challenges SET consumed_at=? WHERE id=?').bind(row.consumed_at,row.id).run()
  const sourceBearer=await destination.call('/api/porthole/v1/analytics/recovery',{...form(destination.origin,destination.cookie,noProof),headers:{...form(destination.origin,destination.cookie,noProof).headers,authorization:'Bearer '+credentials[0].secret}})
  assert.equal(sourceBearer.status,403,'a source bearer cannot acquire reconnection authority beside a fresh destination owner cookie')
  assert.equal((await sourceBearer.json()).error,'native_session_required')
  assert.deepEqual(await Promise.all(['primary','standby'].map(role=>estate.inspect(role))),beforeRefusal,'missing fresh owner proof changes no analytical custody')
  for(const role of ['primary','standby']){
   const request={mode:'preview',role,previousIdentity:sourceIdentity},physical=await estate.inspect(role)
   const review=await destination.post('/api/porthole/v1/analytics/recovery',request)
   assert.equal(review.retainedBatches,6);assert.equal(review.retainedRecords,6);assert.equal(review.fencedBatches,2);assert.equal(review.fencedRecords,2)
   await destination.post('/api/porthole/v1/analytics/recovery',{...request,mode:'commit',confirmation:'0'.repeat(64)},409)
   assert.deepEqual(await estate.inspect(role),physical,'refused review leaves analytical custody unchanged')
   const committed=await destination.post('/api/porthole/v1/analytics/recovery',{...request,mode:'commit',confirmation:review.confirmation})
   assert.equal(committed.fencedRecords,2)
   assert.deepEqual(await estate.inspect(role),physical,'successful review retains all physical rows')
   assert.deepEqual(await destination.post('/api/porthole/v1/analytics/recovery',{...request,mode:'commit',confirmation:review.confirmation}),committed,'lost acknowledgement retry is inert')
  }
  const erasureBefore=await destination.snapshot(),erasure=await destination.post('/api/porthole/v1/subject-erasure',{identifier:'synthetic-porthole-8030'})
  assert.equal(erasure.records,1)
  const refusedErasure=await destination.post('/api/porthole/v1/subject-erasure/apply',{identifier:'synthetic-porthole-8030',digest:erasure.digest,confirm:'erase-exact-batches'},409)
  assert.equal(refusedErasure.error,'analytical_erasure_not_supported','paused recovered custody retains the existing erasure fence')
  const erasureAfter=await destination.snapshot();for(const table of snapshotTables.filter(name=>!name.includes('audit')))assert.deepEqual(erasureAfter[table],erasureBefore[table],'refused erasure cannot change retained custody')
  record('fresh destination owner reviewed exact analytical custody',{retainedBatches:6,retainedRecords:6,fencedBatches:2,fencedRecords:2,physicalRecords:8})
  const cfg=await destination.read('/api/porthole/v1/analytics/configuration')
  await destination.post('/api/porthole/v1/analytics/configuration',{revision:cfg.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
  const restored=await destination.read('/api/porthole/v1/ingest/records?signal=logs')
  assert.equal(restored.records.length,6);assert.deepEqual(restored.records.map(row=>row.id).sort(),before.porthole_telemetry_records.map(row=>row.id).sort())
  await destination.post('/api/porthole/v1/ingest/control',{paused:false})
  await destination.post('/api/porthole/v1/ingest/drain',{})
  await unknown()
  await destination.stop();await destination.start();await unknown()
  await healthBrowser({origin:destination.origin,cookie:destination.cookie,name:'control-recovery-reconnecting',contains:'reconnecting'})
  const destinationCredentials=[]
  for(const [index,scope]of scopes.entries())destinationCredentials.push(await destination.post('/app/settings/credentials/mint',{name:'Destination recovery '+index,class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201))
  const bufferedCredential=await destination.post('/app/settings/credentials/mint',{name:'Reconnected buffered collector',class:'ingest',scope:{services:scopes.flatMap(row=>row.services),environments:['production'],teams:scopes.flatMap(row=>row.teams),signals:['logs'],actions:['telemetry.write']}},201)
  await bufferedCollector.stop();await bufferedCollector.start(destination.origin,bufferedCredential.secret)
  for(let attempt=0;attempt<100;attempt++){const count=await destination.db.prepare('SELECT COUNT(*) AS n FROM porthole_ingest_batches').first();const duplicates=await destination.db.prepare("SELECT COALESCE(SUM(record_count),0) AS n FROM porthole_ingest_events WHERE source_id=? AND kind='duplicate'").bind(bufferedCredential.credential.id).first();if(count.n===10&&duplicates.n===4)break;await pause(100)}
  await destination.post('/api/porthole/v1/ingest/drain',{})
  await unknown() // Data alone cannot satisfy fresh authenticated heartbeats.
  for(const beat of beats){await beat.stop();assert.equal(beat.child.exitCode,2,'supervisor receives the last outage status when replacing its configuration')}
  for(const [index,credential]of destinationCredentials.entries()){
   const beat=await collector(destination,credential.secret,heartbeats[index]);await beat.wait(row=>row.status==='heartbeat_accepted')
   if(index===0)await unknown()
  }
  const current=await health();assert.equal(current.components.find(row=>row.component==='collector').status,'Healthy')
  assert.equal(current.components.find(row=>row.component==='query').status,'Healthy')
  assert.equal(current.components.find(row=>row.component==='delivery').status,'Unknown','notice authority never revives')
  const final=await destination.read('/api/porthole/v1/ingest/records?signal=logs'),archiveRows=await destination.read('/api/porthole/v1/ingest/archive?signal=logs')
  assert.equal(final.records.length,10);assert.equal(new Set(final.records.map(row=>row.id)).size,10);assert.equal(archiveRows.records.length,10)
  assert.deepEqual(final.records.filter(row=>!before.porthole_telemetry_records.some(old=>old.id===row.id)).map(row=>row.event_time_ns).sort(),packets.slice(8).map(row=>row.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano.padStart(20,'0')).sort())
  const accounting=await destination.read('/api/porthole/v1/ingest/status')
  const delivered=accounting.sources.filter(row=>row.sourceId===bufferedCredential.credential.id)
  assert.equal(delivered.reduce((n,row)=>n+row.accepted,0),4);assert.equal(delivered.reduce((n,row)=>n+row.queryable,0),4);assert.equal(delivered.reduce((n,row)=>n+row.archived,0),4);assert.equal(delivered.reduce((n,row)=>n+row.duplicates,0),4);assert.equal(delivered.reduce((n,row)=>n+row.lost,0),0)
  for(const role of ['primary','standby']){const physical=await estate.inspect(role);assert.equal(physical.length,12,'fresh destination input does not erase fenced physical custody');for(const old of after.porthole_telemetry_records)assert.ok(physical.some(row=>row.id===old.id&&row.event_time_ns===old.event_time_ns))}
  const gap=await destination.read('/api/porthole/v1/analytics/configuration');assert.ok(gap.workers.every(row=>row.recovery.fenced_records===2),'gap remains visible after reconnection and fresh destination sequences')
  await healthBrowser({origin:destination.origin,cookie:destination.cookie,name:'control-recovery-recovered',contains:'Healthy'})
  await healthBrowser({origin:destination.origin,cookie:destination.cookie,path:'/app/settings/analytics',name:'control-recovery-gap',contains:'post-export gap 2 records'})
  record('heartbeat check cleared after reviewed destination reconnection',{status:'heartbeat_accepted',telemetryHealth:'Unknown'})
  await destination.stop()
  const occupiedBefore=await readFile(file)
  await native(destinationDirectory,['import','--input',file,'--yes'],{refused:true})
  assert.deepEqual(await readFile(file),occupiedBefore)
  await destination.start();assert.equal((await destination.snapshot()).porthole_telemetry_records.length,10)
  record('buffered outage input reconciled once',{backupRecords:6,postExportGap:2,bufferedRecords:4,destinationRecords:10,duplicatesAccounted:4,originalNanoseconds:true})
  assert.equal(heartbeatTransportFailure({code:'ENETUNREACH'}),'local_network_unavailable')
  assert.equal(heartbeatTransportFailure({code:'ECONNREFUSED'}),'control_plane_unreachable')
  receipt.originalEventNanoseconds=before.porthole_telemetry_records.map(row=>row.event_time_ns)
  receipt.originalReceiptNanoseconds=before.porthole_telemetry_records.map(row=>JSON.parse(row.payload).delivery.receivedTimeUnixNano)
  receipt.result='passed'
 }catch(error){receipt.result='failed';receipt.failure=String(error.stack??error);throw error}
 finally{
  await bufferedCollector?.stop()
  for(const child of collectors)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit')}
  for(const worker of workers)await worker.stop()
  await estate?.dispose();await closeTransport?.()
  if(process.env.PORTHOLE_EVIDENCE_DIR){await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,'control-plane-recovery.json'),JSON.stringify(receipt,null,2)+'\n');await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,'heartbeat-status.json'),JSON.stringify(statuses,null,2)+'\n')}
  await rm(scratch,{recursive:true,force:true})
 }
 console.log('controlPlaneRecoveryJourney passed: actual native backup and explicit empty restore; independent supervised outage check; exact reviewed retained analytical custody; counted post-export gap; original nanoseconds, inactive grants and once-only buffered delivery')
}
