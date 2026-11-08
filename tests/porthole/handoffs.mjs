import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,readdir,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal} from './fixture.mjs'
const root='/api/porthole/v1/handoffs',packets='/api/porthole/v1/service-evidence'
const names=[['vane','Vane'],['linen','Linen'],['evidence','Evidence'],['vantage','Vantage'],['cloudzero','CloudZero'],['splunk-es','Splunk Enterprise Security'],['datadog-cloud-siem','Datadog Cloud SIEM'],['datadog-ci-visibility','Datadog CI Visibility'],['datadog-test-optimization','Datadog Test Optimization'],['datadog-data-jobs','Datadog Data Jobs Monitoring'],['datadog-data-streams','Datadog Data Streams Monitoring'],['stream-specialist','Selected stream specialist']]
const encodedName=['checkout','blue'].join('/')
const allFields=['identity','metadata','observedRed','coverage','freshness','traceReferences','logReferences']
const canonical=value=>JSON.stringify(sort(value))
const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,sort(v)])):value
export async function handoffJourney({origin,freshOwner,signIn,sql,call=(path,options)=>fetch(origin+path,options),service,query,ownerCookie,responders,bearer,dispatch,withPinnedClock}) {
 let cookie=ownerCookie??await freshOwner()
 const send=async(path,data,status=200,acting=cookie,extra={})=>{const options=form(origin,acting,data),response=await call(path,{...options,headers:{...options.headers,...extra}});assert.equal(response.status,status,await response.clone().text());return response.json()}
 const read=async(path,acting=cookie,status=200)=>{const response=await call(path,{headers:{cookie:acting}});assert.equal(response.status,status,await response.clone().text());return response.json()}
 const storage=()=>sql("SELECT 'handoffs' AS kind,json_array(product,revision,destination,template,author_ref,created_at,state) AS value FROM porthole_handoff_versions UNION ALL SELECT 'packets',json_array(id,owner_ref,owner_revision,selection,snapshot,captured_at,digest,state,approved_at) FROM porthole_service_packets UNION ALL SELECT 'grants',json_array(operator_id,role,scope,revision) FROM porthole_members ORDER BY kind,value")
 const denied=async(path,data,status=403,acting=cookie,headers={})=>{const before=await storage();await send(path,data,status,acting,headers);assert.deepEqual(await storage(),before,'refused handoff or packet action leaves both domains unchanged')}
 assert.equal((await call('/app/help')).status,401)
 await handoffBrowser({origin,cookie,path:'/app/help',contains:'No handoffs configured',name:'handoffs-empty',dispatch})
 for(const [id]of names){
  const destination='https://handoff.example/'+id,template=destination+'/service/{service}?environment={environment}&from={from}&through={through}'
  const saved=await send(root+'/'+id,{revision:0,destination,template,confirm:'save-handoff'},201)
  assert.equal(saved.revision,1)
 }
 const configured=await read(root);assert.equal(configured.handoffs.length,names.length)
 const encodingSource=await send('/app/settings/credentials/mint',{name:'synthetic-porthole-8506',class:'ingest',scope:{services:[encodedName],environments:['production'],teams:['commerce'],signals:['traces'],actions:['telemetry.write']}},201)
 const encoded=await encodedService({origin,call,secret:encodingSource.secret});await send('/api/porthole/v1/ingest/drain',{})
 const encodedView=await read('/api/porthole/v1/services?'+new URLSearchParams(encoded)),encodedRecord=encodedView.services.find(row=>row.service===encodedName)
 assert.ok(encodedRecord,'actual stock producer exposes the encoded service through native Services')
 for(const link of encodedRecord.handoffs){const url=new URL(link.href);assert.ok(url.pathname.endsWith('/checkout%2Fblue'));assert.equal(url.searchParams.get('environment'),'production');assert.equal(url.searchParams.get('from'),encoded.from);assert.equal(url.searchParams.get('through'),encoded.through)}
 assert.equal((await call('/api/porthole/v1/services/'+encodedRecord.id+'?'+new URLSearchParams(encoded),{headers:{cookie:responders[0].cookie}})).status,404,'an out-of-scope encoded service has no handoff door')
 await send('/app/settings/credentials/revoke',{id:encodingSource.credential.id})
 const change={revision:1,destination:'https://handoff.example/vane',template:'https://handoff.example/vane/service/{service}?environment={environment}&from={from}&through={through}',confirm:'save-handoff'}
 for(const destination of ['http://handoff.example','javascript:alert(1)',['https://synthetic-porthole-1:synthetic-porthole-2','handoff.example/'].join(String.fromCharCode(64)),'https://handoff.example/?token=synthetic-porthole-1','https://handoff.example/%0a','https://handoff.example/%250d','https://handoff.example/?api_key=synthetic-porthole-1','https://handoff.example/#credential','https://handoff.example/\\evil'])await denied(root+'/vane',{...change,destination},400)
 for(const template of ['https://handoff.example/{team}','https://{service}.example/','https://different.example/{service}','http://handoff.example/{service}'])await denied(root+'/vane',{...change,template},400)
 await denied(root+'/vane',{...change,revision:0},409)
 await denied(root+'/vane',change,403,cookie,{authorization:'Bearer '+bearer})
 await denied(root+'/vane',change,403,cookie,{origin:'https://foreign.example'})
 for(const reader of responders)await denied(root+'/vane',change,403,reader.cookie)
 const maintainerAddress=['synthetic-porthole-8500','example.com'].join(String.fromCharCode(64))
 await send('/app/settings/members/invite',{email:maintainerAddress,displayName:'Handoff maintainer',role:'maintainer',scope:{services:['checkout'],environments:['production'],teams:['commerce']}},202)
 const maintainer=await signIn(maintainerAddress);cookie=await freshOwner()
 await denied(root+'/vane',change,403,maintainer)
 if(withPinnedClock){await withPinnedClock(Date.now()+301000,async()=>{await denied(root+'/vane',change,403);await handoffBrowser({origin,cookie,path:'/app/settings/integrations/handoffs',contains:'Handoff settings',name:'handoffs-settings',dispatch})})}
 const window=new URLSearchParams(query),from=BigInt(window.get('from')).toString().padStart(20,'0'),through=BigInt(window.get('through')).toString().padStart(20,'0')
 for(const reader of [{cookie,serviceId:service.id}, {cookie:maintainer,serviceId:service.id},...responders]){
  for(const path of ['/app/help','/app/integrations','/app/services/'+reader.serviceId+query]){
   const response=await call(path,{headers:{cookie:reader.cookie}});assert.equal(response.status,200)
   const html=await response.text()
   for(const [id]of names){
    const expected=path.startsWith('/app/services/')?'https://handoff.example/'+id+'/service/'+encodeURIComponent(reader.serviceId===service.id?'checkout':'fulfillment')+'?environment=production&from='+from+'&through='+through:'https://handoff.example/'+id
    assert.ok(html.includes(expected.replaceAll('&','&#38;'))||html.includes(expected.replaceAll('&','&amp;')),path+' has exact encoded external target '+id)
   }
   if(reader.serviceId!==service.id)assert.ok(!html.includes('service/checkout'),'foreign service values cannot enter a handoff')
  }
 }
 const privateIntegrations=await call('/app/settings/integrations',{headers:{cookie}});assert.equal(privateIntegrations.status,200);assert.ok((await privateIntegrations.text()).includes('/app/settings/integrations/handoffs'))
 await handoffBrowser({origin,cookie,path:'/app/help',contains:'Neighboring products',name:'help-configured',dispatch,follow:true})
 await handoffBrowser({origin,cookie:maintainer,path:'/app/integrations',contains:'Neighboring products',name:'integrations-configured',dispatch,follow:true})
 await handoffBrowser({origin,cookie:responders[0].cookie,path:'/app/services/'+service.id+query,contains:'Neighboring products',name:'service-handoffs',dispatch,follow:true})
 await handoffBrowser({origin,cookie,path:'/app/settings/integrations/handoffs',contains:'Handoff settings',name:'handoffs-settings',dispatch,edit:true})
 cookie=await freshOwner()
 const selected={serviceId:service.id,from,through,metadataRevision:service.metadata.revision,externalReference:'synthetic-porthole-8501',fields:allFields}
 const preview=await send(packets,selected,201)
 assert.equal(preview.packet.externalReference,selected.externalReference)
 assert.deepEqual(preview.packet.fields.identity,{id:service.id,service:'checkout',environment:'production',team:'commerce',versions:service.versions})
 assert.deepEqual(preview.packet.fields.metadata,{revision:service.metadata.revision,ownerRef:service.metadata.owner_ref,criticality:service.metadata.criticality,repository:service.metadata.repository,runbook:service.metadata.runbook,reviewedAt:service.metadata.created_at,state:'active'})
 for(const name of ['requests','errors','requestsPerSecond','p50Ns','p95Ns','p99Ns'])assert.equal(preview.packet.fields.observedRed[name],service.summary[name])
 assert.equal(preview.packet.fields.coverage.fullTraffic,false);assert.equal(preview.packet.fields.coverage.partnerRecovery,'not-measured')
 assert.ok(preview.packet.fields.coverage.missing.length)
 assert.ok(preview.packet.fields.traceReferences.length>36,'real producer traces are resolved, not an empty-list proof')
 assert.equal(preview.packet.fields.logReferences.length,36,'all source-counted stock logger records belong to the packet')
 for(const [signal,key]of [['traces','traceReferences'],['logs','logReferences']]){
  const native=[],params=new URLSearchParams({signal,service:'checkout',environment:'production',team:'commerce',from,through,snapshot:String(preview.packet.snapshot),limit:'200'})
  let cursor=null
  do{if(cursor)params.set('cursor',cursor);const page=await read('/api/porthole/v1/ingest/records?'+params);native.push(...page.records);cursor=page.cursor}while(cursor)
  assert.deepEqual(preview.packet.fields[key],native.map(r=>({recordId:r.id,timeNs:r.event_time_ns,...(r.trace_id?{traceId:r.trace_id}:{}),...(r.span_id?{spanId:r.span_id}:{})})), 'every packet reference matches currently scoped native '+signal)
 }

 assert.equal(preview.digest,createHash('sha256').update(canonical(preview.packet)).digest('hex'))
 const text=canonical(preview.packet)
 for(const forbidden of ['fulfillment','payload','attributes','author_ref','body','secret',bearer])assert.ok(!text.includes(forbidden),'packet excludes non-allowlisted or foreign data: '+forbidden)
 await denied(packets,{...selected,metadataRevision:selected.metadataRevision-1},409)
 await denied(packets,{...selected,fields:[...allFields,'payload']},400)
 await denied(packets,{...selected,externalReference:'https://credential.example/?token=synthetic-porthole-1'},400)
 for(const reader of [maintainer,...responders.map(r=>r.cookie)]){await denied(packets,selected,403,reader);assert.equal((await call(packets+'/'+preview.id+'/download',{headers:{cookie:reader}})).status,403)}
 assert.equal((await call(packets+'/'+preview.id+'/download',{headers:{cookie,authorization:'Bearer '+bearer}})).status,403)
 await denied(packets,selected,403,cookie,{authorization:'Bearer '+bearer})
 await denied(packets+'/'+preview.id+'/approve',{confirm:preview.id,digest:'0'.repeat(64)},409)
 assert.equal((await call(packets+'/'+preview.id+'/download',{headers:{cookie}})).status,409)
 await handoffBrowser({origin,cookie,path:'/app/services/evidence/'+preview.id,contains:'Review exact packet',name:'evidence-preview',dispatch,approve:true})
 const download=await call(packets+'/'+preview.id+'/download',{headers:{cookie}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/)
 const downloaded=await download.json();assert.equal(downloaded.digest,preview.digest);assert.deepEqual(downloaded.packet,preview.packet)
 const scopedAddress=['synthetic-porthole-8505','example.com'].join(String.fromCharCode(64))
 await send('/app/settings/members/invite',{email:scopedAddress,displayName:'Scoped evidence owner',role:'owner',scope:{services:['checkout'],environments:['production'],teams:['commerce']}},202)
 const scopedCookie=await signIn(scopedAddress),scopedActor=(await read('/auth/session',scopedCookie)).operator
 cookie=await freshOwner()
 const scoped=await send(packets,selected,201,scopedCookie)
 for(const key of ['identity','metadata','observedRed','coverage','traceReferences','logReferences'])assert.deepEqual(scoped.packet.fields[key],preview.packet.fields[key],'current scoped owner gets only the same one-service allowlist')
 await send(packets+'/'+scoped.id+'/approve',{confirm:scoped.id,digest:scoped.digest},200,scopedCookie)
 await send('/app/settings/members/change',{operatorId:scopedActor.id,role:'owner',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}})
 assert.equal((await call(packets+'/'+scoped.id+'/download',{headers:{cookie:scopedCookie}})).status,401,'revoked owner session cannot reuse packet approval')
 const renewed=await signIn(scopedAddress);cookie=await freshOwner()
 assert.equal((await call(packets+'/'+scoped.id+'/download',{headers:{cookie:renewed}})).status,409,'new session cannot resurrect approval from the prior owner scope revision')
 await denied(packets,selected,404,renewed)
 const selectedOnly=await send(packets,{...selected,fields:['identity']},201)
 assert.deepEqual(Object.keys(selectedOnly.packet.fields),['identity'],'owner-selected allowlist omits all other fields')
 await send(packets+'/'+selectedOnly.id+'/cancel',{confirm:selectedOnly.id,digest:selectedOnly.digest})
 await send(packets+'/'+preview.id+'/cancel',{confirm:preview.id,digest:preview.digest})
 assert.equal((await call(packets+'/'+preview.id+'/download',{headers:{cookie}})).status,409)
 await handoffBrowser({origin,cookie,path:'/app/services/evidence/'+preview.id,contains:'cancelled',name:'evidence-cancelled',dispatch})
 const pending=await send(packets,selected,201)
 await send(packets+'/'+pending.id+'/approve',{confirm:pending.id,digest:pending.digest})
 const history={id:pending.id,digest:pending.digest,selection:selected,packet:pending.packet}
 assert.equal((await sql("SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='handoffs.revise' AND json_extract(entry,'$.phase')='committed'"))[0].n,names.length+1)
 console.log('PROBE PORT-054 handoffs: Help, Integrations and native runtime service -> all named siblings and partners with exact encoded scoped values; malicious, bearer, non-owner, stale and foreign writes refuse unchanged')
 console.log('PROBE PORT-054 packet: current native owner preview, exact digest approval, download and cancellation -> native metadata and RED match; scoped references resolve; non-allowlisted fields, other teams and unauthorized writes absent')
 return history
}

