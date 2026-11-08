import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal} from './fixture.mjs'
import {hashToken} from '../../src/modules/operator-auth/crypto.mjs'
import {localAgentPolicy} from '../agent-door/local-policy.mjs'
const execute=promisify(execFile),address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
const members='/app/settings/members',scope={services:['checkout'],environments:['production'],teams:['commerce']}

/** One removal journey through real membership, configuration and query doors.
 * Stock SDK traffic supplies two independent teams; storage reads verify that
 * refused batches and held sources remain unchanged. */
export async function handoverJourney({origin,freshOwner,signIn,sql,mutate,restartWorker,withEmptyDestination,sessionSecret}) {
 let cookie=await freshOwner()
 const post=async(path,data,status=200,acting=cookie)=>{
  const response=await fetch(origin+path,form(origin,acting,data))
  assert.equal(response.status,status,path+': '+(response.status===status?'':await response.clone().text()))
  return response.headers.get('content-type')?.includes('json')?response.json():response
 }
 const get=async(path,acting=cookie,status=200)=>{
  const response=await fetch(origin+path,{headers:{cookie:acting}})
  assert.equal(response.status,status,await response.clone().text());return response.json()
 }
 const owner=(await get('/auth/session')).operator.id
 const member=async(n,role,selected)=>{
  await post(members+'/invite',{email:address(n),displayName:'synthetic-porthole-'+n,role,scope:selected},202)
  const session=await signIn(address(n)),id=(await get('/auth/session',session)).operator.id
  return {id,cookie:session}
 }
 const departing=await member(9100,'maintainer',scope),successor=await member(9101,'maintainer',scope),wrong=await member(9102,'responder',{services:['fulfillment'],environments:['production'],teams:['fulfillment']})
 cookie=await freshOwner()
 const source=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-9103',class:'ingest',scope:{services:['checkout','fulfillment'],environments:['production'],teams:['commerce','fulfillment'],signals:['logs','metrics','traces'],actions:['telemetry.write']}},201)
 for(const [service,team]of [['checkout','commerce'],['fulfillment','fulfillment']])await execute(process.execPath,['tests/porthole/polyglot/otlp.cjs'],{env:{...process.env,PORTHOLE_OTLP_ENDPOINT:origin,PORTHOLE_OTLP_SECRET:source.secret,PORTHOLE_OTLP_SERVICE:service,PORTHOLE_OTLP_ENVIRONMENT:'production',PORTHOLE_OTLP_TEAM:team},timeout:60000})
 await post('/api/porthole/v1/ingest/drain',{})
 const readable=async acting=>{
  const result=await post('/api/porthole/v1/query',{signal:'logs'},200,acting)
  return result.records.map(r=>r.id).sort()
 }
 const allowedBefore=await readable(successor.cookie),wrongBefore=await readable(wrong.cookie)
 assert.equal(allowedBefore.length,1);assert.equal(wrongBefore.length,1);assert.notDeepEqual(allowedBefore,wrongBefore)
 const services=await get('/api/porthole/v1/services'),service=services.services.find(s=>s.service==='checkout')
 assert.ok(service)
 await post('/api/porthole/v1/services/'+service.id,{revision:0,ownerRef:departing.id,repository:'',runbook:'',criticality:'high',confirm:'save-service-metadata'},201)
 const filter=await post('/api/porthole/v1/events/filters',{name:'synthetic-porthole-9104',definition:{service:'checkout',environment:'production',team:'commerce'}},201,departing.cookie)
 const repair=await post('/api/porthole/v1/objects',{kind:'repair',name:'synthetic-porthole-9105',scope,body:{steps:[{kind:'restart',target:'checkout',revision:'synthetic-porthole-9106'}],expiresAt:Date.now()+3600000}},201)
 await post('/api/porthole/v1/approvals',{id:repair.id,revision:1,confirm:'approve'},200,departing.cookie)
 await post('/api/v1/health/tick',{})
 let follow=(await get('/api/porthole/v1/follow-up')).tasks.find(t=>t.source==='repair:'+repair.id+':1')
 assert.ok(follow)
 await post('/api/porthole/v1/follow-up/review',{id:follow.id,revision:follow.revision,ownerId:departing.id,dueAt:Date.now()+3600000,nextAction:'Review original repair',note:'Explicit handover review',reminders:'off',confirm:'review'})
 const personal=randomBytes(32).toString('base64url'),hash=await hashToken(sessionSecret,'credential',personal)
 await mutate(`INSERT INTO oa_credentials(id,token_hash,operator_id,operator_version,kind,expires_at) SELECT ${literal(randomUUID())},${literal(hash)},id,version,'native',${Date.now()+3600000} FROM oa_operators WHERE id=${literal(departing.id)}`)
 const nativeCredential=await fetch(origin+'/api/porthole/v1/session',{headers:{authorization:'Bearer '+personal}});assert.equal(nativeCredential.status,200)
 // A legacy held SLO owner is previewed, but this removal adds no SLO door.
 const sloId=randomUUID(),sloDefinition={type:'event-ratio',scope,sourceId:source.credential.id,targetPpm:990000,latencyMs:300,goodMetric:null,totalMetric:null,exclusions:[]}
 await mutate(`INSERT INTO porthole_slo_versions VALUES(${literal(sloId)},1,'synthetic-porthole-9107',${literal(JSON.stringify(sloDefinition))},${literal(departing.id)},${Date.now()},'active')`)
 const databaseId=randomUUID()
 await mutate(`INSERT INTO porthole_database_sources VALUES(${literal(databaseId)},${literal(source.credential.id)},'checkout','production','commerce','postgresql',${literal('0'.repeat(64))},1,1,${Date.now()},${literal(departing.id)})`)
 const databaseBefore=await sql(`SELECT * FROM porthole_database_sources WHERE id=${literal(databaseId)}`)
 const heldBefore=await sql(`SELECT * FROM porthole_slo_versions WHERE id=${literal(sloId)}`)
 cookie=await freshOwner()
 await post(members+'/remove',{operatorId:departing.id},409)
 let review=await post(members+'/preview',{operatorId:departing.id})
 for(const kind of ['service','event-filter','follow-up','approval','slo','database-source','personal-credential'])assert.ok(review.items.some(i=>i.kind===kind),kind)
 assert.equal(new Set(review.items.map(i=>i.key)).size,review.items.length)
 const choices=review.items.map(i=>({key:i.key,successor:i.kind==='service'||i.kind==='follow-up'?successor.id:null}))
 const snapshot=async()=>({
  services:await sql('SELECT * FROM porthole_service_versions ORDER BY id,revision'),
  filters:await sql('SELECT * FROM porthole_event_filters ORDER BY id'),
  approvals:await sql('SELECT * FROM porthole_object_approvals ORDER BY id'),
  members:await sql('SELECT id,status,version FROM oa_operators ORDER BY id'),
  work:await sql('SELECT * FROM porthole_follow_up ORDER BY id'),
  receipts:await sql('SELECT * FROM porthole_handover_history ORDER BY id'),
 })
 const limitedAdmin=await member(9109,'admin',{services:['*'],environments:['*'],teams:['*']})
 cookie=await freshOwner()
 review=await post(members+'/preview',{operatorId:departing.id})
 const stable=await snapshot()
 await post(members+'/preview',{operatorId:departing.id},403,limitedAdmin.cookie)
 assert.deepEqual(await snapshot(),stable,'membership administration cannot delegate owner-only object handover or reveal private inventory')
 await post(members+'/remove',{operatorId:departing.id,token:review.token,choices:choices.map(c=>c.key.startsWith('service:')?{...c,successor:wrong.id}:c)},403)
 assert.deepEqual(await snapshot(),stable,'non-covering successor leaves product storage unchanged')
 await post(members+'/remove',{operatorId:departing.id,token:review.token,choices:choices.map(c=>c.key.startsWith('slo:')?{...c,successor:owner}:c)},403)
 assert.deepEqual(await snapshot(),stable,'held source cannot be changed by assigning an otherwise privileged owner')
 const late=await post('/api/porthole/v1/events/filters',{name:'synthetic-porthole-9108',definition:{service:'checkout',environment:'production',team:'commerce'}},201,departing.cookie)
 const lateSnapshot=await snapshot()
 await post(members+'/remove',{operatorId:departing.id,token:review.token,choices},409)
 assert.deepEqual(await snapshot(),lateSnapshot,'assignment after preview makes the complete inventory stale')
 review=await post(members+'/preview',{operatorId:departing.id})
 const previousSuccessorSession=successor.cookie
 await post(members+'/change',{operatorId:successor.id,role:'maintainer',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}})
 const narrowedSuccessor=await snapshot()
 await post(members+'/remove',{operatorId:departing.id,token:review.token,choices:review.items.map(i=>({key:i.key,successor:i.kind==='service'||i.kind==='follow-up'?successor.id:null}))},409)
 assert.deepEqual(await snapshot(),narrowedSuccessor,'successor revocation after preview rolls back the entire batch')
 review=await post(members+'/preview',{operatorId:departing.id})
 await post(members+'/remove',{operatorId:departing.id,token:review.token,choices:review.items.map(i=>({key:i.key,successor:i.kind==='service'||i.kind==='follow-up'?successor.id:null}))},403)
 assert.deepEqual(await snapshot(),narrowedSuccessor,'a fresh preview cannot grant the successor a missing service or team scope')
 await get('/auth/session',previousSuccessorSession,401)
 await post(members+'/change',{operatorId:successor.id,role:'maintainer',scope})
 successor.cookie=await signIn(address(9101))
 review=await post(members+'/preview',{operatorId:departing.id})
 await restartWorker()
 const committed=await post(members+'/remove',{operatorId:departing.id,token:review.token,choices:review.items.map(i=>({key:i.key,successor:i.kind==='service'||i.kind==='follow-up'?successor.id:null}))})
 assert.equal(committed.status,'inactive')
 const audit=(await get('/api/v1/audit/export')).records.map(row=>row.entry)
 const fact=audit.find(e=>e.action==='membership.handover'&&e.entityRef===committed.receipt&&e.phase==='committed')
 assert.ok(fact,'private public audit contains the committed handover receipt')
 assert.ok(audit.some(e=>e.operationRef===fact.operationRef&&e.action==='membership.status'&&e.entityRef===departing.id&&e.phase==='committed'),'removal and handover facts share one operation')
 assert.ok(!JSON.stringify(audit).includes(personal),'handover audit contains no personal credential secret')
 assert.deepEqual(await readable(successor.cookie),allowedBefore,'handover never expands the successor telemetry set')
 assert.deepEqual(await readable(wrong.cookie),wrongBefore)
 const newService=(await get('/api/porthole/v1/services')).services.find(s=>s.id===service.id)
 assert.equal(newService.metadata.owner_ref,successor.id);assert.equal(newService.metadata.revision,2)
 const rows=await sql(`SELECT owner_ref FROM porthole_event_filters WHERE id IN (${literal(filter.id)},${literal(late.id)})`)
 assert.ok(rows.every(r=>r.owner_ref===null))
 assert.deepEqual(await sql(`SELECT * FROM porthole_slo_versions WHERE id=${literal(sloId)}`),heldBefore,'held SLO version is byte-for-byte unchanged')
 assert.deepEqual(await sql(`SELECT * FROM porthole_database_sources WHERE id=${literal(databaseId)}`),databaseBefore,'held database source and enabled collection remain unchanged')
 const pending=(await get('/api/porthole/v1/objects')).objects.find(o=>o.id===repair.id)
 assert.equal(pending.state,'inactive')
 assert.equal((await sql(`SELECT * FROM porthole_object_approvals WHERE object_id=${literal(repair.id)}`)).length,0,'old approval is void, not transferred')
 await post('/api/porthole/v1/approvals',{id:repair.id,revision:1,confirm:'approve'},401,departing.cookie)
 await post('/api/porthole/v1/approvals',{id:repair.id,revision:1,confirm:'approve'},200,successor.cookie)
 const work=(await get('/api/porthole/v1/follow-up')).tasks
 assert.ok(work.some(t=>t.kind==='handover'&&t.owner_id===null&&t.next_action.includes(sloId)))
 assert.ok(work.some(t=>t.id===follow.id&&t.owner_id===successor.id))
 for(const path of ['/auth/session','/api/porthole/v1/services','/api/porthole/v1/events/filters'])await get(path,departing.cookie,401)
 assert.equal((await fetch(origin+'/api/porthole/v1/session',{headers:{authorization:'Bearer '+personal}})).status,401)
 await localAgentPolicy(origin,cookie)
 const rpc=await fetch(origin+'/api/porthole/v1/mcp',{...form(origin,departing.cookie,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'porthole.telemetry.query',arguments:{signal:'logs'}}}),headers:{...form(origin,departing.cookie,{}).headers,'mcp-protocol-version':'2025-11-25',authorization:'Bearer '+personal}})
 assert.equal(rpc.status,401,'removed personal credential cannot enter MCP: '+await rpc.clone().text())
 const cli=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['cli/porthole.mjs',origin,'query'],{env:{...process.env,PORTHOLE_SESSION:departing.cookie,PORTHOLE_CREDENTIAL:personal},stdio:['pipe','pipe','pipe']})
  let out='';child.stderr.on('data',c=>out+=c);child.stdout.resume();child.on('error',reject);child.on('exit',code=>resolve({code,out}));child.stdin.end(JSON.stringify({signal:'logs'}))
 })
 assert.notEqual(cli.code,0,'spawned CLI refuses the removed identity')
 await restartWorker()
 await get('/auth/session',departing.cookie,401)
 assert.equal((await get('/api/porthole/v1/objects')).objects.find(o=>o.id===repair.id).state,'approved','only a new current approval survives restart')
 cookie=await freshOwner()
 await notebookCustody({origin,cookie,owner,member,post,get,sql,mutate,freshOwner,signIn,restartWorker,withEmptyDestination,source,scope,successor,refresh:async()=>{cookie=await freshOwner({force:true});return cookie}})
 console.log('handoverJourney passed: complete native inventory, wrong-scope and stale refusals with no writes, mixed transfer and unassignment, void approvals, identical readable sets, next-request session and personal credential REST CLI MCP refusal, restart and inactive restore')
}

