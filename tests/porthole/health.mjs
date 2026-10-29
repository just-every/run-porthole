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

export async function healthBrowser({origin,cookie,name,readOnly=false,path='/app/health',contains,expectedStatus=200,dispatch,exercise}) {
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
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
  if(exercise)await exercise(page,width)
  if(contains)for(const expected of Array.isArray(contains)?contains:[contains])assert.ok((await page.locator('body').innerText()).includes(expected),expected)
  if(readOnly)assert.equal(await page.locator('form').count(),0)
  assert.equal(await page.locator('button,a').evaluateAll(controls=>controls.filter(control=>!control.textContent.trim()).length),0,'the touched health screen has no icon-only controls')
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
 * Resend POST /emails uses its official OpenAPI SendEmailRequest/Response and
 * Idempotency-Key contract: https://github.com/resend/resend-openapi/blob/main/resend.yaml
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
 const origin=`https://127.0.0.1:${port}`,ownerEmail=analyticalProof?.ownerEmail??'synthetic-porthole-940@example.com',recipient='synthetic-porthole-941@example.com'
 const sessionSecret='synthetic-porthole-942-synthetic-porthole-942',setupToken='synthetic-porthole-943-synthetic-porthole-943'
 const scratch=await mkdtemp(join(tmpdir(),'porthole-recipient-')),messages=[]
 let receiptStatus=200,receiptFault,receiptReads=0,duringReceipt,receiptProbe
 let providerStatus=202,providerRetryAfter,providerFailure,mf,cookie,mailApiKey='synthetic-porthole-944'
 const acceptedMessages=[],provider=process.env.PORTHOLE_MAIL_PROVIDER??'sendgrid',idempotent=provider==='resend',providerAccepted=new Map(),providerIds=new Map()
 assert.ok(['sendgrid','resend'].includes(provider))
 const names=['index.js',...(await readdir('dist/server/assets')).filter(name=>name.endsWith('.js')).map(name=>'assets/'+name)]
 const modules=await Promise.all(names.map(async name=>({type:'ESModule',path:resolve('dist/server',name),contents:await readFile('dist/server/'+name,'utf8')})))
 const options=()=>convertV4MiniflareOptions({host:'127.0.0.1',port,https:true,name:'porthole',modules,modulesRoot:resolve('dist/server'),compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'recipient-proof'},resourcePersistencePath:join(scratch,'db'),r2Buckets:['ARCHIVE_BUCKET'],bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'false',OWNER_EMAIL:ownerEmail,SESSION_SECRET:sessionSecret,SETUP_TOKEN:setupToken,...analyticalProof?.bindings,MAIL_PROVIDER:provider,MAIL_API_KEY:mailApiKey,MAIL_FROM:'synthetic-porthole-945@example.com'},
  serviceBindings:{...analyticalProof?.services,ASSETS:async request=>{
   const path=new URL(request.url).pathname
   if(path.includes('..'))return new Response(null,{status:404})
   const types={'.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.js':'text/javascript'}
   try{return new Response(await readFile(resolve('dist/client','.'+path)),{headers:{'content-type':types[extname(path)]??'application/octet-stream'}})}catch{return new Response(null,{status:404})}
  }},
  outboundService:async request=>{
   if(idempotent && request.method==='GET') {
    receiptReads++
    assert.equal(request.headers.get('authorization'),'Bearer synthetic-porthole-944')
    const id=new URL(request.url).pathname.slice('/emails/'.length)
    assert.equal(request.url,'https://api.resend.com/emails/'+id)
    if(duringReceipt){const run=duringReceipt;duringReceipt=undefined;await run()}
    if(receiptFault==='timeout')throw Error('synthetic-porthole-1190')
    if(receiptStatus!==200)return Response.json({statusCode:receiptStatus,name:'validation_error',message:'synthetic-porthole-1191'},{status:receiptStatus,headers:receiptStatus===302?{location:'https://synthetic-porthole-1198.example/receipt'}:{}})
    const identity=[...providerIds].find(([,value])=>value===id)?.[0],wire=providerAccepted.get(identity)
    if(!wire)return Response.json({statusCode:404,name:'not_found',message:'synthetic-porthole-1192'},{status:404})
    const receipt={object:'email',id,...wire,cc:[],bcc:[],created_at:new Date().toISOString(),last_event:'sent'}
    if(receiptFault==='mismatch')receipt.subject='synthetic-porthole-1193'
    if(receiptFault==='recipient')receipt.to=['synthetic-porthole-1194@example.com']
    if(receiptFault==='extra-recipient')receipt.bcc=['synthetic-porthole-1194@example.com']
    if(receiptFault==='malformed')return new Response('{',{headers:{'content-type':'application/json'}})
    if(receiptFault==='oversized')return new Response('x'.repeat(65537))
    return Response.json(receipt)
   }
   assert.equal(request.url,idempotent?'https://api.resend.com/emails':'https://api.sendgrid.com/v3/mail/send');assert.equal(request.method,'POST')
   const wire=await request.json(),delivery=request.headers.get('idempotency-key')
   let message=wire
   if(idempotent) {
    assert.equal(typeof wire.from,'string');assert.equal(wire.to.length,1);assert.equal(typeof wire.to[0],'string')
    assert.ok(delivery&&delivery.length<=256)
    message={wire,idempotencyKey:delivery,personalizations:[{to:wire.to.map(email=>({email}))}],content:[{type:'text/plain',value:wire.text}],custom_args:{rer_delivery_id:delivery}}
   }
   assert.equal(message.personalizations.length,1);assert.equal(message.personalizations[0].to.length,1)
   messages.push(message)
   assert.equal(request.headers.get('authorization'),'Bearer synthetic-porthole-944')
   if(providerFailure==='before')throw Error('synthetic-porthole-952')
   if(providerStatus===202) {
    const identity=message.custom_args.rer_delivery_id
    if(!providerIds.has(identity))providerIds.set(identity,randomUUID())
    if(!idempotent||!providerAccepted.has(delivery))acceptedMessages.push(message)
    if(idempotent) {
     if(providerAccepted.has(delivery))assert.deepEqual(providerAccepted.get(delivery),wire,'a replay preserves the exact original provider payload')
     else providerAccepted.set(delivery,wire)
    }
   }
   if(providerFailure==='after')throw Error('synthetic-porthole-953')
   if(idempotent)return providerStatus===202?Response.json({id:providerIds.get(delivery)}):Response.json({statusCode:providerStatus,name:providerStatus===429?'rate_limit_exceeded':'restricted_api_key',message:'synthetic-porthole-948'},{status:providerStatus,headers:providerRetryAfter?{'retry-after':providerRetryAfter}:{}})
   return providerStatus===202?new Response(null,{status:202,headers:{'x-message-id':providerIds.get(message.custom_args.rer_delivery_id)}}):Response.json({errors:[{message:'synthetic-porthole-948',field:null}]},{status:providerStatus,headers:providerRetryAfter?{'retry-after':providerRetryAfter}:{}})
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
  const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
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
  mf=new Miniflare(options())
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
   await analyticalProof.run({origin,cookie,call,post,health,messages,ownerEmail,sessionSecret,getDb:()=>db,restart:async()=>{await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')},browser:(path,name,contains,acting=cookie,expectedStatus=200)=>healthBrowser({origin,cookie:acting,path,name,contains,expectedStatus,dispatch:(url,options)=>call(new URL(url).pathname+new URL(url).search,options)})})
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
  const registryPath='/app/settings/integrations'
  const registry=async()=>{const response=await call(registryPath,{headers:{cookie,accept:'application/json'}});assert.equal(response.status,200);return response.json()}
  const initialRegistry=await registry()
  assert.equal(initialRegistry.adapters.length,2)
  assert.ok(initialRegistry.adapters.every(row=>row.lastSuccess===null))
  assert.ok(!JSON.stringify(initialRegistry).includes(mailApiKey),'registry never releases a provider secret')
  assert.equal((await call(registryPath)).status,401)
  assert.equal((await call(registryPath,{headers:{cookie,authorization:'Bearer synthetic-porthole-956'}})).status,403)
  assert.equal((await call(registryPath,{headers:{cookie,'sec-fetch-site':'cross-site'}})).status,403)
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
  await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
  assert.equal((await health()).configuration.noticesEnabled,true,'confirmation survives process restart')
  const firstNotice=notices()[0].custom_args.rer_delivery_id
  await post('/api/v1/health/tick',{})
  assert.equal(notices().filter(message=>message.custom_args.rer_delivery_id===firstNotice).length,1,'accepted notice is not resubmitted after restart')
  // A documented 429 is proven unaccepted, including on non-idempotent
  // SendGrid. Preserve the same frozen notice and its real provider deadline.
  await configure(ownerEmail);providerStatus=429;providerRetryAfter='5'
  const rateStart=Date.now(),rateTick=await (await post('/api/v1/health/tick',{})).json()
  assert.equal(rateTick.delivery.status,'pending')
  const rateMessage=structuredClone(messages.at(-1)),rateDelivery=rateMessage.custom_args.rer_delivery_id,rateId=rateDelivery.slice('porthole-health/'.length)
  const rateNotice=(await health()).notices.find(row=>row.id===rateId)
  assert.equal(rateNotice.state,'pending');assert.equal(rateNotice.attempts,1);if(idempotent)assert.ok(rateNotice.first_attempt_at>=rateStart,'Resend preserves its original deduplication deadline');else assert.equal(rateNotice.first_attempt_at,null,'a definite refusal carries no uncertain-send marker')
  assert.ok(rateNotice.next_attempt_at>=rateStart+5000,'Retry-After is not shortened')
  await post('/api/v1/health/tick',{})
  assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===rateDelivery).length,1,'an early tick cannot resubmit the refused notice')
  await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
  assert.deepEqual((await health()).notices.find(row=>row.id===rateId),rateNotice,'restart preserves the rate-limit receipt and due time')
  await healthBrowser({origin,cookie,name:'health-notice-rate-limited',contains:['rate limit','Next attempt due: '+new Date(rateNotice.next_attempt_at).toISOString(),rateId],dispatch})
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,rateNotice.next_attempt_at-Date.now()+100)))
  providerStatus=202;providerRetryAfter=undefined
  for(let attempt=0;attempt<12&&(await health()).notices.find(row=>row.id===rateId).state!=='accepted';attempt++)await post('/api/v1/health/tick',{})
  assert.equal((await health()).notices.find(row=>row.id===rateId).state,'accepted')
  assert.equal((await health()).notices.find(row=>row.id===rateId).provider_id,providerIds.get(rateDelivery),'acceptance receipt retains the matching provider reference')
  const retries=messages.filter(row=>row.custom_args.rer_delivery_id===rateDelivery)
  assert.equal(retries.length,2);assert.deepEqual(retries[1],rateMessage,'safe retry keeps the original body and identity')
  assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===rateDelivery).length,1,'one accepted external effect after the explicit refusal')
  await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB');await post('/api/v1/health/tick',{})
  assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===rateDelivery).length,2,'accepted retry never resubmits across restart')
  const registryReceipt=(await registry()).adapters.find(row=>row.id===provider)
  assert.ok(registryReceipt.lastSuccess>=rateStart,'registry success is backed by the accepted provider receipt')
  assert.ok(!JSON.stringify(registryReceipt).includes(mailApiKey))
  await healthBrowser({origin,cookie,path:registryPath,name:'integration-declarations-'+provider,dispatch})

  console.log('noticeRateLimitJourney passed:',provider,'public configuration/tick, 429 Retry-After, frozen durable retry, restart, one accepted effect and 1440/390 states')
  if(idempotent) {
   await configure(ownerEmail);providerStatus=429;providerRetryAfter='1'
   await post('/api/v1/health/tick',{})
   const delivery=messages.at(-1).custom_args.rer_delivery_id,id=delivery.slice('porthole-health/'.length),receipt=(await health()).notices.find(row=>row.id===id)
   assert.equal(receipt.had_uncertain,0,'a definite refusal is not an unknown acceptance')
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,receipt.next_attempt_at-Date.now()+100)))
   providerStatus=401;providerRetryAfter=undefined
   for(let pass=0;pass<20&&(await health()).notices.find(row=>row.id===id).state!=='rejected';pass++)await post('/api/v1/health/tick',{})
   assert.equal((await health()).notices.find(row=>row.id===id).state,'rejected','a refusal after only definite refusals remains known unaccepted')
   assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,0)
  }
  for(const fault of [{name:'unauthorized',status:401},{name:'forbidden',status:403},{name:'lost-before',status:202,failure:'before'},{name:'lost-after',status:202,failure:'after'},...(idempotent?[{name:'lost-after-revoked',status:202,failure:'after'},{name:'lost-after-rotated',status:202,failure:'after'}]:[])]) {
   await configure(ownerEmail);providerStatus=fault.status;providerFailure=fault.failure
   const outcome=await (await post('/api/v1/health/tick',{})).json(),expected=fault.failure?(idempotent?'pending':'uncertain'):'rejected'
   assert.equal(outcome.delivery.status,expected)
   const message=messages.at(-1),delivery=message.custom_args.rer_delivery_id,id=delivery.slice('porthole-health/'.length)
   const receipt=(await health()).notices.find(row=>row.id===id)
   assert.equal(receipt.state,expected);assert.equal(receipt.attempts,1)
   const work=await (await call('/api/porthole/v1/follow-up',{headers:{cookie}})).json()
   assert.ok(work.tasks.some(task=>task.source==='notice:'+id&&task.state==='blocked'&&task.owner_id&&task.next_action.includes('original notice')),'provider refusal or uncertainty creates accountable original-send work')
   assert.equal(receipt.had_uncertain,fault.failure?1:0,'the receipt distinguishes unknown acceptance from definite refusal')
   const effects=fault.failure==='after'?1:0
   assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,effects)
   await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
   assert.deepEqual((await health()).notices.find(row=>row.id===id),receipt,'restart preserves the '+fault.name+' outcome')
   for(let pass=0;pass<3;pass++)await post('/api/v1/health/tick',{})
   assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,1,'no automatic retry after '+fault.name)
   assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,effects,'no duplicate external effect after '+fault.name)
   if(idempotent&&fault.failure) {
    // Wall time, with the original receipt untouched, crosses the actual retry
    // deadline. A revoked token after an unknown acceptance cannot undo it.
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,receipt.next_attempt_at-Date.now()+100)))
    providerFailure=undefined;providerStatus=fault.name==='lost-after-revoked'?401:202
    const rotated=fault.name==='lost-after-rotated'
    if(rotated){mailApiKey='synthetic-porthole-954';await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')}
    const final=fault.name==='lost-after-revoked'||rotated?'uncertain':'accepted'
    for(let pass=0;pass<20&&(await health()).notices.find(row=>row.id===id).state!==final;pass++)await post('/api/v1/health/tick',{})
    assert.equal((await health()).notices.find(row=>row.id===id).state,final)
    assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,rotated?1:2)
    assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,1,'one external effect across idempotent replay or subsequent revocation')
    await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
    for(let pass=0;pass<3;pass++)await post('/api/v1/health/tick',{})
    assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,rotated?1:2,'a reconciled or held notice does not retry again')
    if(rotated){const reads=receiptReads;await post('/app/settings/integrations/reconcile',{noticeId:id,providerId:providerIds.get(delivery),confirm:'verify-provider-receipt'},409);assert.equal(receiptReads,reads,'a rotated grant never reads a receipt from another account');assert.equal((await health()).components.find(row=>row.component==='delivery').evidence.configurationChanged,true);await healthBrowser({origin,cookie,name:'health-notice-rotated',contains:['Notice transport grant changed',id],dispatch});mailApiKey='synthetic-porthole-944';await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')}
   }
   if(fault.failure==='after'&&(!idempotent||fault.name==='lost-after-revoked'))await healthBrowser({origin,cookie,name:'health-notice-uncertain',contains:['Reconcile this notice with the provider',id],dispatch})
   if(idempotent&&fault.name==='lost-after-revoked') {
    const reconcilePath=registryPath+'/reconcile',providerId=providerIds.get(delivery)
    const data={noticeId:id,providerId,confirm:'verify-provider-receipt'};receiptProbe=data
    const reconcile=async(body=data,status=200,acting=cookie,extra={})=>{
     const response=await call(reconcilePath,{...form(origin,acting,body),headers:{...form(origin,acting,body).headers,accept:'application/json',...extra}})
     assert.equal(response.status,status,await response.clone().text());return response.json()
    }
    const successBefore=(await registry()).adapters.find(row=>row.id==='resend').lastSuccess
    const preserved=(await health()).notices.find(row=>row.id===id),effectsBefore=acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,sendsBefore=messages.filter(row=>row.custom_args.rer_delivery_id===delivery).length
    for(const [acting,extra] of [['',{}],[cookie,{authorization:'Bearer synthetic-porthole-1195'}],[cookie,{origin:'https://synthetic-porthole-1196.example'}],[cookie,{'sec-fetch-site':'cross-site'}]])await reconcile(data,acting?403:401,acting,extra)
    await reconcile({...data,providerId:'https://synthetic-porthole-1197.example'},400)
    await reconcile({...data,confirm:'no'},400)
    assert.equal(receiptReads,0,'unauthorized or invalid references never reach the provider')
    for(const status of [302,401,403,404,429]) {receiptStatus=status;const reads=receiptReads;await reconcile(data,status===429||status===302?503:422);assert.equal(receiptReads,reads+1,'provider reads never follow a redirect or retry automatically')}
    receiptStatus=200
    for(const failure of ['timeout','mismatch','recipient','extra-recipient','malformed','oversized']) {receiptFault=failure;await reconcile(data,failure==='timeout'?503:422)}
    receiptFault=undefined
    duringReceipt=()=>post('/auth/signout',{},204)
    await reconcile(data,401)
    assert.equal((await db.prepare('SELECT state FROM porthole_health_notices WHERE id=?').bind(id).first()).state,'uncertain','revocation during the provider read cannot commit acceptance')
    const nextToken=randomBytes(32).toString('base64url'),nextTime=Date.now()
    await db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(randomUUID(),await ownerSigninDigest(nextToken),session.operator.id,session.operator.version,nextTime,nextTime+120000).run()
    const nextSign=await post('/auth/owner-signin',{token:nextToken},303,'');cookie=nextSign.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    assert.deepEqual((await health()).notices.find(row=>row.id===id),preserved,'failed receipt verification preserves the entire held outcome')
    await healthBrowser({origin,cookie,path:registryPath,name:'integration-held-receipt',contains:['Reconcile held mail',id],dispatch})
    // Exercise the actual Settings form, with both responsive layouts captured.
    const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
    try {
     const context=await browser.newContext({viewport:{width:390,height:844}})
     await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
     await context.route(origin+'/**',async route=>{const request=route.request(),response=await dispatch(request.url(),{method:request.method(),redirect:'manual',headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
     const page=await context.newPage();await page.goto(origin+registryPath)
     const target=page.locator('form').filter({has:page.locator('input[name="noticeId"][value="'+id+'"]')})
     await target.getByLabel('Resend email ID').fill(providerId)
     await target.getByLabel('Verify this original provider receipt').check()
     const finished=page.waitForResponse(response=>response.url().endsWith('/reconcile')&&response.request().method()==='POST')
     await target.getByRole('button',{name:'Verify receipt',exact:true}).click();assert.equal((await finished).status(),303)
     await page.waitForURL(origin+registryPath);await context.close()
    } finally {await browser.close()}
    const reconciled=(await health()).notices.find(row=>row.id===id)
    assert.equal(reconciled.state,'accepted');assert.equal(reconciled.provider_id,providerId);assert.equal(reconciled.attempts,preserved.attempts)
    assert.equal((await registry()).adapters.find(row=>row.id==='resend').lastSuccess,successBefore,'verifying an old provider receipt cannot freshen the last submission time')
    const readCount=receiptReads
    assert.equal((await reconcile()).replayed,true);assert.equal(receiptReads,readCount,'duplicate owner submission performs no second provider read')
    await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
    assert.equal((await reconcile()).replayed,true);await post('/api/v1/health/tick',{})
    assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,sendsBefore,'receipt reconciliation and restart send no replacement email for the original notice')
    assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===delivery).length,effectsBefore,'one external effect for the original notice remains one')
    const audit=await (await call('/api/v1/audit/export',{headers:{cookie}})).json()
    const facts=audit.records.map(row=>row.entry).filter(row=>row.action==='integration.notice-reconcile'&&row.phase==='committed'&&row.entityRef===id)
    assert.equal(facts.length,1,'receipt acceptance has one atomic owner-attributed audit fact');assert.equal(facts[0].actorRef,session.operator.id)
    assert.ok(!JSON.stringify(audit).includes(providerId),'provider references stay out of the audit packet')
    await healthBrowser({origin,cookie,path:registryPath,name:'integration-reconciled-receipt',dispatch})
    console.log('noticeReceiptReconciliation passed: original-grant provider read, exact frozen payload, owner Settings form, no replacement send, fault refusals, duplicate submission, atomic private audit, restart and 1440/390 screens')
   }

  }
  providerStatus=429;providerFailure=undefined;providerRetryAfter='1';await configure(ownerEmail)
  await post('/api/v1/health/tick',{})
  const rotationDelivery=messages.at(-1).custom_args.rer_delivery_id,rotationId=rotationDelivery.slice('porthole-health/'.length),rotationReceipt=(await health()).notices.find(row=>row.id===rotationId)
  mailApiKey='synthetic-porthole-955';await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,rotationReceipt.next_attempt_at-Date.now()+100)))
  providerStatus=202;providerRetryAfter=undefined
  for(let pass=0;pass<20&&(await health()).notices.find(row=>row.id===rotationId).state!=='rejected';pass++)await post('/api/v1/health/tick',{})
  assert.equal((await health()).notices.find(row=>row.id===rotationId).state,'rejected','a changed grant cannot submit old known-unaccepted work')
  assert.equal(messages.filter(row=>row.custom_args.rer_delivery_id===rotationDelivery).length,1,'rotation performs no external retry under a different key')
  assert.equal(acceptedMessages.filter(row=>row.custom_args.rer_delivery_id===rotationDelivery).length,0)
  await healthBrowser({origin,cookie,name:'health-notice-rotated-unaccepted',contains:['Notice transport grant changed',rotationId],dispatch})
  mailApiKey='synthetic-porthole-944';await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')
  providerStatus=202;providerFailure=undefined
  console.log('noticeRotationJourney passed:',provider,'private grant binding, changed-key refusal, unchanged receipt identity and no cross-account retry')
  console.log('noticeRefusalJourney passed:',provider,'401/403 terminal outcomes, lost response before/after acceptance, durable restart, retained identity and bounded provider-safe replay or held uncertainty')
  const renewOwnerProof=async()=>{
   await post('/auth/step-up',{action:'export',returnTo:'/app/health'},202)
   const text=messages.at(-1).content.find(row=>row.type==='text/plain').value,proof=text.match(/[?&]token=([A-Za-z0-9_-]{43})/)
   assert.ok(proof,'the actual auth mail edge carries the new proof link')
   await post('/auth/confirm',{token:proof[1]},303)
  }
  await renewOwnerProof()
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
  if(receiptProbe){await post('/app/settings/integrations/reconcile',receiptProbe,403,adminCookie);assert.equal((await call(registryPath,{headers:{cookie:adminCookie}})).status,403,'admins cannot reconcile or read owner-only integration declarations')}
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
  await renewOwnerProof()
  const {durableRecoveryJourney}=await import('./durable-recovery.mjs')
  await durableRecoveryJourney({origin,call,post,health,messages,ownerEmail,
   read:async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200);return response.json()},
   sql:statement=>db.exec(statement),
   restart:async()=>{await mf.dispose();mf=new Miniflare(options());db=await mf.getD1Database('DB')},
   browser:name=>healthBrowser({origin,cookie,name,dispatch:(url,options)=>call(new URL(url).pathname+new URL(url).search,options)})})
  console.log('recipientMailJourney passed: real production Worker, own verified address, pending/confirmed/removed/expired grants, scanner-safe single use, admin delivery, live authority, restart deduplication, failure diagnostics and private audit; provider edge only, no live mailbox claim')
 } finally {await mf?.dispose();await rm(scratch,{recursive:true,force:true})}
}

