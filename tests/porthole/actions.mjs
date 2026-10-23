import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,packet,browserProof} from './audit.mjs'
import {verifyAudit} from '../../scripts/porthole/verify-audit.mjs'

export async function actionJourney({origin,cookie,restartWorker,freshOwner,sql,signIn}) {
 const post=(path,data,session=cookie)=>fetch(origin+path,form(origin,session,data))
 // Real inactive definitions and exact revision approvals use the same native
 // authority as the UI, with atomic mutation facts rather than copied bodies.
 const scope={services:['checkout'],environments:['production'],teams:['commerce']}
 cookie=await freshOwner()
 const sourceResponse=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-308',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}})
 assert.equal(sourceResponse.status,201)
 const source=await sourceResponse.json(),eventTime=BigInt(Date.now())*1000000n
 const accepted=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:`Bearer ${source.secret}`,'content-type':'application/json'},body:JSON.stringify({resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:'checkout'}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team.name',value:{stringValue:'commerce'}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(eventTime),severityNumber:17,body:{stringValue:'Checkout payment authorization timed out'}},{timeUnixNano:String(eventTime+1n),severityNumber:17,body:{stringValue:'Checkout dependency returned an upstream error'}}]}]}]})})
 assert.equal(accepted.status,200)
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const saved=await post('/api/porthole/v1/objects',{kind:'monitor',name:'Checkout request errors',scope,body:{signal:'logs',operator:'above',threshold:2,windowSeconds:300}})
 assert.equal(saved.status,201)
 const monitor=await saved.json()
 const changed=await post('/api/porthole/v1/objects',{id:monitor.id,revision:monitor.revision,kind:'monitor',name:'Checkout request errors',scope,body:{signal:'logs',operator:'above',threshold:3,windowSeconds:300}})
 assert.equal(changed.status,201)
 const repairResponse=await post('/api/porthole/v1/objects',{kind:'repair',name:'Roll back checkout deployment',scope,body:{steps:[{kind:'rollback',target:'checkout',revision:'deployment-42'}],expiresAt:Date.now()+3600000}})
 assert.equal(repairResponse.status,201)
 const repair=await repairResponse.json()
 const approved=await post('/api/porthole/v1/approvals',{id:repair.id,revision:repair.revision,confirm:'approve'})
 assert.equal(approved.status,200)
 assert.equal((await approved.json()).state,'approved')
 const expired=await post('/api/porthole/v1/approvals',{id:repair.id,revision:repair.revision+1,confirm:'approve'})
 assert.equal(expired.status,409)
 const queried=await post('/api/porthole/v1/query',{signal:'logs',service:'checkout',environment:'production',team:'commerce'})
 assert.equal(queried.status,200)
 const query=await queried.json()
 assert.ok(query.queryRef)
 assert.equal(query.records.length,2)
 const replay=await (await fetch(origin+query.replay,{headers:{cookie}})).json()
 assert.deepEqual(replay.records,query.records)
 const literal='synthetic-porthole-300 restricted literal'
 const refused=await post('/api/porthole/v1/query',{signal:'logs',query:literal})
 assert.equal(refused.status,400)
 // A failed fact insert rolls the native target write back in the same D1
 // transaction. A failed projection after commit recovers its original fact.
 await restartWorker(()=>sql("CREATE TRIGGER synthetic_fact_failure BEFORE INSERT ON porthole_audit_facts BEGIN SELECT RAISE(ABORT,'synthetic-porthole-302'); END"))
 const rolledBack=await post('/api/porthole/v1/objects',{id:monitor.id,revision:2,kind:'monitor',name:'Checkout request errors',scope,body:{signal:'logs',operator:'above',threshold:4,windowSeconds:300}})
 assert.equal(rolledBack.status,503)
 assert.equal((await sql(`SELECT revision FROM porthole_objects WHERE id='${monitor.id}'`))[0].revision,2)
 await restartWorker(()=>sql('DROP TRIGGER synthetic_fact_failure'))
 await restartWorker(()=>sql("CREATE TRIGGER synthetic_projection_failure BEFORE INSERT ON porthole_audit_entries WHEN json_extract(NEW.entry,'$.phase')='committed' BEGIN SELECT RAISE(ABORT,'synthetic-porthole-303'); END"))
 const uncertain=await post('/api/porthole/v1/objects',{id:monitor.id,revision:2,kind:'monitor',name:'Checkout request errors',scope,body:{signal:'logs',operator:'above',threshold:4,windowSeconds:300}})
 assert.equal(uncertain.status,503)
 assert.equal((await sql(`SELECT revision FROM porthole_objects WHERE id='${monitor.id}'`))[0].revision,3)
 await restartWorker(()=>sql('DROP TRIGGER synthetic_projection_failure'))
 const refusedOperations=[]
 for(const path of ['/auth/step-up','/auth/invite/cancel','/auth/session/revoke','/auth/settings/identity','/auth/domain-rules','/auth/providers/unlink','/auth/providers/relink','/auth/policy/approve','/auth/policy/revoke','/auth/email','/auth/display-name','/app/settings/credentials/mint','/app/settings/credentials/rotate','/app/settings/credentials/rescope','/app/settings/credentials/revoke','/api/porthole/v1/approvals','/api/porthole/v1/actors/erase','/api/v1/health/configuration','/api/porthole/v1/archive/exports']) {
  const refusal=await post(path,{token:'synthetic-porthole-304',literal:'synthetic-porthole-305'},'')
  assert.ok(refusal.status>=400 && refusal.status<500,path+' refuses privileged anonymous transport')
  refusedOperations.push(refusal.headers.get('x-porthole-operation'))
 }
 const before=await packet(origin,cookie)
 for(const operation of refusedOperations)assert.ok(before.records.some(row=>row.entry.operationRef===operation&&row.entry.phase==='denied'))
 assert.ok(before.records.some(row=>row.entry.phase==='committed' && row.entry.entityRef===monitor.id && row.entry.revision===3))
 const committed=before.records.filter(row=>row.entry.phase==='committed').map(row=>row.entry)
 assert.ok(committed.some(row=>row.action==='objects.monitor' && row.entityRef===monitor.id && row.revision===2))
 assert.ok(committed.some(row=>row.action==='repair.approve' && row.entityRef===repair.id && row.revision===1))
 assert.ok(committed.some(row=>row.action==='telemetry.query' && row.entityRef===query.queryRef))
 assert.ok(before.records.some(row=>row.entry.action==='telemetry.query' && row.entry.phase==='denied' && row.entry.status===400))
 assert.ok(!JSON.stringify(before).includes(literal))
 // Removal first revokes authority. Erasure retains the opaque actor ref and
 // chain bytes while removing the planted email and external linkage.
 const email='synthetic-porthole-301@example.com'
 const invited=await post('/app/settings/members/invite',{email,displayName:'Synthetic removed actor',role:'read-only analyst',scope})
 assert.equal(invited.status,202)
 const restrictedCookie=await signIn(email)
 const restricted=await post('/api/porthole/v1/query',{signal:'logs',service:'billing',environment:'production',team:'commerce'},restrictedCookie)
 assert.equal(restricted.status,403)
 await browserOperations({origin,cookie,restrictedCookie})
 const target=(await sql(`SELECT id FROM oa_operators WHERE email='${email}'`))[0]
 cookie=await freshOwner()
 assert.equal((await post('/app/settings/members/remove',{operatorId:target.id})).status,200)
 cookie=await freshOwner()
 assert.equal((await post('/api/porthole/v1/actors/erase',{actorRef:target.id,confirm:'erase'})).status,200)
 const anonymous=(await sql(`SELECT email,display_name,status FROM oa_operators WHERE id='${target.id}'`))[0]
 assert.equal(anonymous.status,'inactive');assert.ok(!JSON.stringify(anonymous).includes(email))
 assert.equal((await post('/api/porthole/v1/actors/erase',{actorRef:(await sql("SELECT id FROM oa_operators WHERE email='owner@example.com'"))[0].id,confirm:'erase'})).status,403)
 await restartWorker()
 const after=await packet(origin,cookie)
 assert.deepEqual(after.records.slice(0,before.records.length),before.records)
 assert.equal(verifyAudit(after,after.checkpoint.hash),after.records.length)
 assert.ok(!JSON.stringify(after).includes(email))
 await browserProof({origin,cookie,paths:['/app/operations','/app/explore','/app/settings/privacy','/app/audit'],name:'actions'})
 console.log('Audit operational actions passed: real query/replay/refusal, versioned monitor, exact repair approval, atomic facts, actor anonymization and restart continuity')
 return {cookie}
}