export async function handoffBrowser({origin,cookie='',path,contains,name,dispatch,status=200,follow=false,edit=false,approve=false}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,executablePath:process.env.PORTHOLE_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  if(cookie)await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  if(dispatch)await context.route(origin+'/**',async route=>{const r=route.request(),response=await dispatch(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:r.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
  const page=await context.newPage(),response=await page.goto(origin+path)
  assert.equal(response.status(),status);assert.ok((await page.locator('body').innerText()).includes(contains))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'handoff screens reflow')
  assert.ok(await page.locator('main').evaluate(node=>[...node.querySelectorAll('p,a,button,label,input,select,dt,dd,li,pre,code')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)))
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement?.tagName==='A'))
  assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0)
  if(follow){let count=0;await context.route('https://handoff.example/**',async route=>{const request=route.request();assert.ok(!request.headers().authorization&&!request.headers().cookie&&!request.headers().referer,'plain external navigation carries no authority');count++;await route.fulfill({status:401,body:'Destination permission required'})});for(const [,name]of names){await page.getByRole('link',{name:'Open '+name,exact:true}).click();assert.match(await page.locator('body').innerText(),/Destination permission required/);await page.goto(origin+path)}assert.equal(count,names.length)}
  if(edit){const form=page.locator('form').first(),stale=await context.newPage();await stale.goto(origin+path);await form.locator('input[name="confirm"]').check();await form.getByRole('button').click();assert.match(await page.locator('body').innerText(),/Revision 2/);await stale.locator('form').first().locator('input[name="confirm"]').check();const response=stale.waitForResponse(r=>r.request().method()==='POST');await stale.locator('form').first().getByRole('button').click();assert.equal((await response).status(),409);assert.match(await stale.locator('body').innerText(),/handoff revision changed/);await stale.close()}
  if(approve){await page.getByLabel('Approve this exact packet and external reference').check();await page.getByRole('button',{name:'Approve packet',exact:true}).click();assert.match(await page.locator('body').innerText(),/State: approved/);assert.equal(await page.getByRole('link',{name:'Download approved packet',exact:true}).count(),1)}
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?900:844});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,name+'-'+width+'.png'),fullPage:true})}}
  await context.close()
 }finally{await browser.close()}
}