/** Public native doors, retained Worker state and a pinned clock prove that
 * telemetry freshness and approval never replace original measured recovery. */
export async function followUpJourney({origin,freshOwner,signIn,restartWorker,withPinnedClock,withEmptyDestination,sql}) {
 let cookie=await freshOwner()
 const get=async path=>{const response=await fetch(origin+path,{headers:{cookie}});assert.equal(response.status,200,path);return response.json()}
 const post=async(path,data,status=200)=>{const response=await fetch(origin+path,form(origin,cookie,data));assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()));return response.json()}
 const work=()=>get('/api/porthole/v1/follow-up'),tick=()=>post('/api/v1/health/tick',{})
 for(const path of ['/app/follow-up','/app/settings/follow-up','/api/porthole/v1/follow-up'])assert.equal((await fetch(origin+path)).status,401)
 const scope={services:['synthetic-porthole-1500'],environments:['production'],teams:['synthetic-porthole-1501']}
 const session=await get('/auth/session'),owner=session.operator.id
 const credential=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1502',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
 const heartbeat=async()=>{const response=await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-1503',service:scope.services[0],environment:'production',team:scope.teams[0],signal:'logs'})});assert.equal(response.status,200)}
 const ingest=async(id,time)=>{
  const response=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+credential.secret,'content-type':'application/json','x-porthole-batch-id':id,'x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':'production'},body:JSON.stringify({resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team',value:{stringValue:scope.teams[0]}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(time)*1000000n),severityNumber:17,body:{stringValue:'synthetic-porthole-1504'}}]}]}]})})
  assert.equal(response.status,200);await post('/api/porthole/v1/ingest/drain',{})
 }
 const t=Date.now()
 await healthBrowser({origin,cookie,name:'follow-up-empty',path:'/app/follow-up',contains:'No due work yet.'})
 await healthBrowser({origin,cookie:'',name:'follow-up-unauthenticated',path:'/app/follow-up',expectedStatus:401})
 const config=await get('/api/v1/health');await post('/api/v1/health/configuration',{revision:config.configuration.revision,freshnessSeconds:10,noticesEnabled:false})
 const monitor=await post('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-1505',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:60}},201)
 await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:monitor.revision,confirm:'activate'})
 const repair=await post('/api/porthole/v1/objects',{kind:'repair',name:'synthetic-porthole-1506',scope,body:{steps:[{kind:'restart',target:'synthetic-porthole-1500',revision:'synthetic-porthole-1'}],expiresAt:t+3600000}},201)
 await withPinnedClock(t,async()=>{await heartbeat();await ingest('synthetic-porthole-1507',t);await tick()})
 let tasks=(await work()).tasks,task=tasks.find(row=>row.source===`monitor:${monitor.id}:1`)
 assert.ok(task&&task.owner_id===owner&&task.state==='blocked'&&task.due_at&&task.next_action)
 assert.ok(tasks.some(row=>row.source===`repair:${repair.id}:1`&&row.reason.includes('awaiting human approval')))
 await withPinnedClock(t+11000,async()=>{await tick();assert.ok((await work()).tasks.some(row=>row.source.startsWith('collector:')&&row.state==='blocked'))})
 await restartWorker();cookie=await freshOwner()
 assert.equal((await work()).tasks.find(row=>row.id===task.id).guard_revision,1)
 const collectorTask=(await work()).tasks.find(row=>row.source.startsWith('collector:'))
 await post('/api/porthole/v1/follow-up/review',{id:collectorTask.id,revision:collectorTask.revision,ownerId:owner,dueAt:t,nextAction:'Restore collector and original monitor',note:'Review exact scoped monitor as the recovery guard',reminders:'off',suppressedUntil:0,guardId:monitor.id,confirm:'review'})
 await post('/app/settings/members/invite',{email:'synthetic-porthole-1510@example.com',displayName:'Follow-up maintainer',role:'maintainer',scope},202)
 const memberCookie=await signIn('synthetic-porthole-1510@example.com'),member=(await (await fetch(origin+'/auth/session',{headers:{cookie:memberCookie}})).json()).operator.id
 cookie=await freshOwner()
 assert.equal((await fetch(origin+'/app/settings/follow-up',{headers:{cookie:memberCookie}})).status,403)
 const review=async(overrides={},status=200)=>{task=(await work()).tasks.find(row=>row.id===task.id);return post('/api/porthole/v1/follow-up/review',{id:task.id,revision:task.revision,ownerId:owner,dueAt:t,nextAction:'Inspect original recovery evidence',note:'Original monitor remains authoritative; dissent retained.',reminders:'on',suppressedUntil:0,confirm:'review',...overrides},status)}
 await review({dueAt:Number.MAX_SAFE_INTEGER},400)
 await post('/app/settings/members/invite',{email:'synthetic-porthole-1520@example.com',displayName:'Other team maintainer',role:'maintainer',scope:{...scope,services:['synthetic-porthole-1521']}},202)
 const otherCookie=await signIn('synthetic-porthole-1520@example.com'),other=(await (await fetch(origin+'/auth/session',{headers:{cookie:otherCookie}})).json()).operator.id
 cookie=await freshOwner();await review({ownerId:other},403)
 await review({ownerId:member,suppressedUntil:t+120000})
 const assigned=await (await fetch(origin+'/api/porthole/v1/follow-up',{headers:{cookie:memberCookie}})).json()
 assert.deepEqual(assigned.tasks.map(row=>row.id),[task.id],'assignee sees only their currently authorized scoped work')
 assert.equal((await fetch(origin+'/api/porthole/v1/follow-up/review',form(origin,memberCookie,{id:task.id}))).status,403)
 await post('/app/settings/members/remove',{operatorId:member},409)
 await withPinnedClock(t+12000,async()=>{await heartbeat();await ingest('synthetic-porthole-1511',t);await tick();assert.equal((await work()).events.filter(row=>row.task_id===task.id&&row.kind==='reminder').length,0)})
 await review({ownerId:owner})
 await post('/app/settings/members/remove',{operatorId:member})
 assert.equal((await fetch(origin+'/auth/session',{headers:{cookie:memberCookie}})).status,401)
 await withPinnedClock(t+13000,async()=>{await heartbeat();await ingest('synthetic-porthole-1512',t);await tick();await tick()})
 let snapshot=await work();assert.equal(snapshot.tasks.find(row=>row.id===task.id).state,'blocked','fresh telemetry does not resolve a still-firing original monitor')
 assert.equal(snapshot.events.filter(row=>row.task_id===task.id&&row.kind==='reminder').length,1)
 assert.ok(snapshot.events.some(row=>row.task_id===task.id&&row.kind==='review'&&row.detail.includes('dissent retained')))
 const stale=task.revision;await post('/api/porthole/v1/follow-up/review',{id:task.id,revision:stale-1,ownerId:owner,dueAt:t,nextAction:'synthetic-porthole-1513',note:'synthetic-porthole-1514',reminders:'off',confirm:'review'},409)
 await healthBrowser({origin,cookie,name:'follow-up-operations',path:'/app/operations',contains:['Follow-up','execution remains unavailable']})
 await healthBrowser({origin,cookie,name:'follow-up-blocked',path:'/app/follow-up',contains:['Follow-up','blocked','Inspect original recovery evidence']})
 await healthBrowser({origin,cookie,name:'follow-up-settings',path:'/app/settings/follow-up',contains:['Reminder settings and handover','Review assignment and reminders'],exercise:async page=>{const article=page.locator('[data-task-id="'+task.id+'"]');await article.locator('summary').click();assert.equal(await article.locator('select[name=reminders]').inputValue(),'on');await article.locator('textarea[name=note]').fill('Reviewed through the native settings form.');await article.locator('input[name=confirm]').check();const saved=page.waitForResponse(response=>response.url().endsWith('/app/settings/follow-up/review')&&response.request().method()==='POST');await article.getByRole('button',{name:'Save reviewed handover'}).click();assert.equal((await saved).status(),303);await page.waitForURL(origin+'/app/settings/follow-up');await page.locator('[data-task-id="'+task.id+'"] summary').click()}})
 await restartWorker();cookie=await freshOwner()
 await withPinnedClock(t+61000,async()=>{await heartbeat();await ingest('synthetic-porthole-1515',t);await tick()})
 snapshot=await work();assert.equal(snapshot.tasks.find(row=>row.id===collectorTask.id).state,'resolved','collector work also waits for the reviewed unchanged recovery guard');assert.equal(snapshot.tasks.find(row=>row.id===task.id).state,'resolved','only a measured zero on the unchanged 60-second monitor resolves')
 assert.equal(snapshot.events.filter(row=>row.task_id===task.id&&row.kind==='reminder').length,1,'restart cannot duplicate a reminder')
 await healthBrowser({origin,cookie,name:'follow-up-recovered',path:'/app/follow-up',contains:'Fresh measured recovery on the unchanged original monitor.'})
 await withPinnedClock(t+62000,async()=>{await heartbeat();await ingest('synthetic-porthole-1516',t+62000);await tick()})
 snapshot=await work();const recurrence=snapshot.tasks.find(row=>row.id===task.id)
 assert.equal(recurrence.state,'blocked');assert.equal(recurrence.generation,2);assert.equal(recurrence.owner_id,owner);assert.equal(recurrence.guard_revision,1)
 await post('/api/porthole/v1/objects',{id:monitor.id,revision:1,kind:'monitor',name:'synthetic-porthole-1505',scope,body:{signal:'logs',operator:'above',threshold:999,windowSeconds:60}},201)
 await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:2,confirm:'activate'})
 await withPinnedClock(t+63000,async()=>{await heartbeat();await ingest('synthetic-porthole-1517',t+63000);await tick()})
 assert.equal((await work()).tasks.find(row=>row.id===task.id).state,'blocked','weakened new definition cannot resolve the original work')
 await healthBrowser({origin,cookie,name:'follow-up-regression',path:'/app/follow-up',contains:['Recovery guard changed','generation 2']})
 await post('/app/settings/members/change',{operatorId:other,role:'maintainer',scope})
 await review({ownerId:other})
 await post('/app/settings/members/change',{operatorId:other,role:'maintainer',scope:{...scope,services:['synthetic-porthole-1521']}})
 const suspended=(await work()).tasks.find(row=>row.id===task.id)
 assert.equal(suspended.owner_id,null,'authority narrowing proceeds immediately and suspends assignment without transferring access')
 assert.equal(suspended.state,'blocked');assert.match(suspended.reason,/native owner review required/)
 await review({ownerId:owner})
 await withPinnedClock(t+301000,async()=>{await review({},403)})
 await restartWorker(()=>sql('ALTER TABLE porthole_follow_up RENAME TO porthole_follow_up_unavailable'))
 try{await healthBrowser({origin,cookie,name:'follow-up-unavailable',path:'/app/follow-up',expectedStatus:503,contains:'follow up unavailable'})}finally{await restartWorker(()=>sql('ALTER TABLE porthole_follow_up_unavailable RENAME TO porthole_follow_up'))}
 const {followUpArchiveJourney}=await import('./archive.mjs')
 await followUpArchiveJourney({origin,freshOwner,withEmptyDestination})
 console.log('Accountable follow-up passed: original monitor failure, stale collector, pending exact repair, restart, reviewed scope-safe handover before removal, suppressed and deduplicated in-app reminder, dissent, unchanged measured recovery, regression and changed-guard refusal at 1440 and 390.')
}

