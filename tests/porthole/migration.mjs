import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const vendors={splunk:'charts',dash0:'dashboards',signoz:'dashboards',clickstack:'savedSearches',honeycomb:'boards',resolve:'investigations',cleric:'investigations',traversal:'investigations'}
export async function migrationJourney({origin,cookie,foreignCookie,restartWorker,signIn,freshOwner}){
 const post=(action,body,source='splunk',session=cookie,extra={})=>fetch(origin+'/api/operator/import/'+action,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json','x-import-source':source,...extra},body:JSON.stringify(body)})
 const json=async(action,body,source='splunk',status=200)=>{const r=await post(action,body,source);const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value}
 const snapshot=async()=>{const r=await fetch(origin+'/api/porthole/v1/migration/records',{headers:{cookie}});assert.equal(r.status,200);return (await r.json()).records}
 const upload=async(source,value)=>{
  const bytes=Buffer.from(JSON.stringify(value)),totalChunks=Math.ceil(bytes.length/65536);let uploadId
  for(let index=0;index<totalChunks;index++){
   const chunk=bytes.subarray(index*65536,(index+1)*65536)
   const result=await json('uploads',{uploadId,name:'synthetic-porthole-43.json',bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks,index,chunkSha256:hash(chunk),base64:chunk.toString('base64')},source)
   uploadId=result.uploadId
  }
  return json('plan',{uploadId},source)
 }
 const finish=async(action,body,source,state)=>{for(let n=0;n<30;n++){const r=await json(action,body,source);if(r.job.state===state)return r;assert.ok(['queued','applying','undoing'].includes(r.job.state))}assert.fail('bounded import did not finish')}
 assert.equal((await post('uploads',{},'splunk','')).status,401)
 // This request uses a foreign installation session rather than a fabricated cookie.
 assert.equal((await post('uploads',{},'splunk',foreignCookie)).status,401)
 const member=await signIn('synthetic-porthole-11@example.com')
 assert.equal((await post('uploads',{},'splunk',member)).status,403)
 assert.equal((await post('uploads',{},'splunk',cookie,{origin:'https://foreign.invalid'})).status,403)
 assert.equal((await post('uploads',{},'unlisted')).status,400)
 assert.equal((await fetch(origin+'/api/rer/import/uploads',{method:'POST'})).status,404)
 assert.equal((await fetch(origin+'/api/porthole/v1/migration/records')).status,401)
 // Obtain a fresh proof after the real auth fixture has restarted the Worker.
 cookie=await freshOwner()
 const captures=[]
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const capture=async(name,path='/app/import',act)=>{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(value=>{const p=value.indexOf('=');return {name:value.slice(0,p),value:value.slice(p+1),url:origin}}))
   const page=await context.newPage();await page.goto(origin+path);if(act)await act(page)
   await page.locator('h1').waitFor();assert.equal(await page.locator('h1').count(),1)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow')
   const controls=await page.locator('button').allTextContents();assert.ok(controls.every(s=>s.trim().length>1),'all controls have visible word labels; no icon-only controls')
   const directory=process.env.PORTHOLE_BROWSER_EVIDENCE??'test-results/migration';await mkdir(directory,{recursive:true})
   const screenshotPath=join(directory,`${name}-${width}.png`);await page.screenshot({path:screenshotPath,fullPage:true});captures.push(screenshotPath);await context.close()
  }
 }
 try{
  await capture('move-in-empty');await capture('move-in-guide','/app/import/guide')
  const definitions=Array.from({length:25},(_,i)=>({id:`synthetic-porthole-${i}`,name:`Chart ${i}`,programText:"data('requests', filter=filter('service', 'checkout')).sum().publish()",options:{variables:[{property:'environment',value:'test'}]},tags:['team:ops','customer:synthetic-porthole-43']}))
  const source={charts:definitions,detectors:[{id:'synthetic-porthole-100',programText:"detect(data('requests').sum() > 10).publish('high')",rules:[{detectLabel:'high',severity:'Critical'}],tags:['team:ops']}],services:[{id:'synthetic-porthole-101',serviceName:'checkout',tags:['team:ops']}],logSearches:[{id:'synthetic-porthole-102',query:'index=application | stats count by service'}],securityDashboards:[{id:'synthetic-porthole-103',name:'Security investigation',sourceReference:'https://security.example.invalid/dashboard'}],unknownCollection:[{id:'synthetic-porthole-104'}]}
  const baselineArchive=await fetch(origin+'/api/porthole/v1/archive/exports',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});assert.equal(baselineArchive.status,201)
  const before=await snapshot(),plan=await upload('splunk',source)
  assert.equal(plan.summary.sourceRecords,30);assert.equal(plan.rejected.length,1);assert.match(plan.rejected[0].reason,/Unsupported/)
  assert.deepEqual(await snapshot(),before,'preview has no native effects')
  const excludedArchive=await fetch(origin+'/api/porthole/v1/archive/exports',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});assert.equal(excludedArchive.status,409);assert.equal((await excludedArchive.json()).error,'migration_custody_archive_pending')
  await json('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},'splunk',403)
  assert.deepEqual(await snapshot(),before,'wrong fingerprint has no effects')
  const first=await json('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})
  assert.equal(first.job.state,'applying');assert.ok(first.job.checkpoint>0&&first.job.checkpoint<first.job.total)
  await restartWorker();cookie=await freshOwner()
  await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},'splunk','completed')
  const rows=await snapshot();assert.equal(rows.length-before.length,29)
  const chart=rows.find(r=>r.targetId==='splunk:charts:synthetic-porthole-0');assert.deepEqual(chart.value.definition,definitions[0])
  const security=rows.find(r=>r.targetKind==='securityDashboards');assert.equal(security.value.specialist,'Splunk Enterprise Security')
  assert.match(chart.value.qualification,/unproved/)
  const report=await json('reconcile',{planId:plan.planId});assert.equal(report.ok,true);assert.equal(report.counts.sourceRecords,30);assert.equal(report.counts.nativeTargets,29);assert.equal(report.counts.present,0);assert.equal(report.counts.explained,30)
  await capture('move-in-applied')
  await finish('undo',{planId:plan.planId},'splunk','undone');assert.deepEqual(await snapshot(),before)
  console.log('Splunk source-evidence import: reviewed fingerprint, 30 records, 29 exact retained definitions, named rejection, cold resume, specialist boundary, reconciliation and undo passed')
  for(const [vendor,collection]of Object.entries(vendors).filter(([v])=>v!=='splunk')){
   const definition={id:'synthetic-porthole-44',name:'Prior source object',query:{expression:'unsupported native function'},attributes:{'customer.id':'synthetic-porthole-777'},sampling:{probability:0.1},retention:{days:30},permissions:{team:'ops'},openIssues:[{id:'synthetic-porthole-445',state:'open'}],historyReference:'https://source.example.invalid/retained-history',connector:{scope:['read']},apiKey:'synthetic-porthole-446'}
   const clean={...definition};delete clean.apiKey
   const plan=await upload(vendor,{[collection]:[definition]})
   assert.equal(plan.summary.sourceRecords,1);assert.ok(plan.diagnostics.some(d=>d.code==='CREDENTIAL_REMOVED'))
   await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},vendor,'completed')
   await restartWorker();cookie=await freshOwner()
   const current=await snapshot();assert.equal(current.length,1);assert.deepEqual(current[0].value.definition,clean);assert.equal(current[0].value.vendor,vendor)
   const reconciliation=await json('reconcile',{planId:plan.planId},vendor);assert.equal(reconciliation.ok,true);assert.equal(reconciliation.counts.nativeTargets,1);assert.equal(reconciliation.counts.explained,1)
   await finish('undo',{planId:plan.planId},vendor,'undone');assert.deepEqual(await snapshot(),before)
  }
  // A newly authorized native owner is the reviewer, even though the
  // installation was configured with the first owner's email.
  const targetSession=await (await fetch(origin+'/auth/session',{headers:{cookie:member}})).json()
  const promoted=await fetch(origin+'/app/settings/members/change',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({operatorId:targetSession.operator.id,role:'owner',confirmEmail:'synthetic-porthole-11@example.com'})})
  assert.equal(promoted.status,200)
  const originalCookie=cookie;cookie=await signIn('synthetic-porthole-11@example.com')
  const ownerPlan=await upload('dash0',{dashboards:[{id:'synthetic-porthole-449',name:'Second owner review'}]})
  await finish('apply',{planId:ownerPlan.planId,reviewedFingerprint:ownerPlan.fingerprint},'dash0','completed')
  const approved=await json('status',{planId:ownerPlan.planId},'dash0')
  assert.equal(approved.approval.owner,'synthetic-porthole-11@example.com')
  await finish('undo',{planId:ownerPlan.planId},'dash0','undone');assert.deepEqual(await snapshot(),before)
  cookie=originalCookie
  // The screen calls the same shared door, with explicit review and native reads.
  const one={charts:[{id:'synthetic-porthole-4300',name:'Browser chart',tags:['team:ops']}]}
  await capture('move-in-preview','/app/import',async page=>{
   await page.locator('input[type=file]').setInputFiles({name:'synthetic-porthole-43.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(one))})
   await page.getByRole('button',{name:'Save preview',exact:true}).click();await page.getByRole('heading',{name:'Saved plan and result'}).waitFor()
   assert.match(await page.locator('body').innerText(),/Native query translation/)
  })
  await capture('move-in-history')
  console.log('Seven challenger source-evidence readers: exact sanitized definitions, high-cardinality metadata, source scope and open-history references, persisted resume, reconciliation and undo passed')
  console.log('Migration browser proof passed at 1440 and 390:',captures.length,'screens; no icon-only controls')
 }finally{await browser.close()}
}
