import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {install,observe} from '../../packaging/collector/install.mjs'
import {form,literal} from './fixture.mjs'
import {servicesBrowser} from './services.mjs'
const execute=promisify(execFile),root='/api/porthole/v1/fleet',screen='/app/settings/fleet'
const docker=async args=>(await execute('docker',args,{maxBuffer:1024*1024})).stdout

/** Real official Collector, Docker stdout and native owner doors. No exporter
 * or telemetry storage is replaced. The relay bridges Docker to the ephemeral
 * loopback Worker while preserving its configured origin. */
export async function collectorInstallJourney({origin,freshOwner,signIn,sql,restartWorker,withEmptyDestination,withPinnedClock}) {
 let cookie=await freshOwner(),sequence=1
 const post=async(path,data,status=200,acting=cookie)=>{const r=await fetch(origin+path,form(origin,acting,data));assert.equal(r.status,status,await r.clone().text());return r.headers.get('content-type')?.includes('json')?r.json():r}
 const get=async(path=root,acting=cookie)=>{const r=await fetch(origin+path,{headers:{cookie:acting}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 assert.equal((await fetch(origin+root)).status,401)
 assert.equal((await get()).installs.length,0)
 await servicesBrowser({origin,cookie,path:screen,contains:'No install observations',name:'fleet-empty'})
 const scope={services:['synthetic-porthole-8601'],environments:['production'],teams:['synthetic-porthole-8602'],signals:['logs','metrics','traces'],actions:['telemetry.write']}
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-8603',class:'ingest',scope},201)
 const dir=await mkdtemp(join(tmpdir(),'porthole-collector-')),name='porthole-synthetic-'+process.pid,producer=name+'-producer'
 const relay=createServer(async(req,res)=>{
  try{const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const r=await fetch(origin+req.url,{method:req.method,headers:{...req.headers,host:new URL(origin).host},...(req.method==='GET'?{}:{body:Buffer.concat(chunks)}),signal:AbortSignal.timeout(15000)})
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()))
  }catch{res.writeHead(503);res.end('unavailable')}
 })
 await new Promise(resolve=>relay.listen(0,'0.0.0.0',resolve))
 const gateway=(await docker(['network','inspect','bridge','--format','{{(index .IPAM.Config 0).Gateway}}'])).trim(),endpoint='http://'+gateway+':'+relay.address().port
 const envFile=join(dir,'collector.env'),config={PORTHOLE_ENDPOINT:endpoint,PORTHOLE_INSTALL_ID:'synthetic-porthole-8604',PORTHOLE_SERVICE:scope.services[0],PORTHOLE_ENVIRONMENT:scope.environments[0],PORTHOLE_TEAM:scope.teams[0],PORTHOLE_INGEST_TOKEN:source.secret,NO_PROXY:gateway+',localhost,127.0.0.1',no_proxy:gateway+',localhost,127.0.0.1'}
 const reporterConfig={...config,PORTHOLE_ENDPOINT:'http://127.0.0.1:'+relay.address().port}
 await writeFile(envFile,Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600})
 const marker='synthetic-porthole-8605-'+process.pid
 const clean=async n=>{await docker(['rm','-f',n]).catch(()=>{})}
 try{
  // The producer has no instrumentation and its daemon log timestamp is the
  // independent clock against which native Explore is reconciled.
  await docker(['run','-d','--name',producer,'node@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43','node','-e','console.log('+JSON.stringify(marker)+');setInterval(()=>{},1000)'])
  const sourceInfo=JSON.parse(await docker(['inspect',producer]))[0]
  let original
  for(let i=0;i<50&&!original;i++){try{const line=(await docker(['logs','--timestamps',producer])).split('\n').find(r=>r.includes(marker));if(line){const space=line.indexOf(' ');original={time:line.slice(0,space),log:line.slice(space+1)+'\n'}}}catch{}if(!original)await new Promise(r=>setTimeout(r,100))}
  assert.ok(original,'actual Docker json-file source record exists')
  const start=Date.now();await install(envFile,{localTest:true,name})
  let found,metrics=[],lastBody
  while(Date.now()-start<60000&&!found){
   await new Promise(r=>setTimeout(r,500));await post('/api/porthole/v1/ingest/drain',{})
   const view=await get('/api/porthole/v1/ingest/records?'+new URLSearchParams({signal:'logs',service:scope.services[0],limit:'200'}));lastBody=JSON.stringify(view)
   found=view.records.find(r=>JSON.stringify(r.payload.record.body).includes(marker))
  }
  if(!found){{const log=await execute('docker',['logs',name]);console.log((log.stdout+log.stderr).slice(-8000))};console.log(lastBody)}
  assert.ok(found,'actual official filelog record queryable within sixty seconds')
  const deliveryMs=Date.now()-start
  const exactNs=(text)=>{const m=text.match(/^(.*\.)(\d+)(Z)$/);return BigInt(Date.parse(m[1]+'000Z'))*1000000n+BigInt(m[2].padEnd(9,'0'))}
  assert.equal(BigInt(found.event_time_ns),exactNs(original.time),'original Docker nanosecond timestamp survives collection and custody')
  const container=found.payload.resource.attributes.find(a=>a.key==='container.id')
  assert.equal(container.value.stringValue,sourceInfo.Id,'the original producer container is named by its real Docker identity')
  assert.equal(found.service,scope.services[0]);assert.equal(found.payload.record.body.stringValue,original.log)
  const first=await observe(name,reporterConfig,++sequence);assert.equal(first.report.state,'active')
  const view=await get(),entry=view.installs[0];assert.equal(entry.freshness,'recent');assert.equal(entry.report.platform,'docker');assert.deepEqual(entry.gaps,[])
  assert.ok(!JSON.stringify(view).includes(source.secret));assert.ok(!JSON.stringify(view).includes(source.credential.id),'fleet returns neither credentials nor secret bindings')
  await servicesBrowser({origin,cookie,path:screen,contains:'no-ebpf-in-docker-install',name:'fleet-docker'})
  const jsonBefore=await sql('SELECT * FROM porthole_fleet_installs')
  await assert.rejects(observe(name,reporterConfig,sequence),/fleet_report_refused_409/)
  assert.deepEqual(await sql('SELECT * FROM porthole_fleet_installs'),jsonBefore,'replayed report cannot refresh freshness')
  // Each real removed mount is observed from Docker, not a fabricated report.
  for(const missing of ['host-proc','host-sys','container-logs','docker-socket']){
   await clean(name);await install(envFile,{localTest:true,name,omit:[missing]})
   const observation=await observe(name,reporterConfig,++sequence)
   assert.ok(observation.receipt.gaps.some(g=>g.code===missing&&g.action.length),'missing '+missing+' has a named next action')
   const actual=(await get()).installs[0];assert.ok(actual.gaps.some(g=>g.code===missing))
  }
  await servicesBrowser({origin,cookie,path:screen,contains:'docker-socket',name:'fleet-missing-socket'})
  await clean(name);await install(envFile,{localTest:true,name});await observe(name,reporterConfig,++sequence)
  await restartWorker();cookie=await freshOwner()
  assert.equal((await get()).installs[0].id,config.PORTHOLE_INSTALL_ID)
  await docker(['restart',name]);await observe(name,reporterConfig,++sequence)
  await docker(['stop','--time','2',name]);await observe(name,reporterConfig,++sequence,'stopped')
  const stopped=await get();assert.equal(stopped.installs[0].freshness,'stale');assert.equal(stopped.installs[0].state,'stopped')
  const retained=await get('/api/porthole/v1/ingest/records?signal=logs&service='+scope.services[0]+'&limit=200')
  assert.ok(retained.records.some(r=>r.id===found.id),'uninstall retains original queryable telemetry')
  await servicesBrowser({origin,cookie,path:screen,contains:'stale',name:'fleet-uninstalled'})
  const count=await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records')
  await new Promise(r=>setTimeout(r,1200));await post('/api/porthole/v1/ingest/drain',{})
  assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'),count,'stopped Collector sends no fresh telemetry')
  const address=['synthetic-porthole-8606','example.com'].join(String.fromCharCode(64))
  await post('/app/settings/members/invite',{email:address,displayName:'Fleet responder',role:'responder',scope:{services:scope.services,environments:scope.environments,teams:scope.teams}},202)
  const responder=await signIn(address)
  assert.equal((await fetch(origin+root,{headers:{cookie:responder}})).status,403,'fleet is native-owner-only')
  assert.equal((await fetch(origin+root,{headers:{cookie,authorization:'Bearer '+source.secret}})).status,403,'bearer takes precedence over owner cookie')
  await post('/app/settings/credentials/revoke',{id:source.credential.id})
  const before=await sql('SELECT * FROM porthole_fleet_installs')
  await assert.rejects(observe(name,reporterConfig,++sequence),/fleet_report_refused_401/)
  assert.deepEqual(await sql('SELECT * FROM porthole_fleet_installs'),before,'revoked credential cannot change install or freshness')
  assert.equal((await get()).installs[0].credentialStatus,'revoked-or-unavailable')
  const forbidden=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:'{}'})
  assert.equal(forbidden.status,401)
  const {fleetArchiveJourney}=await import('./archive.mjs')
  await fleetArchiveJourney({origin,freshOwner,withEmptyDestination,id:config.PORTHOLE_INSTALL_ID,found})
  console.log('PROBE PORT-003 Docker: actual official filelog receiver -> planted stdout in native Explore in '+deliveryMs+' ms; initial delivery observed before sixty seconds with exact source nanoseconds and container ID')
  console.log('PROBE PORT-003 gaps: remove host proc, host sys, container logs and Docker socket individually -> named gaps and next actions; restart preserves observations')
  console.log('PROBE PORT-003 uninstall: stop actual Collector -> stale install and retained original record; revoked credential refuses both report and intake unchanged')
 }finally{await clean(name);await clean(producer);await new Promise(r=>relay.close(r));await rm(dir,{recursive:true,force:true})}
}