/** Native SLO definitions and reports use the emitted Worker and OTLP intake. */
export async function sloJourney({origin,freshOwner,signIn,restartWorker,withEmptyDestination}) {
 let cookie=await freshOwner()
 const root='/api/porthole/v1/slos'
 const post=async(path,data,status=200)=>{
  const response=await fetch(origin+path,form(origin,cookie,data))
  assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()))
  return response.json()
 }
 const get=async()=>{const r=await fetch(origin+root,{headers:{cookie}});assert.equal(r.status,200);return r.json()}
 assert.equal((await fetch(origin+root)).status,401)
 assert.equal((await fetch(origin+root,form('https://invalid.example',cookie,{}))).status,403)
 const scope={services:['synthetic-porthole-1800'],environments:['production'],teams:['synthetic-porthole-1801']}
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1802',class:'ingest',scope:{...scope,signals:['traces','metrics'],actions:['telemetry.write']}},201)
 const now=Date.now(),from=now-3600000,through=now-1000,time=now-10000
 const ns=ms=>String(BigInt(ms)*1000000n)
 const definition={type:'event-ratio',scope,sourceId:source.credential.id,targetPpm:990000,latencyMs:300,exclusions:[]}
 const create=async(d=definition,extra={})=>post(root,{name:'synthetic-porthole-1803',definition:d,confirm:'save-slo',...extra},201)
 const event=await create()
 const evaluate=async(slo=event,extra={})=>(await post(root+'/evaluate',{slos:[slo],from,through,...extra})).reports[0]
 const empty=await evaluate()
 assert.equal(empty.total,'0');assert.equal(empty.budget.consumed,null);assert.equal(empty.health,'Unknown')
 const resource={attributes:[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team',value:{stringValue:scope.teams[0]}}]}
 let sequence=1804
 const ingest=async(signal,records,drain=true)=>{
  const body=signal==='traces'?{resourceSpans:[{resource,scopeSpans:[{spans:records}]}]}:{resourceMetrics:[{resource,scopeMetrics:[{metrics:records}]}]}
  const response=await fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-'+sequence++,'x-porthole-team':scope.teams[0],'x-porthole-service':scope.services[0],'x-porthole-environment':'production'},body:JSON.stringify(body)})
  assert.equal(response.status,200,await response.clone().text())
  if(drain)await post('/api/porthole/v1/ingest/drain',{})
 }
 const span=(i,at,duration=100,code=0)=>({traceId:i.toString(16).padStart(32,'0'),spanId:i.toString(16).padStart(16,'0'),name:'synthetic-porthole-1805',kind:2,startTimeUnixNano:ns(at),endTimeUnixNano:ns(at+duration),status:{code}})
 await ingest('traces',[span(1,time),span(2,time,400),span(3,time,100,2),span(4,from-1),span(5,through)])
 let report=await evaluate()
 assert.equal(report.total,'3');assert.equal(report.good,'1');assert.equal(report.bad,'2')
 assert.deepEqual(report.budget.allowed,{numerator:'30000',denominator:'1000000'})
 assert.deepEqual(report.budget.remaining,{numerator:'-1970000',denominator:'1000000'})
 assert.deepEqual(report.budget.consumed,{numerator:'2000000',denominator:'30000'})
 assert.equal(report.coverage.status,'unverified');assert.equal(report.budget75,'crossed')
 const json=await post('/api/porthole/v1/reports/slo',{slos:[event],from,through})
 assert.deepEqual(json.reports[0],report)
 const csv=await fetch(origin+'/api/porthole/v1/reports/slo',form(origin,cookie,{slos:[event],from,through,format:'csv'}))
 assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/^text\/csv/)
 const csvText=await csv.text();assert.ok(csvText.includes('"1","3","2","30000","-1970000","1000000","unverified","Unknown","crossed"'))
 await ingest('traces',[span(6,from+1000)])
 report=await evaluate();assert.equal(report.total,'4');assert.equal(report.good,'2');assert.equal(report.coverage.lateRecords,1)
 const changed=await create({...definition,latencyMs:500},{...event})
 assert.equal(changed.revision,2)
 assert.equal((await evaluate(changed)).good,'3');assert.equal((await evaluate(event)).good,'2')
 await post(root,{name:'stale',definition,confirm:'save-slo',...event},409)
 const excluded=await create({...definition,exclusions:[{from:time,through:time+1,reason:'Reviewed maintenance interval'}]})
 const exclusion=await evaluate(excluded)
 assert.equal(exclusion.total,'1');assert.equal(exclusion.coverage.excludedRecords,3)
 await post(root,{name:'invalid',definition:{...definition,exclusions:[{from:time,through:time+2,reason:'a'},{from:time+1,through:time+3,reason:'b'}]},confirm:'save-slo'},400)
 const metricDefinition={...definition,type:'metric-ratio',latencyMs:null,goodMetric:'synthetic_porthole_good',totalMetric:'synthetic_porthole_total'}
 const metric=await create(metricDefinition)
 const point=(name,value,at=time)=>({name,sum:{aggregationTemporality:1,isMonotonic:true,dataPoints:[{startTimeUnixNano:ns(at-1000),timeUnixNano:ns(at),asInt:String(value)}]}})
 await ingest('metrics',[point(metricDefinition.goodMetric,'90071992547409930'),point(metricDefinition.totalMetric,'90071992547409931')])
 let m=await evaluate(metric)
 assert.equal(m.good,'90071992547409930');assert.equal(m.total,'90071992547409931');assert.equal(m.bad,'1')
 assert.equal(m.coverage.invalidRecords,0)
 await ingest('metrics',[point(metricDefinition.goodMetric,5,time+1000)])
 m=await evaluate(metric);assert.equal(m.total,'90071992547409931');assert.equal(m.coverage.status,'incomplete');assert.equal(m.coverage.invalidRecords,1);assert.equal(m.budget75,'Unknown')
 await ingest('metrics',[point(metricDefinition.goodMetric,2,time+2000),point(metricDefinition.totalMetric,1,time+2000)])
 m=await evaluate(metric);assert.equal(m.good,'90071992547409930');assert.equal(m.total,'90071992547409931')
 assert.equal(m.coverage.invalidRecords,3,'missing partner and both records of an impossible ratio are disclosed')
 assert.equal(m.budget75,'Unknown')
 await ingest('traces',[span(7,time+2000)],false)
 assert.equal((await evaluate()).coverage.status,'incomplete')
 await post('/api/porthole/v1/ingest/drain',{})
 assert.equal((await evaluate()).total,'5')
 const multi=await post('/api/porthole/v1/reports/slo',{slos:[event,metric],from,through})
 assert.equal(multi.reports.length,2);assert.equal(multi.reports[1].coverage.status,'incomplete')
 await post(root+'/evaluate',{slos:[event,event],from,through},400)
 await post(root+'/evaluate',{slos:[event],from,through:Date.now()+1000000},400)
 await post('/api/porthole/v1/reports/slo',{slos:[event],from,through,format:'pdf'},400)
 await post('/app/settings/members/invite',{email:'synthetic-porthole-1806@example.com',displayName:'Scoped SLO reader',role:'read-only analyst',scope:{...scope,services:['synthetic-porthole-1807']}},202)
 let other=await signIn('synthetic-porthole-1806@example.com')
 const forbidden=await fetch(origin+root+'/evaluate',form(origin,other,{slos:[event],from,through}))
 assert.equal(forbidden.status,403)
 const hidden=await fetch(origin+root,{headers:{cookie:other}})
 assert.equal((await hidden.json()).versions.length,0)
 assert.equal((await fetch(origin+root,form(origin,other,{name:'x',definition,confirm:'save-slo'}))).status,403)
 const reader=(await (await fetch(origin+'/auth/session',{headers:{cookie:other}})).json()).operator
 await post('/app/settings/members/change',{operatorId:reader.id,role:'read-only analyst',scope})
 other=await signIn('synthetic-porthole-1806@example.com')
 assert.equal((await fetch(origin+root+'/evaluate',form(origin,other,{slos:[event],from,through}))).status,200)
 await post('/app/settings/members/change',{operatorId:reader.id,role:'read-only analyst',scope:{...scope,services:['synthetic-porthole-1807']}})
 assert.equal((await fetch(origin+'/api/porthole/v1/reports/slo',form(origin,other,{slos:[event],from,through}))).status,401,'next-request revocation fences reports')
 await restartWorker();cookie=await freshOwner()
 assert.equal((await get()).versions.filter(row=>row.id===event.id).length,2)
 assert.equal((await evaluate(event)).total,'5')
 // Archive round-trip retains definitions as inert history in an independent
 // destination. No old owner or definition becomes active there.
 const {sloArchiveJourney}=await import('./archive.mjs')
 await sloArchiveJourney({origin,freshOwner,withEmptyDestination,sloId:event.id})
 console.log('Native SLO journey passed: event ratios, exact large integer delta sums, exclusions, no traffic, late data, revisions, pending intake, missing and impossible metric pairs, scoped refusal, restart, matching JSON and CSV, inactive archive restore.')
}