async function notebookCustody({origin,owner,member,post,get,sql,mutate,freshOwner,signIn,restartWorker,withEmptyDestination,source,scope,successor,refresh}) {
 console.log('Handover: native mixed batch, private audit and transport refusals checked')
 const former=await member(9120,'maintainer',scope)
 await post(members+'/change',{operatorId:former.id,role:'owner',confirmEmail:address(9120)})
 former.cookie=await signIn(address(9120))
 await localAgentPolicy(origin,await freshOwner())
 const mint=(kind,actions)=>post('/app/settings/credentials/mint',{name:'synthetic-porthole-9121',class:kind,scope:{...scope,signals:['logs'],actions}},201,former.cookie)
 const ingest=await mint('ingest',['telemetry.write']),read=await mint('read',['telemetry.read'])
 const proposal=await mint('proposal',['telemetry.read','proposal.create']),execution=await mint('execution',['plan.execute'])
 const keyRequest=(path,data)=>fetch(origin+path,{...form(origin,'',data),headers:{...form(origin,'',{}).headers,...(path.endsWith('/mcp')?{'mcp-protocol-version':'2025-11-25'}:{}),authorization:'Bearer '+read.secret}})
 const keyQuery={signal:'logs',service:'checkout',environment:'production',team:'commerce'}
 assert.equal((await keyRequest('/api/porthole/v1/query',keyQuery)).status,200)
 const rpcData={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'porthole.telemetry.query',arguments:keyQuery}}
 const standardRead=()=>fetch(origin+'/api/v1/query',{headers:{authorization:'Bearer '+read.secret}})
 assert.equal((await standardRead()).status,501) // Authenticated unsupported query; no data disclosed.
 const rpcBefore=await keyRequest('/api/porthole/v1/mcp',rpcData)
 assert.equal(rpcBefore.status,200);assert.equal((await rpcBefore.json()).result.structuredContent.records.length,1)
 const nativeCli=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['cli/porthole.mjs',origin,'query'],{env:{...process.env,PORTHOLE_CREDENTIAL:read.secret},stdio:['pipe','pipe','pipe']})
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.end(JSON.stringify(keyQuery))
 })
 assert.equal((await nativeCli()).code,0)
 const monitor=await post('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-9122',scope,body:{signal:'logs',operator:'above',threshold:0,windowSeconds:86400}},201)
 await post('/api/porthole/v1/objects/activate',{id:monitor.id,revision:1,confirm:'activate'})
 const heartbeat=await fetch(origin+'/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-9123',signal:'logs',service:'checkout',environment:'production',team:'commerce'})});assert.equal(heartbeat.status,200)
 await post('/api/v1/health/tick',{})
 const evaluation=(await get('/api/porthole/v1/notebooks/evaluations')).evaluations.find(e=>e.monitorId===monitor.id)
 assert.ok(evaluation)
 const notebook=await post('/api/porthole/v1/notebooks',{evaluationId:evaluation.id,name:'synthetic-porthole-9124'},201,former.cookie)
 const unassigned=await post('/api/porthole/v1/notebooks',{evaluationId:evaluation.id,name:'synthetic-porthole-9125'},201,former.cookie)
 const signalExport=await post('/api/porthole/v1/exports',{scope,signals:['logs'],from:'0',through:String(BigInt(Date.now())*1000000n),pageSize:2},201,former.cookie)
 await post('/api/porthole/v1/exports/'+signalExport.id+'/approve',{confirm:signalExport.id,credentialId:read.credential.id},200,former.cookie)
 const heldArchive=await post('/api/porthole/v1/archive/exports',{},201,former.cookie)
 const archiveBefore=await sql(`SELECT * FROM porthole_archive_jobs WHERE id=${literal(heldArchive.id)}`)
 const root='/api/porthole/v1/notebooks/'+notebook.id
 await post(root+'/cells',{revision:1,cellId:'logs',kind:'query',title:'synthetic-porthole-9126',query:{signal:'logs',service:'checkout',environment:'production',team:'commerce',from:String(BigInt(Date.now()-86400000)*1000000n),through:String(BigInt(Date.now())*1000000n)}},200,former.cookie)
 let current=await get(root,former.cookie)
 assert.equal(current.results[0].count,1)
 const revision=current.revision
 await post(root+'/share',{revision,kind:'member',target:successor.id},200,former.cookie)
 current=await get(root,former.cookie)
 await post(root+'/share',{revision:current.revision,kind:'team',target:'commerce'},200,former.cookie)
 current=await get(root,former.cookie)
 await get(root,successor.cookie)
 const publications=root+'/publications'
 const draft=await post(publications,{revision:current.revision,title:'Observed local request',summary:'Reviewed count only',cells:[{cellId:'logs',label:'Observed requests',unit:'records'}],expiresAt:Date.now()+3600000},201,former.cookie)
 await post(publications+'/'+draft.id+'/approve',{digest:draft.digest,revision:draft.source_revision,expiresAt:draft.expires_at,audience:'anyone-with-address',confirm:'reviewed-sanitized-notebook'},200,former.cookie)
 assert.equal((await fetch(origin+'/shared/notebooks/'+draft.id)).status,200)
 let cookie=await refresh()
 const review=await post(members+'/preview',{operatorId:former.id})
 for(const kind of ['notebook','notebook-share','notebook-publication','credential','signal-export','archive-job'])assert.ok(review.items.some(i=>i.kind===kind))
 const choices=review.items.map(i=>({key:i.key,successor:i.mode==='custody'||i.kind==='notebook'&&i.id===notebook.id?owner:null}))
 const invalid=choices.map(c=>c.key==='notebook:'+notebook.id?{...c,successor:successor.id}:c)
 const grantsBefore=await sql('SELECT * FROM porthole_notebook_shares ORDER BY notebook_id,kind,target')
 await post(members+'/remove',{operatorId:former.id,token:review.token,choices:invalid},403)
 assert.deepEqual(await sql('SELECT * FROM porthole_notebook_shares ORDER BY notebook_id,kind,target'),grantsBefore,'notebook assignment cannot create a role or private read grant')
 await handoverBrowser({origin,cookie,id:former.id,review,mutate,post,freshOwner,refusedSuccessor:successor.id,owner})
 await handoverUnavailableBrowser({origin,cookie,mutate})
 // Browser state probes deliberately invalidate their own review. Always
 // obtain the complete inventory again before committing through the door.
 cookie=await refresh()
 const finalReview=await post(members+'/preview',{operatorId:former.id})
 assert.equal(finalReview.operatorId,former.id)
 await handoverCommitBrowser({origin,cookie,notebook:notebook.id,owner})
 assert.equal((await get('/auth/operators')).find(row=>row.id===former.id).status,'inactive')
 assert.equal((await sql(`SELECT owner_ref FROM porthole_notebooks WHERE id=${literal(notebook.id)}`))[0].owner_ref,owner)
 assert.equal((await sql(`SELECT owner_ref FROM porthole_notebooks WHERE id=${literal(unassigned.id)}`))[0].owner_ref,null)
 assert.equal((await sql(`SELECT COUNT(*) n FROM porthole_notebook_shares WHERE owner_ref=${literal(former.id)}`))[0].n,0)
 await get(root,successor.cookie,404)
 assert.equal((await fetch(origin+'/shared/notebooks/'+draft.id)).status,404)
 assert.equal((await sql(`SELECT state FROM porthole_notebook_publications WHERE id=${literal(draft.id)}`))[0].state,'revoked')
 const inspect=secret=>fetch(origin+'/api/porthole/v1/credential',{headers:{authorization:'Bearer '+secret}})
 for(const secret of [read.secret,proposal.secret,execution.secret])assert.equal((await inspect(secret)).status,401)
 assert.equal((await keyRequest('/api/porthole/v1/query',keyQuery)).status,401)
 assert.equal((await keyRequest('/api/porthole/v1/mcp',rpcData)).status,401)
 assert.equal((await standardRead()).status,401)
 assert.equal((await nativeCli()).code,1)
 assert.equal((await inspect(ingest.secret)).status,200)
 assert.equal((await (await inspect(ingest.secret)).json()).custodianId,owner)
 assert.equal((await sql(`SELECT state FROM porthole_signal_exports WHERE id=${literal(signalExport.id)}`))[0].state,'cancelled','export approval authority ends and cannot transfer')
 assert.deepEqual(await sql(`SELECT * FROM porthole_archive_jobs WHERE id=${literal(heldArchive.id)}`),archiveBefore,'held archive custody is preserved without transferring restore authority')
 await get('/api/porthole/v1/archive/exports/'+heldArchive.id,former.cookie,401)
 const monitorAfter=(await get('/api/porthole/v1/objects')).objects.find(o=>o.id===monitor.id)
 assert.equal(monitorAfter.state,'active');assert.equal(monitorAfter.revision,1,'unassignment never changes the monitor definition')
 await restartWorker()
 assert.equal((await inspect(read.secret)).status,401);assert.equal((await inspect(ingest.secret)).status,200)
 await handoverCompletedBrowser({origin,cookie,id:former.id})
 console.log('Handover: notebook, sharing, ingest custody and browser states checked')
 if(withEmptyDestination)await handoverArchive({origin,cookie,withEmptyDestination,notebook:unassigned.id,publication:draft.id,ingest:ingest.secret,read:read.secret,otherSecrets:[proposal.secret,execution.secret]})
}