export async function routeInventory({origin,cookie,call=(path,options)=>fetch(origin+path,options),site}) {
 const forbidden=['/app/marketing/funnels','/app/cmdb','/app/security/cases','/app/cloud/bills','/app/compliance/programs','/api/porthole/v1/marketing/funnels','/api/porthole/v1/cmdb','/api/porthole/v1/security/cases','/api/porthole/v1/cloud/bills','/api/porthole/v1/compliance/programs']
 for(const path of forbidden)for(const method of ['GET','POST']){const response=await call(path,{method,redirect:'manual',headers:{cookie,origin}});assert.equal(response.status,404,'running router refuses neighboring-product workflow '+path+' '+method)}
 const schemaResponse=await call('/api/porthole/v1/openapi.json',{headers:{cookie}});assert.equal(schemaResponse.status,200);const schema=await schemaResponse.json()
 const productPaths=Object.keys(schema.paths)
 assert.ok(productPaths.includes('/api/porthole/v1/handoffs')&&productPaths.includes('/api/porthole/v1/service-evidence'))
 const forbiddenPattern=/\/(?:marketing|funnels|cmdb|siem|security-cases|whole-cloud|compliance-programs)(?:\/|$)/i
 assert.ok(productPaths.every(path=>!forbiddenPattern.test(path)))
 const routes=(await readdir('src/routes',{recursive:true})).filter(name=>/\.[jt]sx?$/.test(name));assert.ok(routes.every(path=>!forbiddenPattern.test('/'+path)))
 const files=await readdir('dist',{recursive:true}),builtPages=files.filter(path=>path.endsWith('.html'))
 assert.ok(builtPages.every(path=>!forbiddenPattern.test('/'+path)))
 const declarations=[]
 for(const file of (await readdir('src/porthole',{recursive:true})).filter(name=>name.endsWith('.ts'))){const source=await readFile(join('src/porthole',file),'utf8');for(const match of source.matchAll(/["'`](\/(?:app|api)\/[^"'`\s]*)["'`]/g))declarations.push(match[1])}
 assert.ok(declarations.every(path=>!forbiddenPattern.test(path)),'implemented product router declares no neighboring workflow')
 const inventory={declarations:[...new Set(declarations)].sort(),router:{probes:forbidden,methods:['GET','POST'],status:404},openapi:productPaths,routeModules:routes,builtPages}
 if(process.env.PORTHOLE_EVIDENCE_DIR){const {writeFile}=await import('node:fs/promises');await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,'route-inventory.json'),JSON.stringify(inventory,null,2)+'\n')}
 console.log('PROBE PORT-054 boundaries: running router, built pages and current OpenAPI -> no marketing funnel, CMDB, security case, whole-cloud bill or duplicated compliance-program workflow')
 return inventory
}

async function encodedService({origin,call,secret}) {
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process')
 const gateway=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await call(req.url,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':req.headers['content-type']},body:Buffer.concat(chunks)});res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(503);res.end()}})
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
 const child=spawn(process.execPath,['tests/porthole/services/producer.cjs'],{env:{...process.env,OTEL_SERVICE_NAME:encodedName,OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce,service.version=synthetic-porthole-8507',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'http://127.0.0.1:'+gateway.address().port+'/v1/traces',OTEL_TRACES_SAMPLER:'always_on',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',KAFKA_BROKER:'127.0.0.1:1',PORTHOLE_TOPIC:'synthetic-porthole-8508',PORTHOLE_SERVICE_ROLE:'fulfillment',PORTHOLE_HTTP_ONLY:'1'},stdio:['ignore','ignore','ignore','ipc']})
 const message=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',receive);reject(Error('Encoded stock service timed out'))},30000);const receive=data=>{if(data.type===type){clearTimeout(timer);child.off('message',receive);resolve(data)}};child.on('message',receive);child.once('exit',code=>{if(code){clearTimeout(timer);reject(Error('Encoded stock service failed'))}})})
 try{
  const ready=await message('ready'),response=await fetch('http://127.0.0.1:'+ready.port+'/encoded');assert.equal(response.status,200);await response.text()
  const pending=message('receipt');child.send('stop');const receipt=await pending
  await new Promise(resolve=>child.exitCode===null?child.once('exit',resolve):resolve())
  assert.equal(receipt.counts['/encoded'],1)
  const starts=receipt.spans.map(s=>BigInt(s.startNs)),ends=receipt.spans.map(s=>BigInt(s.startNs)+BigInt(s.durationNs))
  return {from:String(starts.reduce((a,b)=>a<b?a:b)-1n).padStart(20,'0'),through:String(ends.reduce((a,b)=>a>b?a:b)+1n).padStart(20,'0')}
 }finally{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}await new Promise(resolve=>gateway.close(resolve))}
}