/** A real collector process stops and resumes against the emitted Worker.
 * Its machine identity and all receipt times come through authenticated intake.
 * Only the Worker clock is pinned; no heartbeat or evaluation rows are seeded. */
export async function hostHeartbeatJourney({origin,freshOwner,signIn,restartWorker,withPinnedClock,withEmptyDestination,sql}) {
 console.log('Host heartbeat: authenticated process and timing boundaries')
 const {fork}=await import('node:child_process'),{once}=await import('node:events'),{hostname}=await import('node:os')
 let cookie=await freshOwner(),collector
 const scope={services:['synthetic-porthole-6701'],environments:['production'],teams:['synthetic-porthole-6702']}
 const post=async(path,data,status=200,session=cookie)=>{const response=await fetch(origin+path,form(origin,session,data));assert.equal(response.status,status,await response.clone().text());return response.json()}
 const get=async(session=cookie)=>{const response=await fetch(origin+'/api/porthole/v1/monitors',{headers:{cookie:session}});assert.equal(response.status,200);return response.json()}
 const mint=await post('/app/settings/credentials/mint',{name:'Heartbeat process',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)
 const heartbeat={collectorId:'synthetic-porthole-6703',team:scope.teams[0],service:scope.services[0],environment:'production',signal:'logs'}
 const stop=async()=>{if(collector&&collector.exitCode===null&&collector.signalCode===null){const exited=once(collector,'exit');collector.kill('SIGTERM');await exited}collector=null}
 const start=async()=>{
  collector=fork(new URL('./collector-process.mjs',import.meta.url),[],{stdio:['pipe','pipe','pipe','ipc']})
  const ready=Promise.race([once(collector,'message').then(([message])=>message),once(collector,'exit').then(()=>{throw Error('host_collector_start_failed')})])
  collector.stdin.end(JSON.stringify({origin,secret:mint.secret,heartbeat,manual:true}))
  const receipt=await ready;assert.equal(receipt.hostId,hostname());return receipt
 }
 const beat=async()=>{const message=once(collector,'message');collector.send('beat');return (await message)[0]}
 const body={type:'host-heartbeat',hosts:[hostname(),'synthetic-porthole-never-registered'],signal:'logs',missedAfterSeconds:2,pendingSeconds:3,recoverySeconds:4}
 const monitor=await post('/api/porthole/v1/objects',{kind:'monitor',name:'Checkout host heartbeat',scope,body},201)
 await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:1,confirm:'activate'})
 const evaluate=async(expected,at)=>withPinnedClock(at,async()=>{
  const result=await post('/api/porthole/v1/monitors/evaluate',{id:monitor.id,revision:monitor.revision})
  const host=result.groups.find(group=>group.hostId===hostname()),never=result.groups.find(group=>group.hostId!==hostname())
  assert.equal(host.status,expected,JSON.stringify(host));assert.equal(never.status,'Unknown');assert.equal(never.sourceState,'never_registered')
  assert.equal(host.telemetryCoverage,'unestablished');assert.equal(host.delivery,'not_requested');return host
 })
 try {
  const t=Date.now()
  const initial=await withPinnedClock(t,start);assert.equal(Date.parse(initial.observedAt),t)
  await stop()
  assert.equal((await evaluate('Healthy',t+1999)).lastHeartbeatAt,t)
  const pending=await evaluate('Pending',t+2000);assert.equal(pending.conditionSince,t+2000)
  await restartWorker()
  assert.equal((await evaluate('Pending',t+4999)).conditionSince,pending.conditionSince,'restart preserves exact pending boundary')
  const firing=await evaluate('Firing',t+5000);assert.ok(firing.episode);assert.equal(firing.transitionAt,t+5000)
  await withPinnedClock(t+6000,start)
  await evaluate('Recovering',t+6000)
  for(const delta of [7000,8000,9000])await withPinnedClock(t+delta,beat)
  const recovering=await evaluate('Recovering',t+9999);assert.equal(recovering.recoverySince,t+6000);assert.equal(recovering.episode,firing.episode)
  await withPinnedClock(t+10000,beat)
  const healthy=await evaluate('Healthy',t+10000);assert.equal(healthy.episode,null);assert.equal(healthy.transitionAt,t+10000)
  assert.equal(healthy.observations.length,5,'all accepted recovery observations are reproducible')
  await stop()
  console.log('Host heartbeat: native Settings and evaluation screens')
  await hostHeartbeatBrowser({origin,cookie,body,monitor,scope})
  // The native form creates another inactive definition and changes an exact
  // revision. Configuration API changes use the same authority and validator.
  const changed=await post('/api/porthole/v1/objects',{kind:'monitor',id:monitor.id,revision:1,name:'Checkout heartbeat revised',scope,body:{...body,pendingSeconds:4}},201)
  assert.equal(changed.revision,2);monitor.revision=2
  await post('/api/porthole/v1/objects',{kind:'monitor',id:monitor.id,revision:1,name:'Stale edit',scope,body},409)
  await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:1,confirm:'activate'},409)
  await post('/api/porthole/v1/monitors/evaluate',{id:monitor.id,revision:1},409)
  await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:2,confirm:'activate'})
  const before=(await get()).monitors.find(row=>row.id===monitor.id)
  assert.deepEqual(before.versions.map(row=>row.revision),[2,1]);assert.deepEqual(before.versions[1].body,body)
  const configuration='/api/porthole/v1/configuration/monitors',apiKey=crypto.randomUUID()
  const apiBody={name:'Versioned API heartbeat',scope,body:{...body,hosts:[hostname()]}}
  const nativeApi=(path,method,data,headers={})=>fetch(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})})
  const apiCreated=await nativeApi(configuration,'POST',apiBody,{'idempotency-key':apiKey})
  assert.equal(apiCreated.status,201);const apiDefinition=await apiCreated.json()
  const replay=await nativeApi(configuration,'POST',apiBody,{'idempotency-key':apiKey})
  assert.equal(replay.status,201);assert.equal((await replay.json()).id,apiDefinition.id)
  const apiChanged=await nativeApi(configuration+'/'+apiDefinition.id,'PUT',{...apiBody,body:{...apiBody.body,pendingSeconds:4}},{'idempotency-key':crypto.randomUUID(),'if-match':apiCreated.headers.get('etag')})
  assert.equal(apiChanged.status,200);assert.equal((await apiChanged.json()).revision,2)
  const staleApi=await nativeApi(configuration+'/'+apiDefinition.id,'PUT',apiBody,{'idempotency-key':crypto.randomUUID(),'if-match':apiCreated.headers.get('etag')})
  assert.equal(staleApi.status,412)
  assert.deepEqual((await get()).monitors.find(row=>row.id===apiDefinition.id).versions.map(row=>row.revision),[2,1])
  // A foreign source cannot refresh the monitored group, and a caller cannot
  // move an already registered collector to another machine identity.
  const send=async(data,expected)=>{const response=await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:`Bearer ${mint.secret}`,'content-type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,expected);await response.text()}
  const count=()=>sql('SELECT COUNT(*) AS n FROM porthole_host_heartbeats')
  const previousCount=(await count())[0].n
  await send({...heartbeat,hostId:hostname(),service:'synthetic-porthole-foreign'},403)
  await send({...heartbeat,hostId:'synthetic-porthole-reassigned'},409)
  assert.equal((await count())[0].n,previousCount)
  const address=['synthetic-porthole-6709','example.com'].join(String.fromCharCode(64))
  await post('/app/settings/members/invite',{email:address,displayName:'Scoped heartbeat responder',role:'responder',scope},202)
  const responder=await signIn(address)
  assert.ok((await get(responder)).monitors.some(row=>row.id===monitor.id))
  await post('/api/porthole/v1/monitors/evaluate',{id:monitor.id,revision:2},403,responder)
  const foreignAddress=['synthetic-porthole-6710','example.com'].join(String.fromCharCode(64))
  await post('/app/settings/members/invite',{email:foreignAddress,displayName:'Other team',role:'read-only analyst',scope:{...scope,teams:['synthetic-porthole-foreign']}},202)
  const foreign=await signIn(foreignAddress)
  assert.deepEqual((await get(foreign)).monitors,[])
  assert.equal((await fetch(origin+'/api/porthole/v1/monitors')).status,401)
  const forged=await fetch(origin+'/api/porthole/v1/monitors/evaluate',{...form(origin,cookie,{id:monitor.id,revision:2}),headers:{...form(origin,cookie,{}).headers,origin:'https://synthetic-porthole.invalid'}})
  assert.equal(forged.status,403)
  // Missing heartbeat storage must never be interpreted as host absence.
  await restartWorker(()=>sql('ALTER TABLE porthole_host_heartbeats RENAME TO porthole_unavailable_heartbeats'))
  try {const unknown=await evaluate('Unknown',t+12000);assert.equal(unknown.sourceState,'storage_unavailable')}
  finally {await restartWorker(()=>sql('ALTER TABLE porthole_unavailable_heartbeats RENAME TO porthole_host_heartbeats'))}
  // Presence alone leaves the existing count-monitor coverage guard Unknown.
  const counted=await post('/api/porthole/v1/objects',{kind:'monitor',name:'Heartbeat is not traffic',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:60}},201)
  await post('/api/porthole/v1/objects/activate',{id:counted.id,revision:1,confirm:'activate'})
  await withPinnedClock(t+13000,start);await stop()
  const tick=await withPinnedClock(t+13000,()=>post('/api/v1/health/tick',{}))
  const countedOutcome=tick.state.components.find(row=>row.component==='monitor-evaluation').evidence.monitors.find(row=>row.monitorId===counted.id)
  assert.equal(countedOutcome.status,'Unknown');assert.equal(countedOutcome.observedCount,null)
  assert.equal(tick.state.status,'Unknown','heartbeat presence cannot establish overall health')
  // Revocation rejects the real process on its next authenticated write and
  // makes the registered host Unknown rather than Firing or recovered.
  const credentials=await (await fetch(origin+'/app/settings/credentials',{headers:{cookie}})).text()
  assert.ok(credentials.includes('Heartbeat process'))
  await post('/app/settings/credentials/revoke',{id:mint.credential.id,revision:mint.credential.revision})
  await send({...heartbeat,hostId:hostname()},401)
  const revoked=await evaluate('Unknown',t+16000);assert.equal(revoked.sourceState,'source_unavailable')
  assert.equal((await count())[0].n,previousCount+1)
  console.log('Host heartbeat: inactive archive transfer')
  const {hostHeartbeatArchiveJourney}=await import('./archive.mjs')
  await hostHeartbeatArchiveJourney({origin,freshOwner,withEmptyDestination,monitorId:monitor.id})
  console.log('Host heartbeat journey passed: real process loss and return, exact per-host windows, pending restart, current authority, storage failure, native configuration and inactive archive')
 } finally {await stop()}
}