async function browserOperations({origin,cookie,restrictedCookie}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
   const page=await context.newPage()
   await page.goto(origin+'/app/operations')
   const form=page.locator('form[action="/app/operations/save"]').filter({has:page.getByRole('button',{name:'Save inactive definition',exact:true})})
   await form.getByLabel('Name',{exact:true}).fill(`Checkout ${width} error count`)
   await form.getByLabel('Kind',{exact:true}).selectOption('monitor')
   await form.getByLabel('Service',{exact:true}).fill('checkout')
   await form.getByLabel('Environment',{exact:true}).fill('production')
   await form.getByLabel('Team',{exact:true}).fill('commerce')
   await form.getByLabel('Definition JSON',{exact:true}).fill(JSON.stringify({signal:'logs',operator:'above',threshold:2,windowSeconds:300}))
   await Promise.all([page.waitForURL(origin+'/app/operations'),form.getByRole('button',{name:'Save inactive definition'}).click()])
   await page.getByRole('heading',{name:`Checkout ${width} error count`}).waitFor()
   const monitorArticle=page.locator('article').filter({has:page.getByRole('heading',{name:`Checkout ${width} error count`})})
   await monitorArticle.getByText('Edit monitor',{exact:true}).click()
   const edit=monitorArticle.locator('form[action="/app/operations/save"]')
   await edit.getByLabel('Definition JSON',{exact:true}).fill(JSON.stringify({signal:'logs',operator:'above',threshold:3,windowSeconds:300}))
   await Promise.all([page.waitForResponse(response=>response.url().endsWith('/app/operations/save')&&response.request().method()==='POST'),edit.getByRole('button',{name:'Save new revision'}).click()])
   await monitorArticle.getByText('monitor · revision 2 · inactive',{exact:true}).waitFor()
   const activate=page.locator('article').filter({has:page.getByRole('heading',{name:`Checkout ${width} error count`})}).locator('form[action="/app/operations/activate"]')
   await activate.getByRole('checkbox').check()
   await Promise.all([page.waitForResponse(response=>response.url().endsWith('/app/operations/activate')&&response.request().method()==='POST'),activate.getByRole('button',{name:'Activate monitor'}).click()])
   const activeArticle=page.locator('article').filter({has:page.getByRole('heading',{name:`Checkout ${width} error count`})})
   await activeArticle.getByText('monitor · revision 2 · active',{exact:true}).waitFor()
   assert.match(await activeArticle.innerText(),/revision 2 · active\b/)
   const planName=`Checkout ${width} recovery plan`
   const created=await context.request.post(origin+'/api/porthole/v1/objects',{headers:{origin},data:{kind:'repair',name:planName,scope:{services:['checkout'],environments:['production'],teams:['commerce']},body:{steps:[{kind:'rollback',target:'checkout',revision:'deployment-42'}],expiresAt:Date.now()+3600000}}})
   assert.equal(created.status(),201)
   await page.goto(origin+'/app/operations')
   const plan=page.locator('article').filter({has:page.getByRole('heading',{name:planName,exact:true})})
   await plan.getByRole('checkbox').check()
   await Promise.all([page.waitForResponse(response=>response.url().endsWith('/app/operations/approve')&&response.request().method()==='POST'),plan.getByRole('button',{name:'Record approval'}).click()])
   await plan.getByText('repair · revision 1 · approved',{exact:true}).waitFor()
   for(const path of ['/app/operations','/app/explore']) {
    await page.goto(origin+path)
    if(path.endsWith('/explore')) {
     await page.getByLabel('Signal',{exact:true}).selectOption('logs')
     await page.getByLabel('Service',{exact:true}).fill('checkout')
     await page.getByLabel('Environment',{exact:true}).fill('production')
     await page.getByLabel('Team',{exact:true}).fill('commerce')
     await page.getByRole('button',{name:'Run query'}).click()
     await page.getByRole('heading',{name:'Query results',exact:true}).waitFor()
    }
    await page.waitForFunction(()=>document.readyState==='complete')
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'operations stay within viewport')
    if(process.env.PORTHOLE_EVIDENCE_DIR) {await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`operations-user-${width}-${path.endsWith('explore')?'query':'definitions'}.png`),fullPage:true})}
   }
   await page.goto(origin+'/app/audit')
   const downloaded=page.waitForEvent('download')
   await page.getByRole('link',{name:'Export audit for Evidence',exact:true}).click()
   const download=await downloaded
   assert.equal(await download.failure(),null)
   const {readFile}=await import('node:fs/promises')
   const exported=JSON.parse(await readFile(await download.path(),'utf8'))
   assert.equal(verifyAudit(exported,exported.checkpoint.hash),exported.records.length)
   const restricted=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await restricted.addCookies(restrictedCookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
   const refused=await restricted.newPage()
   await refused.goto(origin+'/app/explore')
   await refused.getByLabel('Signal',{exact:true}).selectOption('logs')
   await refused.getByLabel('Service',{exact:true}).fill('billing')
   await refused.getByLabel('Environment',{exact:true}).fill('production')
   await refused.getByLabel('Team',{exact:true}).fill('commerce')
   const denied=refused.waitForResponse(response=>response.url().endsWith('/app/explore')&&response.request().method()==='POST')
   await refused.getByRole('button',{name:'Run query'}).click()
   assert.equal((await denied).status(),403)
   await refused.getByRole('heading',{name:'Query unavailable',exact:true}).waitFor()
   if(process.env.PORTHOLE_EVIDENCE_DIR)await refused.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`restricted-query-${width}.png`),fullPage:true})
   await restricted.close()
   await context.close()
  }
 } finally {await browser.close()}
}
