import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal} from './fixture.mjs'

/** Native runtime journey: restrictions intersect every existing dashboard door. */
export async function objectGrantsJourney({origin,freshOwner,signIn,sql,restartWorker,withEmptyDestination,withPinnedClock}) {
 let cookie=await freshOwner()
 const root='/api/porthole/v1/dashboards',settings='/app/settings/dashboard-access'
 const scope={services:['checkout'],environments:['production'],teams:['commerce']}
 const post=(path,data,{session=cookie,key,secret}={})=>fetch(origin+path,{...form(origin,session,data),headers:{...form(origin,session,data).headers,...(key?{'idempotency-key':key}:{}),...(secret?{authorization:'Bearer '+secret}:{})}})
 const get=(path,session=cookie,secret)=>fetch(origin+path,{headers:{cookie:session,...(secret?{authorization:'Bearer '+secret}:{})}})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
 const from=String(BigInt(Date.now())*1000000n),through=String(BigInt(from)+1000000000n)
 const body=team=>({variables:{team,environment:'production'},range:{from,through},annotations:[],panels:[{id:'logs',title:'Observed checkout logs',service:'checkout',signal:'logs',aggregate:'count',unit:'records'}]})
 const definition=(name,team='commerce')=>({name,scope:{...scope,teams:[team]},body:body(team)})
 const ingest=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2500',class:'ingest',scope:{...scope,teams:['commerce','payments'],signals:['logs'],actions:['telemetry.write']}}),201)
 for(const [team,count]of [['commerce',3],['payments',2]]) {
  const resource={attributes:Object.entries({'service.name':'checkout','deployment.environment.name':'production','team.name':team}).map(([key,stringValue])=>({key,value:{stringValue}}))}
  const packet={resourceLogs:[{resource,scopeLogs:[{logRecords:Array.from({length:count},(_,index)=>({timeUnixNano:String(BigInt(from)+BigInt(index)),body:{stringValue:'synthetic-porthole-'+(2510+index)}}))}]}]}
  const accepted=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+ingest.secret,'content-type':'application/json','x-porthole-batch-id':randomUUID()},body:JSON.stringify(packet)})
  assert.equal(accepted.status,200,await accepted.text())
 }
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 let a=await value(await post(root,definition('Policy dashboard A')),201),b=await value(await post(root,definition('Policy dashboard B')),201),foreign=await value(await post(root,definition('Policy hidden payments','payments')),201)
 const email=number=>['synthetic-porthole-'+number,'example.invalid'].join(String.fromCharCode(64))
 const invite=async(number,role='maintainer',selected=scope)=>{await value(await post('/app/settings/members/invite',{email:email(number),displayName:'Policy member '+number,role,scope:selected}),202);const session=await signIn(email(number));const person=await value(await get('/auth/session',session));const member=(await sql(`SELECT revision FROM porthole_members WHERE operator_id=${literal(person.operator.id)}`))[0];return {session,id:person.operator.id,revision:member.revision,email:email(number)}}
 const member=await invite(2501),other=await invite(2502),analyst=await invite(2503,'read-only analyst')
 cookie=await freshOwner()
 const entry=(person,access)=>({operatorId:person.id,memberRevision:person.revision,access})
 const review=async(target,entries,policyRevision=0)=>value(await post(settings+'/preview',{dashboardId:target.id,dashboardRevision:target.revision,policyRevision,entries}),201)
 const confirmation=r=>({reviewId:r.id,digest:r.digest,dashboardRevision:r.dashboard_revision,policyRevision:r.policy_revision,confirm:'restrict-dashboard-access'})
 const restrict=async(target,entries,policyRevision=0)=>{const reviewed=await review(target,entries,policyRevision);await value(await post(settings+'/apply',confirmation(reviewed)));return value(await get(root+'/'+target.id))}
 const {policyPublicationFixture,assertPolicyPublicationWithdrawn}=await import('./publication.mjs')
 const publication=await policyPublicationFixture({origin,cookie,dashboard:a})
 const ar=await review(a,[entry(member,'editor')])
 assert.equal((await post(settings+'/apply',{...confirmation(ar),digest:'changed'})).status,409)
 assert.equal((await get(settings,member.session)).status,403)
 assert.equal((await post(settings+'/preview',{dashboardId:a.id,dashboardRevision:a.revision,policyRevision:0,entries:[entry(member,'editor')]},{session:member.session})).status,403)
 await value(await post(settings+'/apply',confirmation(ar)))
 assert.equal((await post(settings+'/apply',confirmation(ar))).status,409,'review is single use')
 a=await value(await get(root+'/'+a.id));b=await restrict(b,[entry(member,'viewer')])
 const admin=await invite(2504,'admin')
 assert.equal((await get(settings,admin.session)).status,200)
 const adminReview=await value(await post(settings+'/preview',{dashboardId:b.id,dashboardRevision:b.revision,policyRevision:1,entries:[entry(member,'viewer')]},{session:admin.session}),201)
 await value(await post(settings+'/apply',confirmation(adminReview),{session:admin.session}))
 b=await value(await get(root+'/'+b.id))
 await assertPolicyPublicationWithdrawn({origin,publication})
 const noPolicyWrites=async(run)=>{const before=await sql(`SELECT * FROM porthole_dashboards ORDER BY id`),history=await sql('SELECT * FROM porthole_dashboard_versions ORDER BY id,revision'),receipts=await sql('SELECT * FROM porthole_api_idempotency ORDER BY actor_ref,request_key'),policies=await sql('SELECT * FROM porthole_dashboard_policies ORDER BY dashboard_id');await run();assert.deepEqual(await sql('SELECT * FROM porthole_dashboards ORDER BY id'),before);assert.deepEqual(await sql('SELECT * FROM porthole_dashboard_versions ORDER BY id,revision'),history);assert.deepEqual(await sql('SELECT * FROM porthole_api_idempotency ORDER BY actor_ref,request_key'),receipts);assert.deepEqual(await sql('SELECT * FROM porthole_dashboard_policies ORDER BY dashboard_id'),policies)}
 await noPolicyWrites(async()=>{
  for(const action of ['save','reorder','clone','archive','panel','annotation']) {
   const data=action==='save'?{...definition('Forbidden B edit'),id:b.id,revision:b.revision}:{id:b.id,revision:b.revision}
   assert.equal((await post('/app/dashboards/'+action,data,{session:member.session,key:randomUUID()})).status,404,action)
  }
  assert.equal((await post(root,{...definition('Forbidden REST B edit'),id:b.id,revision:b.revision},{session:member.session,key:randomUUID()})).status,404)
  assert.equal((await post(settings+'/preview',{dashboardId:a.id,dashboardRevision:a.revision,policyRevision:1,entries:[entry(analyst,'editor')]})).status,403,'policy never promotes an analyst')
  assert.equal((await get(root+'/'+a.id,other.session)).status,404)
  assert.equal((await get(root+'/'+a.id+'?version=1',other.session)).status,404)
  assert.equal((await get(root+'/'+foreign.id,member.session)).status,403,'object policy never expands telemetry scope')
  assert.equal((await get('/app/dashboards/'+a.id+'/publish',member.session)).status,403)
  assert.equal((await post('/api/porthole/v1/archive/exports',{}, {session:member.session})).status,403)
 })
 const allowedBody={...definition('Maintainer edited A'),id:a.id,revision:a.revision},allowedKey=randomUUID()
 a=await value(await post(root,allowedBody,{session:member.session,key:allowedKey}),201)
 assert.deepEqual(await value(await post(root,allowedBody,{session:member.session,key:allowedKey}),201),a)
 assert.equal((await value(await get(root+'/'+a.id+'?version=1',member.session))).body.panels.length,1)
 let page=await get('/app/dashboards/'+a.id,member.session);assert.equal(page.status,200);assert.match(await page.text(),/<strong>3<\/strong> records/,'allowed dashboard resolves only actual commerce records')
 const visible=await value(await get(root+'?limit=1',member.session));assert.ok(visible.objects.length===1)
 const ids=[];let cursor='';do {const page=await value(await get(root+'?limit=1'+(cursor?'&cursor='+cursor:''),member.session));ids.push(...page.objects.map(row=>row.id));cursor=page.cursor}while(cursor)
 assert.ok(ids.includes(a.id)&&ids.includes(b.id)&&!ids.includes(foreign.id));assert.ok(!ids.includes(other.id))
 const cloned=await post('/app/dashboards/clone',{id:a.id,revision:a.revision},{session:member.session,key:randomUUID()});assert.equal(cloned.status,303,await cloned.clone().text())
 const clone=await value(await get(root+'/'+cloned.headers.get('x-porthole-entity')))
 assert.equal((await get(root+'/'+clone.id,member.session)).status,404,'a clone never inherits restrictive grants')
 const {dashboardPolicyTransports}=await import('./dashboard-api.mjs')
 a=await dashboardPolicyTransports({origin,cookie,session:member.session,a:await value(await get(root+'/'+a.id)),b,definition})
 const {dashboardPolicyTerraform}=await import('./terraform.mjs')
 await dashboardPolicyTerraform({origin,session:member.session,a:await value(await get(root+'/'+a.id)),b,definition})
 a=await value(await get(root+'/'+a.id))
 // Native credentials remain read-only even alongside a privileged cookie.
 const reader=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-2520',class:'read',scope:{...scope,signals:['logs'],actions:['definitions.read']}}),201)
 await noPolicyWrites(async()=>{
  assert.equal((await post(settings+'/preview',{dashboardId:a.id,dashboardRevision:a.revision,policyRevision:1,entries:[]},{secret:reader.secret})).status,403)
  assert.equal((await post(root,{...definition('Bearer cannot edit'),id:a.id,revision:a.revision},{secret:reader.secret,key:randomUUID()})).status,403)
 })
 // Owner review binds the payload, actor session, current source and policy.
 const stale=await review(a,[entry(member,'viewer')],1)
 a=await value(await post(root,{...definition('Owner changed after review'),id:a.id,revision:a.revision}),201)
 await noPolicyWrites(async()=>assert.equal((await post(settings+'/apply',confirmation(stale))).status,409))
 const expiring=await review(a,[entry(member,'editor')],1)
 await withPinnedClock(expiring.expires_at+1,async()=>{
  assert.equal((await post(settings+'/apply',confirmation(expiring))).status,403,'expired sign-in proof refuses the privileged action')
 })
 // Two reviewed changes race on one revision: only one can commit.
 const first=await review(a,[entry(member,'editor')],1),second=await review(a,[entry(member,'viewer')],1)
 const race=await Promise.all([post(settings+'/apply',confirmation(first)),post(settings+'/apply',confirmation(second))])
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409])
 a=await value(await get(root+'/'+a.id));a=await restrict(a,[entry(member,'editor')],2)
 console.log('Native dashboard policy review, editor and viewer transports, Terraform and concurrent review passed')
 await policyBrowser({origin,cookie,member:member.session,other:other.session,a,b,settings})
 // A scope change that still covers this dashboard invalidates the reviewed entry.
 await value(await post('/app/settings/members/change',{operatorId:member.id,role:'maintainer',scope:{...scope,environments:['production','staging']}}))
 assert.equal((await get(root+'/'+a.id,member.session)).status,401,'scope changes revoke the old native session')
 member.session=await signIn(member.email)
 assert.equal((await get(root+'/'+a.id,member.session)).status,404,'a fresh session cannot use a stale policy entry')
 member.revision=(await sql(`SELECT revision FROM porthole_members WHERE operator_id=${literal(member.id)}`))[0].revision
 assert.equal((await get(root+'/'+b.id,member.session)).status,404,'the revision change invalidates the old viewer entry too')
 b=await restrict(b,[entry(member,'viewer')],2)
 a=await restrict(a,[entry(member,'editor')],3)
 const revoke=await review(a,[],4)
 const writing={...definition('Concurrent edit before revocation'),id:a.id,revision:a.revision}
 const concurrent=await Promise.all([post(settings+'/apply',confirmation(revoke)),post(root,writing,{session:member.session,key:randomUUID()})])
 assert.ok([200,409].includes(concurrent[0].status));assert.ok([201,404,409].includes(concurrent[1].status))
 if(concurrent[0].status!==200) {a=await value(await get(root+'/'+a.id));a=await restrict(a,[],4)}
 await noPolicyWrites(async()=>{
  assert.equal((await get(root+'/'+a.id,member.session)).status,404)
  assert.equal((await get(root+'/'+a.id+'?version=1',member.session)).status,404)
  assert.equal((await post(root,allowedBody,{session:member.session,key:allowedKey})).status,404,'idempotent replay must recheck current edit authority')
 })
 // Hold the actual rendered page before its response can leave the Worker.
 // Revocation completes through Settings while the original telemetry read waits.
 a=await value(await get(root+'/'+a.id))
 const policyRevision=(await sql(`SELECT revision FROM porthole_dashboard_policies WHERE dashboard_id=${literal(a.id)}`))[0].revision
 a=await restrict(a,[entry(member,'editor')],policyRevision)
 const releaseReview=await review(a,[],policyRevision+1)
 await withPinnedClock(Date.now(),async(_clock,evaluate)=>{
  await evaluate(`globalThis.__policyOriginalText=Response.prototype.text;globalThis.__policyReadHeld=false;globalThis.__policyReadResume=false;Response.prototype.text=async function(){const text=await globalThis.__policyOriginalText.call(this);if(!globalThis.__policyReadHeld&&this.headers.get('content-type')?.startsWith('text/html')&&text.includes(${JSON.stringify(a.name)})){globalThis.__policyReadHeld=true;while(!globalThis.__policyReadResume)await new Promise(resolve=>setTimeout(resolve,10))}return text}`)
  let pending
  try {
   pending=get('/app/dashboards/'+a.id,member.session)
   let held=false
   for(let attempt=0;attempt<100;attempt++) {if((await evaluate('globalThis.__policyReadHeld')).result.value){held=true;break}await new Promise(resolve=>setTimeout(resolve,25))}
   assert.ok(held,'a real authorized dashboard render reached the result-release barrier')
   await value(await post(settings+'/apply',confirmation(releaseReview)))
   await evaluate('globalThis.__policyReadResume=true')
   const refused=await pending;assert.equal(refused.status,409,await refused.clone().text());assert.ok(!(await refused.text()).includes('Observed checkout logs'),'no accumulated panel data leaves after revocation')
  } finally {
   await evaluate('Response.prototype.text=globalThis.__policyOriginalText;globalThis.__policyReadResume=true')
   if(pending)await pending
   await evaluate('delete globalThis.__policyOriginalText;delete globalThis.__policyReadHeld;delete globalThis.__policyReadResume')
  }
 })
 const {policyAgentReleaseJourney}=await import('../agent-door/journey.mjs')
 await policyAgentReleaseJourney({origin,secret:reader.secret,dashboardId:a.id,withPinnedClock,change:async()=>{
  a=await value(await get(root+'/'+a.id))
  const currentPolicy=(await sql(`SELECT revision FROM porthole_dashboard_policies WHERE dashboard_id=${literal(a.id)}`))[0].revision
  a=await restrict(a,[],currentPolicy)
 }})
 console.log('Native dashboard policy stale grants, concurrent mutation and held-render revocation passed')
 const afterRevoke=await value(await get(root,member.session));assert.ok(!afterRevoke.objects.some(row=>row.id===a.id));assert.ok(afterRevoke.objects.some(row=>row.id===b.id))
 const audit=await value(await get('/api/v1/audit/export'))
 const facts=audit.records.map(row=>row.entry)
 assert.ok(facts.some(row=>row.action==='dashboards.policy-change'&&row.phase==='committed'&&row.entityRef===a.id))
 assert.ok(facts.some(row=>row.action==='dashboards.policy-preview'&&row.phase==='denied'))
 assert.ok(!JSON.stringify(audit).includes(reader.secret));assert.ok(!JSON.stringify(audit).includes(member.email))
 await restartWorker()
 assert.equal((await get(root+'/'+a.id,member.session)).status,404)
 await assertPolicyPublicationWithdrawn({origin,publication})
 const {dashboardPolicyArchiveJourney}=await import('./archive.mjs')
 await dashboardPolicyArchiveJourney({origin,freshOwner,withEmptyDestination,dashboardId:b.id,memberEmail:member.email,scope})
 cookie=await freshOwner()
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))
 assert.equal((await get(root,cookie,reader.secret)).status,401,'owner cookie never revives a revoked credential')
 await value(await post('/app/settings/members/remove',{operatorId:member.id}))
 assert.equal((await get(root+'/'+b.id,member.session)).status,401,'a removed person cannot revive a policy entry')
 console.log('PROBE PORT-025 restrictive policies: real multi-team intake and native dashboard pages -> editor A served three commerce logs; viewer B edits refused with unchanged definitions, versions and receipts')
 console.log('PROBE PORT-025 authority: exact Settings review, stale member revision, concurrent revocation and replay -> one policy commit; current restrictions apply to lists, history, clones and mutations')
 console.log('PROBE PORT-025 transports and custody: native REST, spawned CLI, native Terraform, MCP refusals, private archive and old public surfaces -> no role expansion, no transferred grants and no revived public address')
 console.log('Object grants journey passed')
}
async function policyBrowser({origin,cookie,member,other,a,b,settings}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const evidence=process.env.PORTHOLE_EVIDENCE_DIR
 if(evidence)await mkdir(evidence,{recursive:true})
 try {for(const width of [1440,390])for(const [name,session,path]of [['owner-settings',cookie,settings+'?id='+a.id],['editor',member,'/app/dashboards/'+a.id],['viewer',member,'/app/dashboards/'+b.id],['denied',other,'/app/dashboards/'+a.id]]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(session.split('; ').map(part=>({name:part.slice(0,part.indexOf('=')),value:part.slice(part.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),response=await page.goto(origin+path)
  if(width===1440) {
   assert.equal(response.status(),name==='denied'?404:200)
   if(name==='viewer')assert.ok((await page.locator('body').innerText()).includes('Dashboard access: Viewer'))
   if(name==='editor')assert.ok((await page.locator('body').innerText()).includes('Dashboard access: Editor'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'policy states fit the viewport')
   assert.ok(await page.locator('main p,main label,main button,main a,main summary,main pre').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=13)),'policy screens keep readable text')
   assert.equal(await page.locator('button,a').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()&&!node.getAttribute('aria-label')).length),0,'every control has a readable label')
   assert.equal(await page.locator('form[action="/app/dashboards/save"]').count(),name==='editor'?1:0)
   if(name==='owner-settings') {await page.getByLabel('Restrictions JSON').focus();assert.equal(await page.getByLabel('Restrictions JSON').evaluate(element=>element===document.activeElement),true);await page.getByRole('button',{name:'Review restrictions'}).click();await page.getByRole('heading',{name:'Review dashboard access',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Apply these exact restrictions'}).isChecked(),false)}
  }
  if(evidence)await page.screenshot({path:join(evidence,`dashboard-policy-${name}-${width}.png`),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
}
