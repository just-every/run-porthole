import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {request as httpsRequest} from 'node:https'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {promisify} from 'node:util'
import {ownerSigninDigest} from '../../src/modules/operator-auth/owner-signin-grant.mjs'
import {literal} from './fixture.mjs'

const execute=promisify(execFile)
const root=fileURLToPath(new URL('../../',import.meta.url))
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))
const check=(condition,message)=>assert.ok(condition,message)

// No global TLS exception: only this ephemeral localhost certificate is trusted.
function localRequest(url,ca,{method='GET',headers={},body,timeout=60000}={}) {
 return new Promise((resolveResponse,reject)=>{
  const request=httpsRequest(url,{ca,method,headers,timeout},response=>{
   const chunks=[];let bytes=0
   response.on('data',chunk=>{
    bytes+=chunk.length
    if(bytes>2*1024*1024) request.destroy(Error('local_response_too_large'))
    else chunks.push(chunk)
   })
   response.on('end',()=>resolveResponse({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}))
   response.on('error',()=>reject(Error('local_response_failed')))
  })
  request.on('timeout',()=>request.destroy(Error('local_request_timeout')))
  request.on('error',()=>reject(Error('local_request_failed')))
  request.end(body)
 })
}

async function unusedPort() {
 const server=createServer()
 await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen)})
 const port=server.address().port
 await new Promise((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()))
 return port
}

function nativeCookie(response) {
 const cookies=response.headers['set-cookie']??[]
 const session=cookies.find(value=>value.startsWith('__Host-operator_session='))
 check(session && /;\s*Secure(?:;|$)/i.test(session) && /;\s*HttpOnly(?:;|$)/i.test(session),'production native secure session issued')
 return session.split(';')[0]
}

// The endpoint and all of its query credentials stay in memory. Neither its
// response bodies nor network exceptions may reach a log or assertion output.
async function mailboxReceipt(endpoint,recipient,noticeId,since,{wait=true}={}) {
 const deadline=Date.now()+15000
 do {
  const url=new URL(endpoint)
  for(const [key,value] of Object.entries({contains:noticeId,since,to:recipient,limit:'10'}))url.searchParams.set(key,value)
  const response=await fetch(url,{redirect:'manual',headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.min(5000,Math.max(1,deadline-Date.now())))})
  assert.equal(response.status,200,'controlled mailbox answered')
  const value=await response.json()
  check(value.ok===true && Number.isSafeInteger(value.count) && value.count>=0 && Array.isArray(value.receipts),'controlled mailbox receipt envelope')
  check(value.count<=1 && value.receipts.length<=1,'unique notice has no duplicate mailbox receipt')
  if(value.count===1) {
   check(value.receipts.length===1,'receipt count agrees with mailbox result')
   const receipt=value.receipts[0]
   check([receipt.subject,receipt.excerpt].some(text=>typeof text==='string' && text.includes(noticeId)),'mailbox receipt contains the exact notice identity')
   check(typeof receipt.receivedAt==='string' && Number.isFinite(Date.parse(receipt.receivedAt)) && Date.parse(receipt.receivedAt)>=Date.parse(since),'mailbox receipt belongs to this run')
   // Only opaque safe identifiers and timestamps are allowed in the artifact.
   check(typeof receipt.id==='string' && /^[A-Za-z0-9._:-]{1,1024}$/.test(receipt.id),'mailbox receipt has a safe opaque identifier')
   return {count:1,id:receipt.id,receivedAt:new Date(receipt.receivedAt).toISOString()}
  }
  check(value.receipts.length===0,'empty mailbox count agrees with result')
  if(!wait || Date.now()>=deadline)break
  await pause(Math.min(1000,Math.max(1,deadline-Date.now())))
 } while(Date.now()<deadline)
 throw Error('mailbox_receipt_not_observed')
}

/** Opt-in LIVE journey. Call only under the root's heavy slot after building.
 * Real SendGrid sends go exclusively to PORTHOLE_SANDBOX_TO. The four named
 * bindings are supplied by the private environment wrapper, never CLI values.
 * Product state is created through HTTP; the only direct SQL is the existing
 * native owner-signin network-edge fixture. No telemetry/notice rows are seeded.
 */
