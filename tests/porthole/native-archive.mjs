import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {fixture,literal} from './fixture.mjs'
import {promisify} from 'node:util'
import {mkdtemp,symlink,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
const execute=promisify(execFile)
const address=local=>[local,'example.com'].join(String.fromCharCode(64))
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'porthole-native-archive-'))
async function command(cwd,args) {
 try {return await execute(process.execPath,[join(root,'node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--cwd',cwd],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:16*1024*1024})}
 catch(error){const capture=await readFile(join(cwd,'.seed/installer/install.log'),'utf8').catch(()=> '');const redact=value=>String(value??'').replace(/[A-Za-z0-9_+./=-]{32,}/g,'[redacted]');throw Error(`Native ${args[0]} failed (${error.code})\n${redact(error.stderr).slice(-6000)}\n${redact(error.stdout).slice(-3000)}\n${redact(capture).split('\n').slice(-16).join('\n')}`)}
}
async function clone(name) {
 const directory=join(scratch,name)
 await execute('git',['clone','--quiet','--local','--no-hardlinks',root,directory])
 await execute('git',['-C',directory,'config','user.name','Run Edit Run fleet'])
 await execute('git',['-C',directory,'config','user.email',['fleet','runeditrun.com'].join(String.fromCharCode(64))])
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir')
 return directory
}
async function sql(cwd,statement) {
 const result=await execute(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','foundation','--local','--persist-to',join(cwd,'.wrangler/state'),'--config',join(cwd,'wrangler.jsonc'),'--json','--command',statement],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024})
 return JSON.parse(result.stdout).flatMap(value=>value.results??[])
}

/** One native CLI and HTTP journey: frozen custody, exact owner consent,
 * scoped history preservation and an independently owned native restore. */
async function nativeBackupErasureJourney(source) {
 const socket=createServer()
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve))
 const port=socket.address().port
 await new Promise(resolve=>socket.close(resolve))
 const origin='http://127.0.0.1:'+port,ownerEmail=['synthetic-porthole-600','example.com'].join(String.fromCharCode(64))
 let worker,output='',cookie
 async function stop() {
  if(!worker)return
  worker.kill('SIGTERM')
  await new Promise(resolve=>worker.exitCode!==null?resolve():worker.once('exit',resolve))
  worker=null
 }
 async function start() {
  output=''
  worker=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--persist-to',join(source,'.wrangler/state'),'--config',join(root,'dist/server/wrangler.json'),'--ip','127.0.0.1','--port',String(port),'--var','AUTH_ORIGIN:'+origin,'--var','AUTH_LOCAL:true','--var','OWNER_EMAIL:'+ownerEmail,'--var','SESSION_SECRET:synthetic-porthole-native-erasure-session-secret','--var','MAIL_PROVIDER:development'],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']})
  worker.stdout.on('data',part=>{output+=part});worker.stderr.on('data',part=>{output+=part})
  for(let attempt=0;attempt<120;attempt++){
   if(worker.exitCode!==null)throw Error('Native erasure Worker exited: '+output.slice(-2000))
   try{if((await fetch(origin+'/health')).ok)return}catch{}
   await new Promise(resolve=>setTimeout(resolve,250))
  }
  throw Error('Native erasure Worker did not start')
 }
 async function restartWorker(change){await stop();if(change)await change();await start()}
 const helpers=fixture({origin,sql:statement=>sql(source,statement),restartWorker,sessionSecret:'synthetic-porthole-native-erasure-session-secret',ownerEmail})
 const value=async(response,status=200)=>{
  response=await response
  assert.equal(response.status,status,await response.clone().text())
  return response.json()
 }
 const send=(path,data,acting=cookie)=>fetch(origin+path,{method:'POST',redirect:'manual',headers:{origin,cookie:acting,'content-type':'application/json'},body:JSON.stringify(data)})
 const query=signal=>value(send('/api/porthole/v1/query',{signal,service:'synthetic-porthole-9701',limit:200}))
 const erasure='/api/porthole/v1/subject-erasure',archive='/api/porthole/v1/archive'
 const scope={services:['synthetic-porthole-9701'],environments:['production'],teams:['synthetic-porthole-9702']}
 const identifier='synthetic-porthole-9703',peer='synthetic-porthole-9704'
 const attributes=Object.entries({'service.name':scope.services[0],'deployment.environment.name':scope.environments[0],team:scope.teams[0]}).map(([key,stringValue])=>({key,value:{stringValue}}))
 const time=BigInt(Date.now())*1000000n
 const logs=(subject,offset)=>({resourceLogs:[{resource:{attributes},scopeLogs:[{logRecords:[{timeUnixNano:String(time+BigInt(offset)),severityNumber:17,body:{stringValue:subject}}]}]}]})
 let credential
 const intake=(signal,body)=>fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json'},body:JSON.stringify(body)})
 const snapshot=async()=>({
  batches:await sql(source,'SELECT id,records,wire_base64,record_count FROM porthole_ingest_batches ORDER BY id'),
  hot:await sql(source,'SELECT id,payload FROM porthole_telemetry_records ORDER BY id'),
  cold:await sql(source,'SELECT id,payload FROM porthole_telemetry_archive ORDER BY id'),
  custody:await sql(source,'SELECT job_id,ordinal,payload FROM porthole_archive_rows ORDER BY job_id,ordinal'),
  chunks:await sql(source,'SELECT job_id,chunk_index,packet FROM porthole_archive_chunks ORDER BY job_id,chunk_index'),
  history:await sql(source,'SELECT * FROM porthole_monitor_evaluations ORDER BY id'),
 })
 try {
  await start();cookie=await helpers.freshOwner()
  await fetch(origin+'/setup',{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes'})})
  credential=await value(send('/app/settings/credentials/mint',{name:'synthetic-porthole-9705',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}}),201)
  const targetBatches=[]
  for(const offset of [0,1]) {
   const response=await intake('logs',logs(identifier,offset))
   await value(response);targetBatches.push(response.headers.get('x-porthole-batch'))
  }
  const peerResponse=await intake('logs',logs(peer,2));await value(peerResponse)
  const peerBatch=peerResponse.headers.get('x-porthole-batch')
  const trace={resourceSpans:[{resource:{attributes},scopeSpans:[{spans:[{traceId:'97000000000000000000000000000001',spanId:'9700000000000001',name:'synthetic-porthole-9706',kind:2,startTimeUnixNano:String(time),endTimeUnixNano:String(time+1000000n),status:{code:1}}]}]}]}
  await value(await intake('traces',trace));await value(send('/api/porthole/v1/ingest/drain',{}))
  const monitors={}
  for(const signal of ['logs','traces']){
   const monitor=await value(send('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-9707-'+signal,scope,body:{signal,operator:'above',threshold:0,windowSeconds:3600}}),201)
   await value(send('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'}))
   await value(await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-9708',team:scope.teams[0],service:scope.services[0],environment:scope.environments[0],signal})}))
   monitors[signal]=monitor.id
  }
  await value(send('/api/v1/health/tick',{}))
  const traceHistory=await sql(source,"SELECT * FROM porthole_monitor_evaluations WHERE object_id="+literal(monitors.traces))
  assert.equal(traceHistory.length,1,'one real trace evaluation exists before backup')
  const traceState=await sql(source,"SELECT * FROM porthole_monitor_state WHERE object_id="+literal(monitors.traces))
  const peerRows=await sql(source,'SELECT * FROM porthole_telemetry_records WHERE batch_id='+literal(peerBatch))
  assert.equal(peerRows.length,1,'the unrelated subject exists before erasure')
  assert.equal((await query('logs')).records.length,3)
  assert.equal((await query('traces')).records.length,1)
  // Prepare a real Settings export too, including cached download packets.
  const frozen=await value(send(archive+'/exports',{}),201)
  for(let index=0;index<frozen.totalChunks;index++)await value(await fetch(origin+archive+'/exports/'+frozen.id+'/chunks/'+index,{headers:{cookie}}))
  await value(await fetch(origin+archive+'/exports/'+frozen.id+'/manifest',{headers:{cookie}}))
  assert.ok(JSON.stringify((await snapshot()).custody).includes(identifier),'backup custody contains the subject before erasure')
  await stop()
  const beforeFile=join(source,'exports','before-erasure.rer')
  await command(source,['export','--output',beforeFile])
  assert.ok((await readFile(beforeFile,'utf8')).includes(identifier),'native backup contains the ingested subject')
  await start();cookie=await helpers.freshOwner()
  const preview=await value(send(erasure,{identifier}))
  assert.deepEqual(preview.batches.map(row=>row.id).sort(),targetBatches.sort(),'preview identifies every matching batch')
  const beforeRefusal=await snapshot()
  await value(send(erasure+'/apply',{identifier,digest:preview.digest,confirm:'wrong'}),409)
  assert.deepEqual(await snapshot(),beforeRefusal,'unconfirmed erasure changes no custody or history')
  await value(send(erasure+'/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'},''),401)
  const delegated=await fetch(origin+erasure+'/apply',{method:'POST',headers:{origin,authorization:'Bearer '+credential.secret,'content-type':'application/json'},body:JSON.stringify({identifier,digest:preview.digest,confirm:'erase-exact-batches'})})
  await value(delegated,403)
  assert.deepEqual(await snapshot(),beforeRefusal,'a credential cannot erase backed-up custody')
  const erased=await value(send(erasure+'/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'}))
  assert.equal(erased.erasedBatches,2,'backup then erase completes without history_immutable')
  assert.equal(erased.erasedRecords,2)
  assert.deepEqual(erased.batchIds.sort(),targetBatches)
  const after=await snapshot()
  assert.ok(!JSON.stringify(after).includes(identifier),'live and backed-up custody contain no erased subject')
  const skeletons=after.batches.filter(row=>targetBatches.includes(row.id))
  assert.equal(skeletons.length,2);assert.ok(skeletons.every(row=>row.records==='[]'&&row.wire_base64===''&&row.record_count===0))
  assert.deepEqual(await sql(source,'SELECT * FROM porthole_telemetry_records WHERE batch_id='+literal(peerBatch)),peerRows,'the unrelated subject stays one unchanged record')
  assert.deepEqual(await sql(source,'SELECT * FROM porthole_monitor_evaluations WHERE object_id='+literal(monitors.traces)),traceHistory,'trace history stays one unchanged entry')
  assert.deepEqual(await sql(source,'SELECT * FROM porthole_monitor_state WHERE object_id='+literal(monitors.traces)),traceState,'log erasure leaves unrelated trace-monitor evidence unchanged')
  assert.equal((await sql(source,'SELECT status FROM porthole_monitor_state WHERE object_id='+literal(monitors.logs)))[0].status,'Unknown','a monitor of erased logs cannot present its old count as current evidence')
  assert.equal((await fetch(origin+archive+'/exports/'+frozen.id+'/manifest',{headers:{cookie}})).status,404,'old product custody is withdrawn')
  assert.equal((await query('logs')).records.length,1)
  assert.ok(JSON.stringify((await query('logs')).records).includes(peer))
  assert.equal((await query('traces')).records.length,1)
  assert.equal((await intake('logs',logs(identifier,0))).status,409,'replayed original capture cannot resurrect erased data')
  await value(send('/app/settings/credentials/revoke',{id:credential.credential.id}))
  assert.equal((await intake('logs',logs(identifier,3))).status,401,'a revoked ingest credential cannot restore erased data')
  await restartWorker();cookie=await helpers.freshOwner()
  assert.equal((await query('logs')).records.length,1,'erasure survives restart')
  if(process.env.PORTHOLE_EVIDENCE_DIR) {
   const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises')
   const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM?{executablePath:process.env.PORTHOLE_CHROMIUM}:{}),args:['--no-sandbox']})
   try {
    await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
    for(const width of [1440,390]){
     const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
     await context.addCookies(cookie.split('; ').map(item=>{const index=item.indexOf('=');return{name:item.slice(0,index),value:item.slice(index+1),url:origin}}))
     const page=await context.newPage()
     await page.goto(origin+'/app/explore?'+new URLSearchParams({signal:'logs',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0]}))
     await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'native-backup-erased-'+width+'.png'),fullPage:true})
     await context.close()
    }
   } finally {await browser.close()}
  }
  await stop()
  const afterFile=join(source,'exports','after-erasure.rer')
  await command(source,['export','--output',afterFile])
  const portable=await readFile(afterFile,'utf8')
  assert.ok(!portable.includes(identifier),'a subsequent native export contains no erased subject')
  assert.ok(portable.includes(peer),'native export retains the unrelated subject')
  const destination=await clone('erasure-destination')
  await command(destination,['import','--input',afterFile,'--yes'])
  const restored=await sql(destination,'SELECT records,wire_base64 FROM porthole_ingest_batches ORDER BY id')
  assert.ok(!JSON.stringify(restored).includes(identifier))
  assert.equal(restored.filter(row=>row.records.includes(peer)).length,1,'native restore retains exactly one unrelated subject batch')
  assert.deepEqual(await sql(destination,'SELECT * FROM porthole_telemetry_records WHERE batch_id='+literal(peerBatch)),peerRows)
  assert.deepEqual(await sql(destination,'SELECT * FROM porthole_monitor_evaluations WHERE object_id='+literal(monitors.traces)),traceHistory)
  assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_erased_batches'))[0].n,2,'native restore retains the nonresurrection journal')
  const reexport=join(destination,'exports','restored-erasure.rer')
  await command(destination,['export','--output',reexport])
  assert.ok(!(await readFile(reexport,'utf8')).includes(identifier),'native restore and re-export contain no trace of erased subject')
  console.log('nativeBackupErasureJourney passed: actual native backup, owner-only exact erasure of every matching batch and frozen custody, unchanged unrelated subject and trace history, capture and revoked-credential refusal, restart and native restore with no erased subject')
 } finally {await stop()}
}

