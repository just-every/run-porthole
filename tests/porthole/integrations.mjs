import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {writeFile,mkdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {integrationCollector} from './collector-process.mjs'
import {form,literal} from './fixture.mjs'
import {integrationService} from './integration-matrix/estate.mjs'
import {eventBrowser} from './events.mjs'
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms)),api='/api/porthole/v1/integrations',app='/app/settings/integrations/catalog'
const attrs=items=>Object.fromEntries((items??[]).map(a=>[a.key,a.value.stringValue??a.value.intValue??a.value.doubleValue]))
async function nativeEnable(origin,cookie,data) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',NO_AT_BRIDGE:'1'},...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {
  const context=await browser.newContext({viewport:{width:1440,height:950}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();assert.equal((await page.goto(origin+app)).status(),200)
  await page.getByLabel('Pack',{exact:true}).selectOption(data.pack)
  for(const [label,value]of [['Service',data.service],['Environment',data.environment],['Team',data.team]])await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByLabel('Existing ingest credential').selectOption(data.credentialId)
  await page.getByLabel('Current revision',{exact:true}).fill(String(data.revision))
  await page.getByRole('checkbox').check()
  await Promise.all([page.waitForURL(url=>new RegExp(app+'/[a-f0-9-]{36}$').test(url.pathname)),page.getByRole('button',{name:'Enable collection pack',exact:true}).click()])
  const id=new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(await page.getByRole('status').textContent())
  await context.close();return id
 }finally{await browser.close()}
}
export async function integrationJourney({origin,freshOwner,restartWorker,signIn,sql,withEmptyDestination,withPinnedClock,analytics}) {
 let cookie=await freshOwner()
 const get=(path,acting=cookie)=>fetch(origin+path,{headers:{cookie:acting}}),post=(path,data,acting=cookie)=>fetch(origin+path,form(origin,acting,data))
 const value=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json()}
 const catalog=await value(await get(api));assert.ok(catalog.packs.length>0)
 assert.equal((await get(api,'')).status,401)
 await eventBrowser({origin,cookie,path:app,name:'integrations-empty'})
 const scope={services:catalog.packs.map(p=>'pack-'+p.id),environments:['test'],teams:['commerce']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Local integration matrix',class:'ingest',scope:{...scope,signals:['metrics','logs'],actions:['telemetry.write']},requestsPerMinute:6000,acceptedBytesPerMinute:100000000}),201)
 const all=[]
 const select=async role=>{cookie=await freshOwner();const current=await value(await get('/api/porthole/v1/analytics/configuration'));await value(await post('/api/porthole/v1/analytics/configuration',{revision:current.revision,role,enabled:true,confirm:'connect-analytical-workers'}))}
 await select('primary')
 for(const pack of catalog.packs) {
  console.log('Integration matrix starting '+pack.id)
  cookie=await freshOwner()
  const service=await integrationService(pack),data={pack:pack.id,service:'pack-'+pack.id,environment:'test',team:'commerce',credentialId:source.credential.id,revision:0,confirm:'review-local-collection'}
  cookie=await freshOwner()
  let collector,configuration,binding
  const stop=async()=>{await collector?.stop();collector=null}
  const start=async()=>{collector=await integrationCollector({configuration,file:join(service.directory,'collector.json'),environment:service.env,secret:source.secret,serviceSecret:service.password})}
  const drain=()=>post('/api/porthole/v1/ingest/drain',{})
  const readMetrics=async(through,metric=pack.metrics[0].name)=>{
   const rows=[];let cursor,snapshot
   do{const q=new URLSearchParams({signal:'metrics',service:data.service,environment:'test',team:'commerce',metric,limit:'200',...(through?{through}:{}),...(cursor?{cursor}:{}),...(snapshot===undefined?{}:{snapshot:String(snapshot)})});const body=await value(await get('/api/porthole/v1/ingest/records?'+q));rows.push(...body.records);cursor=body.cursor;snapshot=body.snapshot}while(cursor)
   return rows
  }
  const wait=async(test,label,seconds=40)=>{
   let last
   for(let i=0;i<seconds;i++){if(collector?.child.exitCode!==null&&collector?.child.exitCode!==undefined)throw Error('stock_collector_exited_'+pack.id+' '+collector?.diagnostics());await drain();last=await test();if(last)return last;await pause(1000)}
   throw Error('integration_wait_'+pack.id+'_'+label+' '+collector?.diagnostics())
  }
  try {
   const before=await sql('SELECT COUNT(*) AS n FROM porthole_integration_bindings')
   await value(await post(api+'/enable',{...data,password:'synthetic-porthole-66099'}),400)
   assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_integration_bindings'),before,'a service secret field cannot persist a setup')
   const id=await nativeEnable(origin,cookie,data),detail=await value(await get(api+'/'+id)),enabled={binding:detail.binding,configurationUrl:api+'/'+id+'/configuration'};binding=enabled.binding
   assert.equal((await value(await get(api+'/'+binding.id))).health.state,'Unknown')
   configuration=await value(await get(enabled.configurationUrl));assert.ok(!JSON.stringify(configuration).includes(service.password));assert.ok(!JSON.stringify(configuration).includes(source.secret))
   await withPinnedClock(Date.now()+360000,async()=>{await value(await post(api+'/enable',{...data,revision:binding.revision}),403);assert.equal((await get(enabled.configurationUrl)).status,403);if(pack.id==='postgresql')await eventBrowser({origin,cookie,path:app+'/'+binding.id+'/configuration',name:'integration-proof-expired',status:403,exercise:async page=>{assert.equal(await page.getByRole('button',{name:'Send confirmation link'}).count(),1)}})})
   const count=await service.workload();assert.ok(count>=7)
   const beforeStat=await service.stats()
   await start()
   const rows=await wait(async()=>{const r=await readMetrics();return r.length?r:null},'metrics')
   const afterStat=await service.stats(),values=rows.map(r=>Number(r.payload.record.asInt??r.payload.record.asDouble)),latestTime=rows.at(-1).event_time_ns,latest=rows.filter(r=>r.event_time_ns===latestTime)
   const sourceAgeMs=Date.now()-Number(BigInt(latestTime)/1000000n);assert.ok(sourceAgeMs>=0&&sourceAgeMs<=5000,'the source comparison uses a stock metric no older than one collection interval')
   const actual=latest.map(r=>({value:Number(r.payload.record.asInt??r.payload.record.asDouble),attributes:{...attrs(r.payload.resource?.attributes),...attrs(r.payload.record.attributes)}}))
   console.log('Integration source comparison '+pack.id+' '+JSON.stringify({beforeStat,afterStat,actual}))
   if(['redis','kafka'].includes(pack.id))assert.ok(actual.some(r=>r.value===afterStat&&(pack.id!=='kafka'||r.attributes.topic==='porthole')),'stock metric equals independent service statistic')
   else if(pack.id==='elasticsearch')assert.ok(actual.some(r=>r.attributes.state==='active'&&r.value>=beforeStat&&r.value<=afterStat),'node document counts agree within the independently bracketed collection interval')
   else if(pack.id==='mysql')assert.ok(actual.some(r=>r.attributes.command==='select'&&r.value>=beforeStat&&r.value<=afterStat),'stock SHOW GLOBAL STATUS command count lies within the independently observed scrape interval')
   else if(pack.id==='mongodb')assert.ok(actual.some(r=>r.attributes.operation==='insert'&&r.value===afterStat),'stock serverStatus inserts equal actual inserted operation count')
   else if(pack.id==='rabbitmq')assert.equal(actual.filter(r=>r.attributes.state==='ready').reduce((n,r)=>n+r.value,0),7,'management counters agree with seven real queued messages')
   else assert.ok(actual.some(r=>r.value>=beforeStat&&r.value<=afterStat),'stock cumulative counter lies in independently bracketed source interval')
   await wait(async()=>{const r=await value(await get(api+'/'+binding.id));if(r.health.state==='Collecting')return r;return null},'scraper-health')
   const extras=await service.extraStats(),extraRows={}
   for(const [name,expected]of Object.entries(extras)) {
    const observed=await readMetrics(undefined,name);assert.ok(observed.length,'stock extra preset signal is present')
    const lastTime=observed.at(-1).event_time_ns,latest=observed.filter(r=>r.event_time_ns===lastTime)
    assert.ok(latest.some(r=>Number(r.payload.record.asInt??r.payload.record.asDouble)===expected&&(pack.id!=='mongodb'||attrs(r.payload.resource.attributes)['mongodb.database.name']==='porthole')&&(pack.id!=='kafka'||attrs(r.payload.record.attributes).group==='porthole')),'stock '+name+' agrees with the independently queried service statistic')
    extraRows[name]={observed,lastTime}
   }
   const {integrationPresetJourney}=await import('./dashboards.mjs')
   for(const role of ['primary','standby']){
    await select(role);const observed=await readMetrics(latestTime)
    assert.deepEqual(observed.map(r=>({id:r.id,payload:r.payload,eventTime:r.event_time_ns})),rows.map(r=>({id:r.id,payload:r.payload,eventTime:r.event_time_ns})),role+' retains identical stock metric values and source fields')
    for(const [name,proof]of Object.entries(extraRows)){const copy=await readMetrics(proof.lastTime,name);assert.deepEqual(copy.map(r=>({id:r.id,payload:r.payload,eventTime:r.event_time_ns})),proof.observed.map(r=>({id:r.id,payload:r.payload,eventTime:r.event_time_ns})),role+' retains the extra source values')}
    await integrationPresetJourney({origin,cookie,binding,metric:pack.metrics[0].name,rows,metricRows:{[pack.metrics[0].name]:rows,...Object.fromEntries(Object.entries(extraRows).map(([name,proof])=>[name,proof.observed]))},screens:role==='standby'})
   }
   await select('primary')
   if(pack.id==='nginx') {const logs=await value(await get('/api/porthole/v1/ingest/records?signal=logs&service=pack-nginx'));assert.ok(logs.records.filter(r=>!attrs(r.payload.record.attributes)['porthole.setup.failure']).length===9,'stock filelog exports real access and error lines')}
   await service.deny()
   await stop();await start()
   const denied=await wait(async()=>{const r=await value(await get(api+'/'+binding.id));return r.health.state==='Failed'||pack.id==='kafka'&&r.health.state==='Unknown'&&r.health.reason.includes('required receiver signal is absent')?r:null},'denied')
   if(pack.id==='kafka'&&denied.health.state==='Unknown')assert.ok(denied.health.reason.includes('kafka.partition.current_offset'),'hidden unauthorized topics remain explicitly absent, never healthy');else assert.ok(['permission_denied','authentication_denied','receiver_failed'].includes(denied.health.failure),'stock diagnostics classify denial without the raw error')
   assert.match(denied.health.nextAction,new RegExp(pack.id.toUpperCase()+'_ENDPOINT'))
   assert.ok(denied.health.nextAction.includes(pack.permissions));assert.ok(!JSON.stringify(denied).includes(service.password))
   await eventBrowser({origin,cookie,path:app+'/'+binding.id,name:'integration-'+pack.id+'-denied'})
   await service.restore();await stop();await start()
   await wait(async()=>{const r=await value(await get(api+'/'+binding.id));return r.health.state==='Collecting'?r:null},'recovered')
   if(pack.id==='nginx') {
    for(const kind of ['ACCESS','ERROR']){
     await service.denyFile(kind);await stop();await start()
     await wait(async()=>{const r=await value(await get(api+'/'+binding.id));return r.health.failure==='log_file_access_denied'?r:null},'denied-'+kind+'-file')
     await service.restoreFile(kind);await stop();await start()
     await wait(async()=>{const r=await value(await get(api+'/'+binding.id));return r.health.state==='Collecting'?r:null},'recovered-'+kind+'-file')
    }
    const logs=await value(await get('/api/porthole/v1/ingest/records?signal=logs&service=pack-nginx'))
    assert.equal(logs.records.filter(r=>!attrs(r.payload.record.attributes)['porthole.setup.failure']).length,9,'persistent stock file checkpoints prevent duplicate access and error logs after restarts')
   }
   await stop()
   await withPinnedClock(Date.now()+30000,async()=>{assert.equal((await value(await get(api+'/'+binding.id))).health.state,'Unknown','stopped collector cannot retain healthy setup')})
   await restartWorker();assert.equal((await value(await get(api+'/'+binding.id))).binding.dashboard_id,binding.dashboard_id)
   all.push({pack:pack.id,binding,count,beforeStat,afterStat,actual,sourceAgeMs,collectionIntervalMs:5000})
   console.log('Integration matrix passed '+pack.id)
  }finally {await stop();await service.dispose()}
 }
 cookie=await freshOwner()
 await select('standby');await analytics.stop('standby')
 const unavailable=await value(await get(api+'/'+all[0].binding.id));assert.equal(unavailable.health.state,'Unknown');assert.match(unavailable.health.reason,/unavailable/)
 assert.equal((await get('/api/porthole/v1/ingest/records?signal=metrics&service=pack-postgresql')).status,503,'a stopped selected analytical store cannot release a complete result')
 await eventBrowser({origin,cookie,path:app+'/'+all[0].binding.id,name:'integration-storage-unavailable'})
 await analytics.start('standby');await select('primary')
 const before=await sql('SELECT * FROM porthole_integration_bindings ORDER BY id')
 await value(await post(api+'/enable',{pack:'redis',service:'pack-redis',environment:'test',team:'commerce',credentialId:source.credential.id,revision:0,confirm:'review-local-collection'}),409)
 assert.deepEqual(await sql('SELECT * FROM porthole_integration_bindings ORDER BY id'),before)
 const address=['synthetic-porthole-66100','example.com'].join(String.fromCharCode(64)),restrictedScope={services:['pack-redis'],environments:['test'],teams:['commerce']}
 const invited=await value(await post('/app/settings/members/invite',{email:address,displayName:'Scoped integration reader',role:'read-only analyst',scope:restrictedScope}),202),reader=await signIn(address)
 assert.equal((await value(await get(api,reader))).packs.flatMap(p=>p.bindings).length,1)
 await value(await post(api+'/enable',{pack:'redis',service:'pack-redis',environment:'test',team:'commerce',credentialId:source.credential.id,revision:1,confirm:'review-local-collection'},reader),403)
 const adminAddress=['synthetic-porthole-66101','example.com'].join(String.fromCharCode(64))
 await value(await post('/app/settings/members/invite',{email:adminAddress,displayName:'Scoped integration administrator',role:'admin',scope:restrictedScope}),202)
 const adminCookie=await signIn(adminAddress),redis=all.find(row=>row.pack==='redis').binding
 const reviewedId=await nativeEnable(origin,adminCookie,{pack:'redis',service:'pack-redis',environment:'test',team:'commerce',credentialId:source.credential.id,revision:redis.revision})
 assert.equal(reviewedId,redis.id);assert.equal((await value(await get(api+'/'+redis.id,adminCookie))).binding.revision,redis.revision+1,'a fresh scoped admin can review the native setup')
 cookie=await freshOwner()
 const admin=(await sql(`SELECT id FROM oa_operators WHERE email=${literal(adminAddress)}`))[0]
 await value(await post('/app/settings/members/remove',{operatorId:admin.id,confirm:'remove'}))
 assert.equal((await get(api,adminCookie)).status,401,'removed admin cannot read the next catalog request')
 const bearer=await get(api);assert.equal(bearer.status,200)
 assert.equal((await fetch(origin+api,{headers:{cookie,authorization:'Bearer '+source.secret}})).status,403)
 const session=await value(await fetch(origin+'/auth/session',{headers:{cookie:reader}}))
 await sql(`UPDATE oa_sessions SET revoked_at=${Date.now()} WHERE id=${literal(session.id)}`)
 assert.equal((await get(api,reader)).status,401,'next-request session revocation removes catalog reads')
 const wire=(await sql("SELECT wire_base64 FROM porthole_ingest_batches WHERE signal='metrics' ORDER BY sequence LIMIT 1"))[0].wire_base64
 await value(await post('/app/settings/credentials/revoke',{id:source.credential.id,revision:source.credential.revision}))
 const denied=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:Buffer.from(wire,'base64')});assert.equal(denied.status,403,'revoked intake credential refuses an actual unchanged collector envelope')
 assert.equal((await get(api+'/'+all[0].binding.id+'/configuration')).status,409)
 assert.equal((await value(await get(api+'/'+all[0].binding.id))).health.state,'Unknown')
 const {integrationArchiveJourney}=await import('./archive.mjs');await integrationArchiveJourney({origin,freshOwner,withEmptyDestination,bindings:all.map(r=>r.binding),secret:source.secret})
 if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,'integration-matrix.json'),JSON.stringify({services:all.map(({binding,...r})=>r),passed:true},null,2)+'\n')}
 console.log('PROBE PORT-006 local packs: eight pinned real services, native enablement and generated stock collector configurations -> independently reconciled metrics, native presets, denied and recovered scraper setup, stale evidence, restart, restricted and revoked reads, inactive restore')
}
