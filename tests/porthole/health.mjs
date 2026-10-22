import assert from 'node:assert/strict'
import { form } from './fixture.mjs'

/** Public-door recovery with real D1/Worker intake, a real firing monitor and
 * actual unavailable analytical table. Only auth's existing mail-edge fixture
 * provisions a native owner grant. No telemetry/evaluation rows are fabricated. */
export async function recoveryJourney({origin,freshOwner,restartWorker,sql,signIn}) {
 let cookie=await freshOwner()
 const readers=await healthAccessJourney({origin,freshOwner,signIn})
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
 const scope={services:['synthetic-porthole-503'],environments:['production'],teams:['synthetic-porthole-505']}
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
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:'owner@example.com'},400)
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:'owner@example.com',confirm:'enable-independent-notices'})
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
  for(const reader of readers) {
   const response=await fetch(origin+'/api/v1/health',{headers:{cookie:reader.cookie}})
   assert.equal(response.status,200,reader.role+' reads during an analytical outage')
   const scoped=await response.json()
   assert.equal(scoped.status,'Unknown');assert.equal(component(scoped,'query').status,'Unknown')
   if(reader.role==='finance reader') {assert.deepEqual(component(scoped,'query').evidence.lastKnown,[]);assert.deepEqual(component(scoped,'monitor-evaluation').evidence.monitors,[])}
   else assert.ok(component(scoped,'query').evidence.lastKnown.some(row=>row.service===scope.services[0]))
   if(reader.role!=='admin') {
    assert.ok(component(scoped,'query').evidence.lastKnown.every(row=>row.service===scope.services[0] && row.environment==='production' && row.team===scope.teams[0]))
    assert.equal(scoped.configuration.recipient,null)
    assert.ok(component(scoped,'monitor-evaluation').evidence.monitors.every(row=>row.monitorId===created.id))
   }
  }
  await healthBrowser({origin,cookie:readers.find(row=>row.role==='responder').cookie,name:'health-responder-outage',readOnly:true})
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
 await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:10,noticesEnabled:true,recipient:'owner@example.com',confirm:'enable-independent-notices'})
 await sendHeartbeat()
 // Elapsed wall time proves stale detection; no timestamps are edited in D1.
 await new Promise(resolve=>setTimeout(resolve,10250))
 state=await health()
 assert.equal(component(state,'collector').status,'Unknown')
 for(const reader of readers) {
  const response=await fetch(origin+'/api/v1/health',{headers:{cookie:reader.cookie}})
  assert.equal(response.status,200,reader.role+' reads during a stopped collector')
  const scoped=await response.json()
  assert.equal(scoped.status,'Unknown');assert.equal(component(scoped,'collector').status,'Unknown')
 }
 const stale=await post('/api/v1/health/tick',{})
 assert.equal(monitor(stale.state,created.id).status,'Unknown')
 assert.equal(monitor(stale.state,created.id).firingEpisode,firing.firingEpisode)
 await restartWorker();cookie=await freshOwner()
 const resumed=await health()
 assert.ok(resumed.notices.some(row=>row.component==='collector'&&row.phase==='failure'))
 await sendHeartbeat();await post('/api/porthole/v1/ingest/drain',{})
 await post('/api/v1/health/configuration',{revision:resumed.configuration.revision,freshnessSeconds:300,noticesEnabled:false})
 const loss={sourceId:credential.credential.id,signal:'logs',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],kind:'source_loss',count:1}
 const oldTime=BigInt(eventTime)-7200n*1000000000n
 await post('/api/porthole/v1/ingest/loss',{...loss,from:String(oldTime),through:String(oldTime+1n)},201)
 const outside=await post('/api/v1/health/tick',{})
 assert.equal(monitor(outside.state,created.id).status,'Firing','a loss outside the original evaluation window cannot poison current coverage')
 await post('/api/porthole/v1/ingest/loss',{...loss,from:eventTime,through:String(BigInt(eventTime)+1n)},201)
 const incomplete=await post('/api/v1/health/tick',{})
 assert.equal(monitor(incomplete.state,created.id).status,'Unknown','an overlapping source loss makes a real firing evaluation incomplete')
 assert.equal(monitor(incomplete.state,created.id).firingEpisode,firing.firingEpisode)
 await healthBrowser({origin,cookie,name:'health-notices-off'})
 console.log('Recovery public doors passed: durable ingest restart/replay, original event nanoseconds, firing-monitor analytical outage, preserved last-known evidence and firing episode, actual collector staleness, durable independent-notice episodes and local suppression; external mail acceptance remains unproved')
}