try {
 const source=await clone('source')
 await command(source,['setup','--owner-email',address('synthetic-porthole-600'),'--non-interactive'])
 console.log('nativeArchiveJourney: source setup passed')
 if(process.env.PORTHOLE_NATIVE_ERASURE_ONLY==='1')await nativeBackupErasureJourney(source)
 else {
 const owner=(await sql(source,"SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0]
 assert.ok(owner)
 const credentialId=randomUUID(),secret=`synthetic-porthole-601-${randomBytes(32).toString('hex')}`,hash=createHash('sha256').update(secret).digest('hex'),now=Date.now(),objectId=randomUUID()
 const scope=JSON.stringify({services:['checkout'],environments:['production'],teams:['commerce'],signals:['logs'],actions:['telemetry.read']})
 // Source-state fixture, not minting evidence: the separate HTTP credential
 // journey proves minting. This command qualifies native archive exclusion.
 await sql(source,`INSERT INTO porthole_credentials(id,name,class,custodian_id,secret_hash,prefix,last_four,scope,created_at,expires_at,requests_per_minute,accepted_bytes_per_minute,scanned_bytes_per_day,usd_micros_per_day) VALUES('${credentialId}','synthetic-porthole-601','read','${owner.id}','${hash}','${secret.slice(0,7)}','${secret.slice(-4)}','${scope}',${now},${now+3600000},600,1048576,1048576,1000000); INSERT INTO porthole_objects VALUES('${objectId}','monitor','synthetic-porthole-602','{"services":["checkout"],"environments":["production"],"teams":["commerce"]}','{"signal":"logs","operator":"above","threshold":2,"windowSeconds":60}',1,'active',${now},${now});`)
 const taskId=randomUUID(),taskEvent=randomUUID()
 await sql(source,`INSERT INTO porthole_follow_up(id,source,kind,scope,owner_id,state,reason,next_action,due_at,reminders,created_at,updated_at) VALUES('${taskId}','synthetic-porthole-1600','telemetry','{"services":["checkout"],"environments":["production"],"teams":["commerce"]}','${owner.id}','blocked','synthetic-porthole-1601','synthetic-porthole-1602',${now},1,${now},${now}); INSERT INTO porthole_follow_up_events VALUES('${taskEvent}','${taskId}',1,'review','${owner.id}','synthetic-porthole-1603',${now});`)
 const exportId=randomUUID()
 await sql(source,`INSERT INTO porthole_signal_exports(id,owner_ref,owner_revision,created_at,state,selection,snapshot,estimate,credential_ref) VALUES('${exportId}','${owner.id}',1,${now},'approved','{}',0,'{}','${credentialId}')`)
 await sql(source,`UPDATE porthole_baggage_policy SET enabled=1,allowed_keys='["region"]',attribute_keys='[]',revision=2,changed_at=${now} WHERE singleton=1`)
 const file=join(source,'exports','installation.rer')
 await command(source,['export','--output',file])
 console.log('nativeArchiveJourney: source export passed')
 const contents=await readFile(file,'utf8')
 for(const privateValue of [secret,hash,address('synthetic-porthole-600')])assert.ok(!contents.includes(privateValue),'native export excludes credential/hash/native identity')
 const sourceAudit=await sql(source,"SELECT entry FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.export.complete'")
 assert.equal(sourceAudit.length,1,'native export result is in private audit')
 const destination=await clone('destination')
 await command(destination,['import','--input',file,'--yes'])
 console.log('nativeArchiveJourney: destination import passed')
 assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
 for(const table of ['porthole_follow_up','porthole_follow_up_events'])assert.equal((await sql(destination,`SELECT COUNT(*) AS n FROM ${table}`))[0].n,0,'native restore never revives follow-up assignments or reminders')
 for(const [table,id]of [['porthole_follow_up',taskId],['porthole_follow_up_events',taskEvent]]){const retained=await sql(destination,`SELECT row,state FROM porthole_archive_health_history WHERE table_name='${table}' AND json_extract(row,'$.id')='${id}'`);assert.ok(retained.length);assert.ok(retained.every(row=>row.state==='quarantined'))}
 assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_signal_exports'))[0].n,0,'signal export approvals never revive at the destination')
 assert.equal((await sql(destination,`SELECT state FROM porthole_objects WHERE id='${objectId}'`))[0].state,'quarantined')
 assert.equal((await sql(destination,'SELECT paused FROM porthole_ingest_control'))[0].paused,1)
 assert.deepEqual((await sql(destination,'SELECT enabled,allowed_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'["region"]'},'native restore retains policy lists without forwarding authority')
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM oa_operators"))[0].n,0,'source native identities do not block the destination bootstrap')
 assert.equal((await sql(destination,`SELECT state FROM porthole_archive_actors WHERE actor_ref='${owner.id}'`))[0].state,'inactive','source actor metadata remains opaque and inactive')
 await command(destination,['setup','--owner-email',address('synthetic-porthole-603'),'--non-interactive'])
 const newOwner=(await sql(destination,"SELECT id FROM oa_operators WHERE email="+literal(address('synthetic-porthole-603'))+" AND role='owner' AND status='active'"))[0]
 assert.ok(newOwner && newOwner.id!==owner.id,'destination has its own new native owner')
 assert.equal((await sql(destination,'SELECT paused FROM porthole_ingest_control'))[0].paused,1)
 assert.deepEqual((await sql(destination,'SELECT enabled,allowed_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'["region"]'},'native restore retains policy lists without forwarding authority')
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.import.complete'"))[0].n,1,'native restore fact is captured in its durable job transaction')
 const before=(await sql(destination,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n
 await assert.rejects(()=>command(destination,['import','--input',file,'--yes']),/refus|empty|occupied|failed/i)
 assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,before)
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.import.command' AND json_extract(entry,'$.phase')='failed'"))[0].n,1,'native refusal is privately audited without importing product data')
 // Export integrity alone must not authorize an invalid owner policy. Exercise
 // the native command with intact, independently generated malformed archives.
 for(const [name,allowed,attributes] of [
  ['object',{},[]],['duplicate',['region','region'],[]],
  ['attribute-scope',['region'],['customer']],['invalid-key',['Region'],[]],
 ]) {
  await sql(source,`UPDATE porthole_baggage_policy SET allowed_keys='${JSON.stringify(allowed)}',attribute_keys='${JSON.stringify(attributes)}' WHERE singleton=1`)
  const malformed=join(source,'exports',`invalid-${name}.rer`)
  await command(source,['export','--output',malformed])
  const refused=await clone(`refused-${name}`)
  await assert.rejects(()=>command(refused,['import','--input',malformed,'--yes']),/staged_validation/)
  assert.equal((await sql(refused,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,0,'invalid staged policy publishes no domain objects')
  assert.deepEqual((await sql(refused,'SELECT enabled,allowed_keys,attribute_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'[]',attribute_keys:'[]'},'refusal preserves the inactive destination default')
  console.log('nativeArchiveJourney: refused invalid policy',name)
 }
 console.log('nativeArchiveJourney passed: real rer setup/export/empty restore, excluded credential/hash/identity, inactive authority, semantic policy refusal and durable CLI audit')
 }
} finally {await rm(scratch,{recursive:true,force:true})}