async function hostHeartbeatBrowser({origin,cookie,body,monitor,scope}) {
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
  const page=await context.newPage()
  await page.goto(origin+'/app/settings/monitors')
  if(width===1440) {
   const editor=page.locator('form').filter({has:page.getByRole('button',{name:'Save inactive heartbeat monitor',exact:true})})
   for(const [label,value]of Object.entries({Name:'Native heartbeat form',Service:scope.services[0]+',synthetic-porthole-6711',Environment:'production',Team:scope.teams[0],'Host identities':body.hosts[0],'Missed after seconds':'2','Pending seconds':'3','Recovery seconds':'4'}))await editor.getByLabel(label,{exact:true}).fill(value)
   await Promise.all([page.waitForURL('**/app/settings/monitors'),editor.getByRole('button',{name:'Save inactive heartbeat monitor',exact:true}).click()])
   const created=page.locator('article').filter({has:page.getByRole('heading',{name:'Native heartbeat form',exact:true})})
   assert.ok((await created.innerText()).includes('inactive'))
   const definitions=await (await page.request.get(origin+'/api/porthole/v1/monitors')).json()
   assert.deepEqual(definitions.monitors.find(row=>row.name==='Native heartbeat form').scope.services,[scope.services[0],'synthetic-porthole-6711'])
   await created.getByLabel('Activate this exact revision').check()
   await Promise.all([page.waitForURL('**/app/settings/monitors'),created.getByRole('button',{name:'Activate heartbeat monitor',exact:true}).click()])
   assert.ok((await page.locator('article').filter({has:page.getByRole('heading',{name:'Native heartbeat form',exact:true})}).innerText()).includes('active'))
   const revised=page.locator('article').filter({has:page.getByRole('heading',{name:'Native heartbeat form',exact:true})})
   await revised.locator('summary').click()
   await revised.getByLabel('Pending seconds',{exact:true}).fill('4')
   await revised.getByRole('button',{name:'Save new heartbeat revision',exact:true}).click()
   assert.ok((await page.locator('article').filter({has:page.getByRole('heading',{name:'Native heartbeat form',exact:true})}).innerText()).includes('Revision 2'))
   const updated=await (await page.request.get(origin+'/api/porthole/v1/monitors')).json()
   assert.deepEqual(updated.monitors.find(row=>row.name==='Native heartbeat form').scope.services,[scope.services[0],'synthetic-porthole-6711'])
   assert.equal(await page.locator('button,a').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).length),0)
   assert.ok(await page.locator('input,button').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=13)))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`heartbeat-settings-${width}.png`),fullPage:true})}
  await page.goto(origin+'/app/monitors')
  if(width===1440){const text=await page.locator('body').innerText();assert.ok(text.includes('Checkout host heartbeat'));assert.ok(text.includes('Healthy'));assert.ok(text.includes('Unknown'));assert.ok(text.includes('never registered'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`heartbeat-evaluations-${width}.png`),fullPage:true})
  await context.close()
 }}finally {await browser.close()}
}