async function healthAccessJourney({origin,freshOwner,signIn}) {
 const cookie=await freshOwner(),readers=[]
 const health=async c=>{const response=await fetch(origin+'/api/v1/health',{headers:{cookie:c}});assert.equal(response.status,200);return response.json()}
 const post=(path,data,c=cookie)=>fetch(origin+path,form(origin,c,data))
 const scope={services:['synthetic-porthole-503'],environments:['production'],teams:['synthetic-porthole-505']}
 const roles=['admin','maintainer','responder','read-only analyst','finance reader','restricted contractor']
 for(const [i,role]of roles.entries()) {
  const email=`synthetic-porthole-${930+i}@example.com`
  assert.equal((await post('/app/settings/members/invite',{email,displayName:`Production ${role}`,role,scope:role==='admin'?{services:['*'],environments:['*'],teams:['*']}:scope})).status,202)
  const signed=await signIn(email)
  assert.equal((await fetch(origin+'/app/health',{headers:{cookie:signed}})).status,200,role)
  const state=await health(signed)
  const config={revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:email,confirm:'enable-independent-notices'}
  const changed=await post('/api/v1/health/configuration',config,signed)
  assert.equal(changed.status,role==='admin'?200:403)
  if(role==='admin') {
   assert.equal((await changed.json()).noticesEnabled,true,'admin own verified address enabled immediately')
   await healthBrowser({origin,cookie:signed,name:'health-admin-confirmed'})
  }
  readers.push({role,cookie:signed})
 }
 const email='synthetic-porthole-936@example.com'
 assert.equal((await post('/app/settings/members/invite',{email,displayName:'Staging responder',role:'responder',scope:{...scope,environments:['staging']}})).status,202)
 const staging=await signIn(email)
 for(const path of ['/api/v1/health','/app/health'])assert.equal((await fetch(origin+path,{headers:{cookie:staging}})).status,403)
 await healthBrowser({origin,cookie:staging,name:'health-out-of-scope',readOnly:true,expectedStatus:403,contains:'Your membership must cover production'})
 const state=await health(cookie)
 assert.equal((await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:false})).status,200)
 const disabled=await health(cookie)
 assert.equal(disabled.configuration.noticesEnabled,false)
 assert.match(disabled.components.find(row=>row.component==='delivery').reason,/Independent notices off.*incomplete coverage/)
 assert.equal(disabled.status,'Unknown')
 return readers
}

export async function healthBrowser({origin,cookie,name,readOnly=false,path='/app/health',contains,expectedStatus=200,dispatch}) {
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  if(dispatch)await context.route(origin+'/**',async route=>{
   const request=route.request(),response=await dispatch(request.url(),{method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})})
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
  })
  if(cookie)await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const response=await page.goto(origin+path);assert.equal(response.status(),expectedStatus)
  assert.ok(await page.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),'page images load from actual built assets')
  if(contains)assert.ok((await page.locator('body').innerText()).includes(contains))
  if(readOnly)assert.equal(await page.locator('form').count(),0)
  await page.keyboard.press('Tab')
  assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'health controls are keyboard reachable')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow')
  if(process.env.PORTHOLE_EVIDENCE_DIR) {await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`${name}-${width}.png`),fullPage:true})}
  assert.deepEqual(errors,[]);await context.close()
 }} finally {await browser.close()}
}

/** Actual emitted Worker with only the SendGrid HTTP edge replaced by its
 * documented 202/403 envelope. Schema: SendGrid v3 Mail Send, reviewed 2026-10-22,
 * https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 * No health, notice or evaluation results are faked. */