async function handoverBrowser({origin,cookie,id,review,mutate,post,freshOwner,refusedSuccessor,owner}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?950:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage()
  await page.goto(origin+members)
  const row=page.locator('li').filter({has:page.getByRole('heading',{name:'synthetic-porthole-9120',exact:true})})
  await row.getByText('Manage synthetic-porthole-9120',{exact:true}).click()
  await row.getByRole('button',{name:'Review removal and handover'}).click()
  await page.getByRole('heading',{name:'Review member removal',exact:true}).waitFor()
  if(width===1440) {
   assert.equal(await page.locator('select').count(),review.items.filter(i=>['move','custody'].includes(i.mode)).length)
   await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none')
   assert.ok(await page.locator('p,label,button,select').evaluateAll(items=>items.every(el=>parseFloat(getComputedStyle(el).fontSize)>=13)))
   assert.equal(await page.locator('button').evaluateAll(items=>items.filter(i=>!i.textContent.trim()).length),0)
  }
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'handover-preview-'+width+'.png'),fullPage:true})}
  for(const select of await page.locator('select').all())if(await select.locator('option:disabled').count())await select.selectOption(owner)
  await page.locator('select').first().evaluate((select,id)=>{select.add(new Option('Ineligible successor',id));select.value=id},refusedSuccessor)
  await page.getByRole('checkbox').check()
  const refused=page.waitForResponse(r=>r.url().endsWith('/members/remove'))
  await page.getByRole('button',{name:'Commit handover and remove'}).click()
  const refusedResponse=await refused
  if(width===1440)assert.equal(refusedResponse.status(),403)
  await page.getByRole('alert').waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'handover-refused-'+width+'.png'),fullPage:true})
  await page.getByRole('link',{name:'Return to Members',exact:true}).click()
  await row.getByText('Manage synthetic-porthole-9120',{exact:true}).click()
  await row.getByRole('button',{name:'Review removal and handover'}).click()
  for(const select of await page.locator('select').all())if(await select.locator('option:disabled').count())await select.selectOption(owner)
  await page.getByRole('checkbox').check()
  // A new private filter invalidates the preview without modifying its objects.
  await post('/api/porthole/v1/events/filters',{name:'synthetic-porthole-9130-'+width,definition:{service:'checkout',environment:'production',team:'commerce'}},201)
  const failed=page.waitForResponse(r=>r.url().endsWith('/members/remove'))
  await page.getByRole('button',{name:'Commit handover and remove'}).click()
  if(width===1440)assert.equal((await failed).status(),409);else await failed
  await page.getByRole('alert').waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'handover-stale-'+width+'.png'),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
}
async function handoverCompletedBrowser({origin,cookie,id}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?950:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+members)
  const row=page.locator('li').filter({has:page.getByRole('heading',{name:'synthetic-porthole-9120',exact:true})})
  if(width===1440){assert.match(await row.innerText(),/inactive/);assert.equal(await row.locator('form').count(),0)}
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'handover-completed-'+width+'.png'),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
}
async function handoverArchive({origin,cookie,withEmptyDestination,notebook,publication,ingest,read,otherSecrets}) {
 const {handoverArchiveJourney}=await import('./archive.mjs')
 await handoverArchiveJourney({origin,cookie,withEmptyDestination,notebook,publication,ingest,read,otherSecrets})
}