/** Protocol observations are not installer qualification: this Verify journey
 * proves current authority, scope, monotonic freshness and inert restoration.
 * The separate Docker journey proves the actual receiver and removed mounts. */
export async function fleetJourney({origin,freshOwner,signIn,sql,restartWorker,withPinnedClock,withEmptyDestination}) {
 const {hostname,release}=await import('node:os')
 let cookie=await freshOwner(),sequence=1
 const post=async(path,data,status=200)=>{const r=await fetch(origin+path,form(origin,cookie,data));assert.equal(r.status,status,await r.clone().text());return r.json()}
 const get=async()=>{const r=await fetch(origin+root,{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const scope={services:['synthetic-porthole-8610'],environments:['production'],teams:['synthetic-porthole-8611'],signals:['logs'],actions:['telemetry.write']}
 const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-8612',class:'ingest',scope},201)
 const other=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-8613',class:'ingest',scope},201)
 const report={id:'synthetic-porthole-8614',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],state:'active',report:{platform:'docker',node:hostname(),kernel:release(),runtime:'docker',collectorVersion:'0.135.0',obiVersion:null,requested:['host-proc','host-sys','container-logs','docker-socket'],granted:[],limits:['protocol-observation-only'],services:[],obi:'not-installed',sequence}}
 const send=async(data=report,secret=credential.secret,status=200)=>{
  const before=await sql('SELECT * FROM porthole_fleet_installs')
  const r=await fetch(origin+root+'/report',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(data)})
  assert.equal(r.status,status,await r.clone().text())
  if(status!==200)assert.deepEqual(await sql('SELECT * FROM porthole_fleet_installs'),before,'refused install report changes no observation or freshness')
  return r.json()
 }
 assert.equal((await fetch(origin+root)).status,401)
 await servicesBrowser({origin,cookie,path:screen,contains:'No install observations',name:'fleet-empty-native'})
 await send();let view=await get()
 assert.equal(view.installs[0].freshness,'recent');assert.equal(view.installs[0].gaps.length,4)
 assert.ok(view.installs[0].gaps.every(g=>g.action.length));assert.deepEqual(view.installs[0].coverage,[])
 await servicesBrowser({origin,cookie,path:screen,contains:'docker-socket',name:'fleet-protocol-gaps'})
 await send(report,other.secret,409)
 await send(report,credential.secret,409)
 await send({...report,service:'foreign'},credential.secret,403)
 await send({...report,report:{...report.report,credential:credential.secret}},credential.secret,400)
 const when=Date.now()+91000
 await withPinnedClock(when,async()=>{assert.equal((await get()).installs[0].freshness,'stale')})
 await restartWorker();cookie=await freshOwner()
 assert.equal((await get()).installs[0].id,report.id)
 report.report.sequence=++sequence;report.state='stopped';await send()
 view=await get();assert.equal(view.installs[0].freshness,'stale');assert.equal(view.installs[0].state,'stopped')
 await servicesBrowser({origin,cookie,path:screen,contains:'stale',name:'fleet-protocol-stopped'})
 const address=['synthetic-porthole-8615','example.com'].join(String.fromCharCode(64))
 await post('/app/settings/members/invite',{email:address,displayName:'Fleet reader',role:'responder',scope:{services:scope.services,environments:scope.environments,teams:scope.teams}},202)
 const responder=await signIn(address)
 assert.equal((await fetch(origin+root,{headers:{cookie:responder}})).status,403)
 assert.equal((await fetch(origin+root,{headers:{cookie,authorization:'Bearer '+credential.secret}})).status,403)
 assert.equal((await fetch(origin+root+'?token=synthetic-porthole-8616',{headers:{cookie}})).status,400)
 await servicesBrowser({origin,path:screen,contains:'unauthenticated',name:'fleet-unauthorized',status:401})
 await post('/app/settings/credentials/revoke',{id:credential.credential.id})
 report.report.sequence=++sequence;await send(report,credential.secret,401)
 assert.equal((await get()).installs[0].credentialStatus,'revoked-or-unavailable')
 const {fleetArchiveJourney}=await import('./archive.mjs')
 await fleetArchiveJourney({origin,freshOwner,withEmptyDestination,id:report.id})
 console.log('PROBE PORT-003 fleet: native-owner observation and API -> exact live and stale states, named missing access, foreign binding and scope and revoked credential refuse unchanged; inactive restore has no credential')
}