export async function recipientMailJourney(analyticalProof) {
 const {createRequire}=await import('node:module'),{readdir,readFile,mkdtemp,rm}=await import('node:fs/promises')
 const {resolve,join,extname}=await import('node:path'),{tmpdir}=await import('node:os'),{randomBytes,randomUUID}=await import('node:crypto')
 const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}))
 const {execFileSync}=await import('node:child_process')
 // Wrangler configures a process-wide HTTP dispatcher at import time. Parse
 // migrations in a child so the local runtime keeps its own dispatcher.
 console.log('Recipient fixture: parsing migrations')
 const sqlFiles=await Promise.all((await readdir('migrations/core')).filter(name=>name.endsWith('.sql')).sort().map(name=>readFile('migrations/core/'+name,'utf8')))
 const migrationPlans=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {unstable_splitSqlQuery as split} from 'wrangler';import {readFileSync} from 'node:fs';process.stdout.write(JSON.stringify(JSON.parse(readFileSync(0,'utf8')).map(split)))"],{input:JSON.stringify(sqlFiles),encoding:'utf8',stdio:['pipe','pipe','ignore']}))
 const {ownerSigninDigest}=await import('../../src/modules/operator-auth/owner-signin-grant.mjs')
 const {hashToken}=await import('../../src/modules/operator-auth/crypto.mjs')
 console.log('Recipient fixture: migrations parsed')
 const {createServer}=await import('node:net'),socket=createServer()
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve))
 const port=socket.address().port
 await new Promise(resolve=>socket.close(resolve))
 const origin=`https://127.0.0.1:${port}`,ownerEmail='synthetic-porthole-940@example.com',recipient='synthetic-porthole-941@example.com'
 const sessionSecret='synthetic-porthole-942-synthetic-porthole-942',setupToken='synthetic-porthole-943-synthetic-porthole-943'
 const scratch=await mkdtemp(join(tmpdir(),'porthole-recipient-')),messages=[]
 let providerStatus=202,mf,cookie
 const names=['index.js',...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>'assets/'+name)]
 const modules=await Promise.all(names.map(async name=>({type:'ESModule',path:resolve('dist/server',name),contents:await readFile('dist/server/'+name,'utf8')})))
 const options=convertV4MiniflareOptions({host:'127.0.0.1',port,https:true,name:'porthole',modules,modulesRoot:resolve('dist/server'),compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'recipient-proof'},resourcePersistencePath:join(scratch,'db'),r2Buckets:['ARCHIVE_BUCKET'],bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'false',OWNER_EMAIL:ownerEmail,SESSION_SECRET:sessionSecret,SETUP_TOKEN:setupToken,...analyticalProof?.bindings,MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-porthole-944',MAIL_FROM:'synthetic-porthole-945@example.com'},
  serviceBindings:{...analyticalProof?.services,ASSETS:async request=>{
   const path=new URL(request.url).pathname
   if(path.includes('..'))return new Response(null,{status:404})
   const types={'.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.js':'text/javascript'}
   try{return new Response(await readFile(resolve('dist/client','.'+path)),{headers:{'content-type':types[extname(path)]??'application/octet-stream'}})}catch{return new Response(null,{status:404})}
  }},
  outboundService:async request=>{
   assert.equal(request.url,'https://api.sendgrid.com/v3/mail/send');assert.equal(request.method,'POST')
   const message=await request.json();assert.equal(message.personalizations.length,1);assert.equal(message.personalizations[0].to.length,1)
   messages.push(message)
   return providerStatus===202?new Response(null,{status:202,headers:{'x-message-id':'synthetic-porthole-946'}}):Response.json({errors:[{message:'synthetic-porthole-948',field:null}]},{status:providerStatus})
  }})
 const call=(path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,host:new URL(origin).host,'cf-connecting-ip':'127.0.0.1'}})
 const post=async(path,data,status=200,acting=cookie)=>{const response=await call(path,form(origin,acting??'',data));assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()));return response}
 const health=async()=>{const response=await call('/api/v1/health',{headers:{cookie}});assert.equal(response.status,200);return response.json()}
 const configure=async(address=recipient,acting=cookie)=>{
  const state=await health()
  return (await post('/api/v1/health/configuration',{revision:state.configuration.revision,freshnessSeconds:60,noticesEnabled:!!address,...(address?{recipient:address,confirm:'enable-independent-notices'}:{})},200,acting)).json()
 }
 const tokenFrom=message=>{const text=message.content.find(row=>row.type==='text/plain').value;const match=text.match(/https:\/\/127\.0\.0\.1:\d+\/app\/health\/confirm\?token=([A-Za-z0-9_-]{43})/);assert.ok(match,'confirmation link delivered to the mail edge');return match[1]}
 const notices=()=>messages.filter(message=>message.custom_args.rer_delivery_id.startsWith('porthole-health/'))
 const browser=async(token,name,confirmed=false,expired=false)=>{
  const {chromium}=await import('@playwright/test')
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.route(origin+'/**',async route=>{
    const request=route.request(),response=await mf.dispatchFetch(request.url(),{method:request.method(),headers:{...request.headers(),host:new URL(origin).host,'cf-connecting-ip':'127.0.0.1'},...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})})
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
   })
   const page=await context.newPage(),response=await page.goto(origin+'/app/health/confirm?token='+token)
   assert.equal(response.status(),200);assert.ok(await page.getByRole('button',{name:'Confirm independent notices',exact:true}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`${name}-${width}.png`),fullPage:true})
   if(expired) {
    const failed=page.waitForResponse(response=>response.url().endsWith('/app/health/confirm') && response.request().method()==='POST')
    await page.getByRole('button',{name:'Confirm independent notices',exact:true}).click()
    assert.equal((await failed).status(),410);await page.getByRole('alert').waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`recipient-expired-${width}.png`),fullPage:true})
   }
   if(confirmed && width===390) {
    await page.getByRole('button',{name:'Confirm independent notices',exact:true}).click()
    await page.getByRole('heading',{name:'Independent notices confirmed',exact:true}).waitFor()
    if(process.env.PORTHOLE_EVIDENCE_DIR) {await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`recipient-confirmed-${width}.png`),fullPage:true});await page.setViewportSize({width:1440,height:900});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'recipient-confirmed-1440.png'),fullPage:true})}
   }
   await context.close()
  }} finally {await browser.close()}
 }
 try {
  console.log('Recipient fixture: starting emitted Worker')
  mf=new Miniflare(options)
  let db=await mf.getD1Database('DB')
  console.log('Recipient fixture: D1 ready')
  for(const statements of migrationPlans)await db.batch(statements.map(query=>db.prepare(query)))
  console.log('Recipient fixture: native bootstrap')
  const boot=await post('/auth/bootstrap',{token:setupToken,displayName:'Notice owner'},303,'')
  cookie=boot.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  await post('/api/v1/health/configuration',{revision:1,freshnessSeconds:60,noticesEnabled:true,recipient:ownerEmail,confirm:'enable-independent-notices'},403)
  const session=await (await call('/auth/session',{headers:{cookie}})).json()
  const token=randomBytes(32).toString('base64url'),now=Date.now()
  await db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(randomUUID(),await ownerSigninDigest(token),session.operator.id,session.operator.version,now,now+120000).run()
  const sign=await post('/auth/owner-signin',{token},303,'');cookie=sign.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  if(analyticalProof){
   await call('/setup',{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes'})
   await analyticalProof.run({origin,cookie,call,post,health,messages,ownerEmail,getDb:()=>db,restart:async()=>{await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB')},browser:(path,name,contains)=>healthBrowser({origin,cookie,path,name,contains,dispatch:(url,options)=>call(new URL(url).pathname+new URL(url).search,options)})})
   return
  }
  assert.equal((await configure(ownerEmail)).noticesEnabled,true)
  assert.equal(messages.length,0,'verified configurer needs no extra confirmation email')
  assert.equal((await configure()).noticesEnabled,false)
  assert.equal(messages.length,1,'other address receives exactly one confirmation request')
  assert.equal(messages[0].personalizations[0].to[0].email,recipient)
  const dispatch=(url,options)=>call(new URL(url).pathname+new URL(url).search,options)
  await healthBrowser({origin,cookie,name:'setup-recipient-pending',path:'/setup',contains:'Independent notices off — incomplete coverage',dispatch})
  const setup=await call('/setup',{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes'});assert.equal(setup.status,303)
  await healthBrowser({origin,cookie,name:'health-recipient-pending',contains:'Independent notices off — incomplete coverage',dispatch})
  const confirmation=tokenFrom(messages[0])
  const row=await db.prepare('SELECT * FROM porthole_health_recipients WHERE removed_at IS NULL').first()
  assert.equal(row.token_hash.length,64);assert.ok(!JSON.stringify(row).includes(confirmation))
  await db.exec('ALTER TABLE porthole_telemetry_records RENAME TO porthole_unavailable_records;')
  await post('/api/v1/health/tick',{})
  assert.equal(notices().length,0,'an unconfirmed recipient receives no outage notice')
  assert.equal((await health()).configuration.recipientStatus,'awaiting confirmation')
  for(const method of ['HEAD','GET','GET'])assert.equal((await call('/app/health/confirm?token='+confirmation,{method})).status,200)
  assert.equal((await health()).configuration.noticesEnabled,false,'mail scanner GET cannot confirm')
  await browser(confirmation,'recipient-confirm',true)
  assert.equal((await health()).configuration.noticesEnabled,true)
  await post('/app/health/confirm',{token:confirmation},410,'')
  await post('/api/v1/health/tick',{})
  assert.equal(notices().length,1,'confirmed recipient receives the actual outage submission')
  assert.equal(notices()[0].personalizations[0].to[0].email,recipient)
  await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB')
  assert.equal((await health()).configuration.noticesEnabled,true,'confirmation survives process restart')
  const firstNotice=notices()[0].custom_args.rer_delivery_id
  await post('/api/v1/health/tick',{})
  assert.equal(notices().filter(message=>message.custom_args.rer_delivery_id===firstNotice).length,1,'accepted notice is not resubmitted after restart')
  await configure();const replaced=tokenFrom(messages.at(-1))
  await configure(null)
  await post('/app/health/confirm',{token:replaced},410,'')
  assert.equal((await health()).configuration.noticesEnabled,false,'removed grant cannot be resurrected')
  const before=notices().length;await post('/api/v1/health/tick',{});assert.equal(notices().length,before)
  await configure();const expired=tokenFrom(messages.at(-1))
  await db.prepare('UPDATE porthole_health_recipients SET expires_at=? WHERE removed_at IS NULL').bind(Date.now()-1).run()
  await post('/app/health/confirm',{token:expired},410,'')
  await browser(expired,'recipient-stale-preview',false,true)
  providerStatus=403;await configure();providerStatus=202
  assert.equal((await health()).configuration.recipientStatus,'confirmation delivery failed')
  assert.equal((await health()).configuration.noticesEnabled,false)
  const adminEmail='synthetic-porthole-947@example.com'
  await post('/app/settings/members/invite',{email:adminEmail,displayName:'Notice admin',role:'admin',scope:{services:['*'],environments:['*'],teams:['*']}},202)
  const admin=await db.prepare('SELECT id,version FROM oa_operators WHERE email=?').bind(adminEmail).first()
  const adminToken=randomBytes(32).toString('base64url'),time=Date.now()
  await db.prepare(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at) VALUES(?,?,'invite',?,?,?,?, '/app',?,?)`).bind(randomUUID(),await hashToken(sessionSecret,'link',adminToken),admin.id,admin.version,session.operator.id,session.operator.version,time,time+120000).run()
  const adminSign=await post('/auth/confirm',{token:adminToken},303,'');const adminCookie=adminSign.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  assert.equal((await configure(adminEmail,adminCookie)).noticesEnabled,true)
  const adminTick=await (await post('/api/v1/health/tick',{},200,adminCookie)).json()
  assert.equal(adminTick.delivery.status,'accepted');assert.equal(notices().at(-1).personalizations[0].to[0].email,adminEmail)
  await db.prepare('UPDATE oa_sessions SET created_at=? WHERE operator_id=?').bind(Date.now()-360000,admin.id).run()
  await db.prepare('UPDATE oa_step_up_challenges SET consumed_at=? WHERE operator_id=?').bind(Date.now()-360000,admin.id).run()
  await post('/api/v1/health/configuration',{revision:(await health()).configuration.revision,freshnessSeconds:60,noticesEnabled:true,recipient:adminEmail,confirm:'enable-independent-notices'},403,adminCookie)
  await post('/app/settings/members/change',{operatorId:admin.id,role:'responder',scope:{services:['*'],environments:['production'],teams:['*']}})
  assert.equal((await health()).configuration.noticesEnabled,false,'demoted configurer cannot retain outbound authority')
  const afterDemotion=notices().length;await post('/api/v1/health/tick',{});assert.equal(notices().length,afterDemotion)
  const audit=await (await call('/api/v1/audit/export',{headers:{cookie}})).json()
  const committed=audit.records.map(row=>row.entry).filter(row=>row.phase==='committed')
  for(const action of ['health.recipient-grant','health.recipient-confirm','health.recipient-remove'])assert.ok(committed.some(row=>row.action===action),action)
  assert.equal(committed.filter(entry=>entry.action==='health.recipient-confirm'&&entry.entityRef===row.id).length,1,'single-use confirmation commits once')
  for(const value of [recipient,confirmation,replaced,expired])assert.ok(!JSON.stringify(audit).includes(value),'audit excludes address and bearer links')
  await db.exec('ALTER TABLE porthole_unavailable_records RENAME TO porthole_telemetry_records;')
  const {durableRecoveryJourney}=await import('./durable-recovery.mjs')
  await durableRecoveryJourney({origin,call,post,health,messages,ownerEmail,
   read:async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200);return response.json()},
   sql:statement=>db.exec(statement),
   restart:async()=>{await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB')},
   browser:name=>healthBrowser({origin,cookie,name,dispatch:(url,options)=>call(new URL(url).pathname+new URL(url).search,options)})})
  console.log('recipientMailJourney passed: real production Worker, own verified address, pending/confirmed/removed/expired grants, scanner-safe single use, admin delivery, live authority, restart deduplication, failure diagnostics and private audit; provider edge only, no live mailbox claim')
 } finally {await mf?.dispose();await rm(scratch,{recursive:true,force:true})}
}