async function handoverUnavailableBrowser({origin,cookie,mutate}) {
 const {chromium}=await import('@playwright/test')
 await mutate('ALTER TABLE porthole_handover_epoch RENAME TO handover_epoch_unavailable')
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?950:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+members)
  const row=page.locator('li').filter({has:page.getByRole('heading',{name:'synthetic-porthole-9120',exact:true})})
  await row.getByText('Manage synthetic-porthole-9120',{exact:true}).click()
  const response=page.waitForResponse(r=>r.url().endsWith('/members/preview'))
  await row.getByRole('button',{name:'Review removal and handover'}).click()
  const unavailable=await response
  if(width===1440){assert.equal(unavailable.status(),503);assert.equal(await page.locator('form').count(),0)}
  await page.getByRole('alert').waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'handover-unavailable-'+width+'.png'),fullPage:true})
  await context.close()
 }}finally{await browser.close();await mutate('ALTER TABLE handover_epoch_unavailable RENAME TO porthole_handover_epoch')}
}

async function handoverCommitBrowser({origin,cookie,notebook,owner}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try {
  const context=await browser.newContext({viewport:{width:1440,height:950}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+members)
  const row=page.locator('li').filter({has:page.getByRole('heading',{name:'synthetic-porthole-9120',exact:true})})
  await row.getByText('Manage synthetic-porthole-9120',{exact:true}).click()
  await row.getByRole('button',{name:'Review removal and handover'}).click()
  for(const select of await page.locator('select').all())if(await select.locator('option:disabled').count())await select.selectOption(owner)
  await page.getByRole('heading',{name:'Review member removal',exact:true}).waitFor()
  await page.getByLabel('Successor for notebook '+notebook,{exact:true}).selectOption(owner)
  await page.getByRole('checkbox').check()
  const completed=page.waitForResponse(r=>r.url().endsWith('/members/remove'))
  await page.getByRole('button',{name:'Commit handover and remove'}).click()
  assert.equal((await completed).status(),303)
  await page.waitForURL(origin+members)
  await context.close()
 }finally{await browser.close()}
}