export async function liveRecoveryJourney() {
 let stage='sandbox_bindings',scratch,worker,workerError=false
 try {
  const names=['PORTHOLE_SANDBOX_MAIL','PORTHOLE_SANDBOX_FROM','PORTHOLE_SANDBOX_TO','PORTHOLE_SANDBOX_RECEIPTS']
  for(const name of names)check(typeof process.env[name]==='string' && process.env[name].length>0,`${name} must be provided by the private wrapper`)
  const apiKey=process.env.PORTHOLE_SANDBOX_MAIL,from=process.env.PORTHOLE_SANDBOX_FROM,recipient=process.env.PORTHOLE_SANDBOX_TO,endpoint=process.env.PORTHOLE_SANDBOX_RECEIPTS
  check(!/[\r\n\0]/.test(apiKey+from+recipient),'sandbox bindings are single line')
  check(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient),'held sandbox recipient is one mailbox')
  check(new URL(endpoint).protocol==='https:','controlled mailbox uses HTTPS')
  stage='private_emitted_worker_configuration'
  const candidateSha=(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim()
  check(/^[a-f0-9]{40}$/.test(candidateSha),'candidate commit identity available')
  const emittedPath=join(root,'dist/server/wrangler.json'),emitted=JSON.parse(await readFile(emittedPath,'utf8'))
  scratch=await mkdtemp(join(tmpdir(),'porthole-live-recovery-'))
  const config=join(scratch,'wrangler.json'),persist=join(scratch,'state'),cert=join(scratch,'localhost.pem'),key=join(scratch,'localhost.key')
  const origin=`https://127.0.0.1:${await unusedPort()}`
  const setupToken=randomBytes(32).toString('base64url'),sessionSecret=randomBytes(32).toString('base64url')
  const ownerEmail='synthetic-porthole-800@example.com'
  const privateVars={AUTH_ORIGIN:origin,AUTH_LOCAL:'false',RER_DEMO:'0',OWNER_EMAIL:ownerEmail,SESSION_SECRET:sessionSecret,SETUP_TOKEN:setupToken,MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:apiKey,MAIL_FROM:from}
  await writeFile(join(scratch,'.dev.vars'),Object.entries(privateVars).map(([name,value])=>`${name}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600})
  const compiledDirectory=dirname(emittedPath)
  const configuration={...emitted,main:resolve(compiledDirectory,emitted.main),assets:{...emitted.assets,directory:resolve(compiledDirectory,emitted.assets.directory)},vars:{},d1_databases:emitted.d1_databases.map(database=>({...database,migrations_dir:resolve(compiledDirectory,database.migrations_dir)})),dev:{...emitted.dev,ip:'127.0.0.1',local_protocol:'https'}}
  delete configuration.configPath;delete configuration.userConfigPath
  await writeFile(config,JSON.stringify(configuration))
  await writeFile(join(scratch,'localhost.cnf'),'[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n[subject]\nCN=localhost\n[extensions]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:true\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n')
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',join(scratch,'localhost.cnf'),'-keyout',key,'-out',cert],{cwd:scratch,timeout:15000})
  const ca=await readFile(cert)
  // Starting the Wrangler CLI directly gives us its precise PID. It owns and
  // shuts down Miniflare/workerd; there is no shell or shared process match.
  const wrangler=join(root,'node_modules/wrangler/wrangler-dist/cli.js')
  const env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(scratch,'private-wrangler.log'),CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'}
  const run=async args=>execute(process.execPath,[wrangler,...args],{cwd:scratch,env,timeout:60000,maxBuffer:8*1024*1024})
  const sql=async command=>JSON.parse((await run(['d1','execute','foundation','--local','--persist-to',persist,'--config',config,'--json','--command',command])).stdout).flatMap(result=>result.results??[])
  async function stopWorker() {
   if(!worker)return
   const owned=worker
   if(owned.pid && owned.exitCode===null && owned.signalCode===null) {
    const exited=new Promise(resolveExit=>owned.once('exit',resolveExit))
    owned.kill('SIGTERM')
    let timer
    try {await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned_worker_stop_timeout')),15000)})])}
    finally {clearTimeout(timer)}
   }
   worker=undefined
  }
  async function startWorker() {
   workerError=false
   worker=spawn(process.execPath,[wrangler,'dev','--local','--config',config,'--persist-to',persist,'--ip','127.0.0.1','--port',new URL(origin).port,'--inspector-port','0','--local-protocol','https','--https-key-path',key,'--https-cert-path',cert,'--log-level','error'],{cwd:scratch,env,stdio:['ignore','ignore','ignore']})
   worker.on('error',()=>{workerError=true})
   const deadline=Date.now()+30000
   while(Date.now()<deadline) {
    check(!workerError && worker.exitCode===null && worker.signalCode===null,'owned Worker stays running')
    try {if((await localRequest(origin+'/health',ca,{timeout:1000})).status===200)return} catch {}
    await pause(250)
   }
   throw Error('owned_worker_readiness_timeout')
  }
  const request=(path,options)=>localRequest(origin+path,ca,options)
  let cookie=''
  const postRaw=(path,data,actingCookie=cookie)=>request(path,{method:'POST',headers:{origin,cookie:actingCookie,'content-type':'application/json'},body:JSON.stringify(data)})
  const post=async(path,data,status=200)=>{const response=await postRaw(path,data);assert.equal(response.status,status,path);return JSON.parse(response.body)}
  const health=async()=>{const response=await request('/api/v1/health',{headers:{cookie}});assert.equal(response.status,200,'owner health');return JSON.parse(response.body)}
  const component=(state,name)=>state.components.find(row=>row.component===name)
  const monitor=(state,id)=>component(state,'monitor-evaluation').evidence.monitors.find(row=>row.monitorId===id)
  try {
   stage='migration_and_worker_readiness'
   await run(['d1','migrations','apply','foundation','--local','--persist-to',persist,'--config',config])
   await startWorker()
   stage='native_owner_bootstrap'
   const boot=await postRaw('/auth/bootstrap',{token:setupToken,displayName:'synthetic-porthole-801',returnTo:'/setup'})
   if(boot.status!==303) {
    let code
    try {code=JSON.parse(boot.body).error}catch {}
    const known=['invalid_setup_token','invalid_origin','invalid_host','invalid_configuration','auth_unavailable','already_initialized','email_not_allowed']
    stage=`native_owner_bootstrap_http_${boot.status}_${known.includes(code)?code:'undisclosed'}`
    throw Error('native_bootstrap_refused')
   }
   stage='native_owner_bootstrap_secure_cookie'
   cookie=nativeCookie(boot)
   stage='native_owner_first_run'
   const setup=await request('/setup',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes'}).toString()})
   if(setup.status!==303) {stage=`native_owner_first_run_http_${setup.status}`;throw Error('native_first_run_refused')}
   stage='native_owner_configuration_step_up_refusal'
   let state=await health()
   const configInput={revision:state.configuration.revision,freshnessSeconds:10,noticesEnabled:true,recipient,confirm:'enable-independent-notices'}
   const noProof=await postRaw('/api/v1/health/configuration',configInput)
   assert.equal(noProof.status,403,'bootstrap session cannot bypass step-up')
   check(JSON.parse(noProof.body).error==='step_up_required','step-up is required before enabling real mail')
   stage='fresh_native_owner_signin_and_step_up'
   const token=randomBytes(32).toString('base64url'),now=Date.now()
   await stopWorker()
   // Same auth network-edge fixture as fixture.mjs. The public confirmation
   // creates the real native session and its fresh step-up proof atomically.
   await sql(`INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) SELECT ${literal(randomUUID())},${literal(await ownerSigninDigest(token))},id,version,${now},${now+120000} FROM oa_operators WHERE email=${literal(ownerEmail)}`)
   await startWorker()
   const signin=await postRaw('/auth/owner-signin',{token},'')
   assert.equal(signin.status,303,'native owner link confirmation')
   cookie=nativeCookie(signin)
   const session=await request('/auth/session',{headers:{cookie}})
   assert.equal(session.status,200,'native owner session')
   check(JSON.parse(session.body).kind==='native','live journey uses native authentication')
   stage='real_collector_ingest_and_firing_monitor'
   const scope={services:['synthetic-porthole-803'],environments:['synthetic-porthole-804'],teams:['synthetic-porthole-805']}
   const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-802',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
   check(typeof credential.secret==='string','real ingest credential minted')
   const heartbeat=async()=>{
    const response=await request('/api/v1/health/heartbeat',{method:'POST',headers:{authorization:`Bearer ${credential.secret}`,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-806',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],signal:'logs'})})
    assert.equal(response.status,200,'authenticated collector heartbeat')
   }
   let sequence=810
   async function ingestAndDrain() {
    const packet={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:scope.environments[0]}},{key:'team',value:{stringValue:scope.teams[0]}}]},scopeLogs:[{logRecords:[{timeUnixNano:(BigInt(Date.now())*1000000n+123n).toString(),severityNumber:17,body:{stringValue:'synthetic-porthole-807'}}]}]}]}
    const response=await request('/v1/logs',{method:'POST',headers:{authorization:`Bearer ${credential.secret}`,'content-type':'application/json','x-porthole-batch-id':`synthetic-porthole-${sequence++}`,'x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':scope.environments[0]},body:JSON.stringify(packet)})
    assert.equal(response.status,200,'real OTLP ingestion')
    const drained=await post('/api/porthole/v1/ingest/drain',{})
    check(drained.pendingBatches===0,'real queue drained')
   }
   await heartbeat();await ingestAndDrain()
   const created=await post('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-808',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:3600}},201)
   await post('/api/porthole/v1/objects/activate',{id:created.id,revision:created.revision,confirm:'activate'})
   const baseline=await post('/api/v1/health/tick',{})
   check(baseline.delivery.attempted===0 && baseline.delivery.status==='disabled','no send precedes explicit owner consent')
   const firing=monitor(baseline.state,created.id)
   check(firing.status==='Firing' && firing.observedCount===1 && typeof firing.firingEpisode==='string','real monitor is firing before coverage loss')
   stage='explicit_owner_notice_consent'
   state=await health()
   const consent={revision:state.configuration.revision,freshnessSeconds:10,noticesEnabled:true,recipient}
   const noConsent=await postRaw('/api/v1/health/configuration',consent)
   assert.equal(noConsent.status,400,'real notice configuration needs explicit consent')
   check(JSON.parse(noConsent.body).error==='explicit_notice_confirmation_required','notice consent refused explicitly')
   await post('/api/v1/health/configuration',{...consent,confirm:'enable-independent-notices'})
   await heartbeat()
   stage='elapsed_collector_failure_and_sendgrid_submission'
   // Actual elapsed wall time causes coverage loss. Continue real telemetry so
   // the independently missing collector is the failure under examination.
   await pause(10250)
   await ingestAndDrain()
   const since=new Date().toISOString()
   const outage=await post('/api/v1/health/tick',{})
   check(component(outage.state,'collector').status==='Unknown','collector is actually stale')
   const unknown=monitor(outage.state,created.id)
   check(unknown.status==='Unknown' && unknown.lastKnownCount===1 && unknown.firingEpisode===firing.firingEpisode,'coverage loss retains real firing episode and last-known count')
   check(outage.delivery.attempted===1 && outage.delivery.status==='accepted','SendGrid accepted an actual failure notice')
   // The stale collector also makes monitor coverage unknown. Flush these two
   // distinct failure notices, then establish that restart submits neither again.
   await ingestAndDrain()
   const second=await post('/api/v1/health/tick',{})
   check(second.delivery.attempted===1 && second.delivery.status==='accepted','SendGrid accepted the second distinct coverage failure')
   state=await health()
   const failures=state.notices.filter(notice=>notice.phase==='failure')
   check(failures.length===2 && failures.every(notice=>['collector','monitor-evaluation'].includes(notice.component) && notice.state==='accepted' && notice.attempts===1),'only expected failure episodes were submitted once')
   const notice=failures.find(row=>row.component==='collector')
   check(notice && typeof notice.provider_id==='string' && /^[A-Za-z0-9._:-]{1,1024}$/.test(notice.provider_id),'collector notice has safe SendGrid acceptance identity')
   stage='restart_without_duplicate_submission'
   await stopWorker();await startWorker()
   // The same native cookie and durable D1 state must survive process restart.
   for(let tick=0;tick<2;tick++) {
    await ingestAndDrain()
    const resumed=await post('/api/v1/health/tick',{})
    check(resumed.delivery.attempted===0 && resumed.delivery.status==='idle','restart and repeat do not submit an accepted notice again')
    check(monitor(resumed.state,created.id).firingEpisode===firing.firingEpisode,'firing episode survives restart')
   }
   const resumed=await health()
   check(resumed.notices.length===failures.length && failures.every(before=>resumed.notices.some(after=>after.id===before.id && after.attempts===1 && after.state==='accepted' && after.provider_id===before.provider_id)),'accepted identities and one-attempt counts survive restart')
   stage='controlled_mailbox_receipt'
   const receipt=await mailboxReceipt(endpoint,recipient,notice.id,since)
   // A second independent mailbox read also detects an already-visible duplicate.
   const confirmed=await mailboxReceipt(endpoint,recipient,notice.id,since,{wait:false})
   check(receipt.id===confirmed.id,'the mailbox still reports the same single receipt')
   stage='verified_provider_receipt'
   const artifact={candidateSha,count:confirmed.count,id:confirmed.id,noticeId:notice.id,receivedAt:confirmed.receivedAt,providerId:notice.provider_id}
   return artifact
  } finally {await stopWorker()}
 } catch {
  // Child command errors, assertion actual/expected fields and fetch exception
  // causes can contain credentials. Export only this fixed stage description.
  throw Error(`LIVE recovery journey failed during ${stage}; private output withheld`)
 } finally {
  if(scratch && !worker)await rm(scratch,{recursive:true,force:true})
 }
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
 try {
  const receipt=await liveRecoveryJourney()
  console.log(JSON.stringify(receipt))
  console.log('LIVE recovery passed: real native consent, firing monitor coverage loss, SendGrid acceptance, controlled mailbox receipt and restart without duplicate submission.')
 } catch(error) {
  console.error(error.message)
  process.exitCode=1
 }
}
