import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {hashToken} from '../../src/modules/operator-auth/crypto.mjs'
import {form,literal} from './fixture.mjs'

export async function membershipJourney({origin,cookie,sql,mutate,link,signIn,freshOwner,sessionSecret}) {
 const get=(path,c=cookie)=>fetch(origin+path,{headers:{cookie:c},redirect:'manual'})
 const post=(path,data,c=cookie)=>fetch(origin+path,form(origin,c,data))
 const members=async()=>{const r=await get('/auth/operators');assert.equal(r.status,200);return r.json()}
 for(const path of ['/app/settings/members','/app/settings/credentials']) assert.equal((await get(path,'')).status,401)
 const scope={services:['checkout'],environments:['production'],teams:['commerce']}
 const roles=['admin','maintainer','responder','read-only analyst','finance reader','restricted contractor']
 for(const [i,role] of roles.entries()) {
  const r=await post('/app/settings/members/invite',{email:`synthetic-porthole-${20+i}@example.com`,displayName:`Checkout ${role}`,role,scope:role==='admin'?{services:['*'],environments:['*'],teams:['*']}:scope})
  assert.equal(r.status,202,`${role} invitation: ${await r.text()}`)
 }
 const rows=await members()
 assert.deepEqual(new Set(rows.map(row=>row.productRole)),new Set(['owner',...roles]))
 const target=rows.find(row=>row.productRole==='maintainer'),admin=rows.find(row=>row.productRole==='admin'),contractor=rows.find(row=>row.productRole==='restricted contractor'),owner=rows.find(row=>row.productRole==='owner')
 assert.equal(target.role,'member');assert.deepEqual(target.scope,scope)
 // Prefetch does not consume a link. Exactly one explicit POST can join.
 const invited=await link(target.email,{kind:'invite'})
 for(const method of ['GET','HEAD','GET']) assert.equal((await fetch(origin+'/auth/confirm?token='+invited,{method})).status,200)
 const consumed=await post('/auth/confirm',{token:invited},'')
 assert.equal(consumed.status,303)
 let targetCookie=consumed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
 assert.equal((await post('/auth/confirm',{token:invited},'')).status,400)
 assert.equal((await get('/auth/session',targetCookie)).status,200)
 const expired=await link(target.email,{expired:true})
 assert.equal((await post('/auth/confirm',{token:expired},'')).status,400)
 assert.equal((await post('/auth/confirm',{token:randomBytes(32).toString('base64url')},'')).status,400)
 const signedOut=await post('/auth/signout',{},targetCookie);assert.equal(signedOut.status,204)
 assert.equal((await get('/auth/session',targetCookie)).status,401)
 // Unknown and known addresses have the same neutral magic-link response.
 const known=await post('/auth/magic-link',{email:target.email},''),unknown=await post('/auth/magic-link',{email:'synthetic-porthole-99@example.com'},'')
 assert.equal(known.status,unknown.status);assert.deepEqual(await known.json(),await unknown.json())
 const forged=await fetch(origin+'/app/settings/members/invite',{...form(origin,cookie,{email:'synthetic-porthole-90@example.com',displayName:'Forged',role:'admin'}),headers:{...form(origin,cookie,{}).headers,origin:'https://synthetic-porthole.invalid'}})
 assert.equal(forged.status,403)
 const noOrigin=await fetch(origin+'/auth/operator/role',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({operatorId:target.id,role:'admin'})});assert.equal(noOrigin.status,403)
 assert.equal((await fetch(origin+'/app/settings/members',{headers:{cookie,'sec-fetch-site':'cross-site'}})).status,403)
 const otherInstallation=`operator_session_local_${new URL(origin).port}=${randomBytes(32).toString('base64url')}`
 assert.equal((await get('/auth/session',otherInstallation)).status,401)
 const adminCookie=await signIn(admin.email)
 for(const role of ['owner','admin']) assert.equal((await post('/app/settings/members/invite',{email:`synthetic-porthole-${role}@example.com`,displayName:'Escalation',role},adminCookie)).status,403)
 assert.equal((await post('/app/settings/members/change',{operatorId:owner.id,role:'read-only analyst',scope},adminCookie)).status,403)
 assert.equal((await post('/app/settings/members/change',{operatorId:admin.id,role:'owner'},adminCookie)).status,403)
 assert.equal((await get('/auth/providers',adminCookie)).status,403)
 assert.equal((await get('/auth/domain-rules',adminCookie)).status,403)
 assert.equal((await post('/app/settings/members/change',{operatorId:target.id,role:'responder',scope},adminCookie)).status,200)
 const contractorCookie=await signIn(contractor.email)
 for(const path of ['/app/settings','/app/settings/members','/app/settings/credentials','/auth/settings/identity','/auth/operators','/auth/sessions','/auth/providers']) assert.equal((await get(path,contractorCookie)).status,403,path)
 assert.equal((await post('/app/settings/members/change',{operatorId:contractor.id,role:'maintainer',scope},contractorCookie)).status,403)
 targetCookie=await signIn(target.email)
 const concurrentCookie=await signIn(target.email)
 // A role-only member→member change still fences every outstanding session.
 assert.equal((await post('/app/settings/members/change',{operatorId:target.id,role:'read-only analyst',scope})).status,200)
 for(const c of [targetCookie,concurrentCookie]) assert.equal((await get('/auth/session',c)).status,401)
 assert.equal((await post('/app/settings/members/change',{operatorId:owner.id,role:'owner'})).status,403)
 assert.equal((await post('/app/settings/members/remove',{operatorId:owner.id})).status,409)
 assert.equal(sql(`SELECT COUNT(*) AS n FROM oa_operators WHERE role='owner' AND status='active'`)[0].n,1)
 // Age only the synthetic fixture's proof. Base's 10-minute window would pass;
 // the product must refuse once the required 5 minutes have elapsed.
 await mutate(`UPDATE oa_step_up_challenges SET consumed_at=${Date.now()-360000} WHERE operator_id=${literal(owner.id)};UPDATE oa_sessions SET created_at=${Date.now()-360000} WHERE operator_id=${literal(owner.id)};`)
 assert.equal((await post('/app/settings/members/invite',{email:'synthetic-porthole-91@example.com',displayName:'Stale',role:'owner'})).status,403)
 assert.equal((await post('/app/settings/members/remove',{operatorId:target.id})).status,403)
 cookie=await freshOwner()
 const other=rows.find(row=>row.productRole==='responder')
 assert.equal((await post('/app/settings/members/change',{operatorId:other.id,role:'owner',confirmEmail:other.email})).status,200)
 const otherOwner=await signIn(other.email)
 assert.equal((await post('/app/settings/members/change',{operatorId:other.id,role:'read-only analyst',scope},otherOwner)).status,200)
 assert.equal((await get('/auth/session',otherOwner)).status,401)
 const typed=await post('/app/settings/members/change',{operatorId:target.id,role:'owner',confirmEmail:'wrong@example.com'})
 assert.equal(typed.status,400)
 assert.equal((await post('/app/settings/members/change',{operatorId:target.id,role:'maintainer',scope})).status,200)
 targetCookie=await signIn(target.email)
 // A real Base personal credential planted at its paid/network credential edge.
 const personal=randomBytes(32).toString('base64url'),digest=await hashToken(sessionSecret,'credential',personal)
 await mutate(`INSERT INTO oa_credentials(id,token_hash,operator_id,operator_version,kind,expires_at) SELECT ${literal(randomUUID())},${literal(digest)},id,version,'native',${Date.now()+3600000} FROM oa_operators WHERE id=${literal(target.id)};`)
 assert.equal((await fetch(origin+'/api/porthole/v1/session',{headers:{authorization:'Bearer '+personal}})).status,200)
 assert.equal((await post('/app/settings/members/remove',{operatorId:target.id})).status,200)
 assert.equal((await fetch(origin+'/api/porthole/v1/session',{headers:{authorization:'Bearer '+personal}})).status,401)
 assert.equal((await get('/auth/session',targetCookie)).status,401)
 assert.ok(sql(`SELECT revoked_at FROM oa_credentials WHERE operator_id=${literal(target.id)}`)[0].revoked_at)
 assert.equal((await get('/app/settings/members')).status,200)
 const migration=sql('SELECT * FROM porthole_membership_migration')
 assert.equal(migration.length,3)
 assert.ok(migration.every(row=>row.gained_access===0))
 const previousMember=migration.find(row=>row.previous_role==='member')
 assert.equal(previousMember.assigned_role,'read-only analyst')
 assert.deepEqual(JSON.parse(previousMember.assigned_scope),{services:[],environments:[],teams:[]})
 const migrationPage=await (await get('/app/settings/members')).text()
 assert.ok(migrationPage.includes(previousMember.operator_id))
 await membershipBrowser({origin,cookie,contractorCookie})
 console.log('membershipJourney passed: seven roles, links, no escalation, fresh proof, revision fence, last owner and removal')
 return {cookie,target,admin,contractor,scope}
}
export async function membershipBrowser({origin,cookie,contractorCookie}) {
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
   const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
   await page.goto(origin+'/app/settings/members');await page.getByRole('heading',{name:'Members',exact:true,level:1}).waitFor()
   assert.ok(await page.getByRole('heading',{name:'Migration report'}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none')
   if(process.env.PORTHOLE_EVIDENCE_DIR) {await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`members-${width}.png`),fullPage:true})}
   if(process.env.PORTHOLE_EVIDENCE_DIR) {await page.getByRole('heading',{name:'Migration report'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`members-migration-${width}.png`)})}
   await page.getByLabel('Email',{exact:true}).fill(`synthetic-porthole-browser-${width}@example.com`)
   await page.getByLabel('Display name',{exact:true}).fill('Checkout on-call responder')
   await page.getByRole('combobox').first().selectOption('responder')
   await page.getByLabel('Services (comma separated; * for all)',{exact:true}).first().fill('checkout')
   await page.getByLabel('Environments (comma separated)',{exact:true}).first().fill('production')
   await page.getByLabel('Teams (comma separated)',{exact:true}).first().fill('commerce')
   await page.getByRole('button',{name:'Send invitation',exact:true}).click()
   await page.getByRole('heading',{name:'Checkout on-call responder',exact:true}).last().waitFor()
   await page.getByRole('link',{name:'Credentials',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/app/settings/credentials')
   await context.clearCookies()
   await context.addCookies(contractorCookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
   const denied=await page.goto(origin+'/app/settings/members');assert.equal(denied.status(),403)
   await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('combobox').count(),0)
   if(process.env.PORTHOLE_EVIDENCE_DIR) await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`members-restricted-${width}.png`),fullPage:true})
   assert.deepEqual(errors,[]);await context.close()
  }
 } finally {await browser.close()}
}
