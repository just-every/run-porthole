import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {splunkReplayJourney} from './splunk-replay.mjs'
import {splunkExtractionJourney} from './splunk-extraction.mjs'
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
 const privateRouteMarker='synthetic-porthole-private-route-marker'
 assert.equal((await post(privateRouteMarker,{})).status,404)
 const auditPacket=await (await fetch(origin+'/api/v1/audit/export',{headers:{cookie}})).text()
 assert.ok(!auditPacket.includes(privateRouteMarker),'request path content stays out of the audit ledger')
 assert.ok(auditPacket.includes('migration.request'),'migration attempts use a fixed private audit label')
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
  const baselineArchive=await fetch(origin+'/api/porthole/v1/archive/exports',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});assert.equal(baselineArchive.status,201)
  const extracted=await splunkExtractionJourney()
  const extractedPlan=await upload('splunk',extracted.definitions)
  assert.equal(extractedPlan.summary.sourceRecords,103);assert.equal(extractedPlan.rejected.length,0)
  await finish('apply',{planId:extractedPlan.planId,reviewedFingerprint:extractedPlan.fingerprint},'splunk','completed')
  const extractedRows=await snapshot()
  assert.deepEqual(extractedRows.find(row=>row.targetKind==='charts').value.definition,extracted.definitions.charts[0])
  await finish('undo',{planId:extractedPlan.planId},'splunk','undone');assert.deepEqual(await snapshot(),[])
  await capture('move-in-empty');await capture('move-in-guide','/app/import/guide')
  const definitions=Array.from({length:25},(_,i)=>({id:`synthetic-porthole-${i}`,name:`Chart ${i}`,programText:"data('requests', filter=filter('service', 'checkout')).sum().publish(label='A')",options:{type:'TimeSeriesChart'},tags:['team:ops','customer:synthetic-porthole-43']}))
  const dashboard={id:'synthetic-porthole-105',name:'Checkout overview',charts:[{chartId:definitions[0].id,column:0,row:0,width:6,height:1}],filters:{variables:[{property:'environment',value:['test'],alias:'Environment',required:true,restricted:false}]},tags:['team:ops']}
  const detector={id:'synthetic-porthole-100',name:'High requests',programText:"A = data('requests').sum(); detect(when(A > 10, lasting='5m'), off=when(A < 5)).publish('high')",rules:[{detectLabel:'high',severity:'Critical',notifications:[{type:'Email',email:'synthetic-porthole-43@example.com'}]}],tags:['team:ops']}
  const simpleDetector={id:'synthetic-porthole-106',name:'Immediate request comparison',programText:"A = data('requests', filter=filter('service', 'checkout')).mean(); detect(when(A > 10)).publish('high')",rules:[{detectLabel:'high',severity:'Critical'}],tags:['team:ops']}
  const source={charts:{count:definitions.length,results:definitions},dashboards:{count:1,results:[dashboard]},detectors:{count:2,results:[detector,simpleDetector]},services:[{id:'synthetic-porthole-101',serviceName:'checkout',tags:['team:ops']}],logSearches:[{id:'synthetic-porthole-102',query:'index=application | stats count by service'}],securityDashboards:[{id:'synthetic-porthole-103',name:'Security investigation',sourceReference:'https://security.example.invalid/dashboard'}],unknownCollection:[{id:'synthetic-porthole-104'}]}
  const before=await snapshot(),plan=await upload('splunk',source)
  assert.equal(plan.summary.sourceRecords,32);assert.equal(plan.rejected.length,1);assert.match(plan.rejected[0].reason,/Unsupported/)
  const diagnostics=plan.diagnostics.filter(d=>d.code==='UNMAPPED')
  for(const name of ['data','filter','.sum','.publish','detect','when','lasting','off'])assert.ok(diagnostics.some(d=>d.message.includes(name)),name+' remains named source work')
  assert.ok(diagnostics.some(d=>d.kind==='logSearches'&&d.message.includes('SPL')&&d.message.includes('stats')))
  assert.ok(diagnostics.some(d=>d.field==='filters.variables'))
  assert.ok(diagnostics.some(d=>d.field==='rules[0].notifications'))
  assert.deepEqual(await snapshot(),before,'preview has no native effects')
  const excludedArchive=await fetch(origin+'/api/porthole/v1/archive/exports',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});assert.equal(excludedArchive.status,409);assert.equal((await excludedArchive.json()).error,'migration_custody_archive_pending')
  await json('apply',{planId:plan.planId,reviewedFingerprint:'0'.repeat(64)},'splunk',403)
  assert.deepEqual(await snapshot(),before,'wrong fingerprint has no effects')
  const first=await json('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint})
  assert.equal(first.job.state,'applying');assert.ok(first.job.checkpoint>0&&first.job.checkpoint<first.job.total)
  await restartWorker();cookie=await freshOwner()
  await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},'splunk','completed')
  const rows=await snapshot();assert.equal(rows.length-before.length,31)
  const chart=rows.find(r=>r.targetId==='splunk:charts:synthetic-porthole-0');assert.deepEqual(chart.value.definition,definitions[0])
  const security=rows.find(r=>r.targetKind==='securityDashboards');assert.equal(security.value.specialist,'Splunk Enterprise Security')
  assert.match(chart.value.qualification,/unproved/)
  assert.deepEqual(rows.find(r=>r.targetKind==='dashboards').value.definition,dashboard)
  assert.deepEqual(rows.find(r=>r.targetKind==='detectors').value.definition,detector)
  const replayWork=rows.find(r=>r.targetKind==='detectors').value.review.expressions[0]
  assert.equal(replayWork.text,detector.programText);assert.equal(replayWork.field,'programText')
  assert.ok(replayWork.constructs.some(c=>c.text==='lasting'&&detector.programText.slice(c.offset).startsWith('lasting')))
  assert.equal(chart.value.review.cutover,'blocked')
  const report=await json('reconcile',{planId:plan.planId});assert.equal(report.ok,true);assert.equal(report.counts.sourceRecords,32);assert.equal(report.counts.nativeTargets,31);assert.equal(report.counts.present,0);assert.equal(report.counts.explained,32)
  await capture('move-in-applied','/app/import',async page=>{assert.ok(await page.getByRole('region',{name:'Security specialist handoff'}).isVisible())})
  await splunkReplayJourney({origin,cookie,capture,member,foreignCookie})
  await finish('undo',{planId:plan.planId},'splunk','undone');assert.deepEqual(await snapshot(),before)
  console.log('Splunk source-evidence import: reviewed fingerprint, 32 records, 31 exact retained definitions, named rejection, cold resume, specialist boundary, reconciliation and undo passed')
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
  // An incomplete list remains visible as a source dependency, never a silently complete export.
  const incomplete=await upload('splunk',{charts:{count:2,results:[definitions[0]]},detectors:{count:'invalid',results:[]},dashboards:{count:0,results:[]}})
  assert.equal(incomplete.rejected.length,2)
  assert.ok(incomplete.rejected.some(r=>r.reason.includes('received 1 of 2')))
  assert.ok(incomplete.rejected.some(r=>r.reason.includes('Invalid official list envelope')))
  await finish('apply',{planId:incomplete.planId,reviewedFingerprint:incomplete.fingerprint},'splunk','completed')
  await finish('undo',{planId:incomplete.planId},'splunk','undone');assert.deepEqual(await snapshot(),before)
  // The screen calls the same shared door, with explicit review and native reads.
  const one={charts:[{id:'synthetic-porthole-4300',name:'Browser chart',programText:"data('requests').mean(over='5m').publish(label='A')",options:{type:'TimeSeriesChart'},tags:['team:ops']}]}
  await capture('move-in-preview','/app/import',async page=>{
   await page.locator('input[type=file]').setInputFiles({name:'synthetic-porthole-43.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(one))})
   await page.getByRole('button',{name:'Save preview',exact:true}).click();await page.getByRole('heading',{name:'Saved plan and result'}).waitFor()
   const unresolved=page.getByRole('region',{name:'Unresolved source work'})
   await unresolved.waitFor();assert.match(await unresolved.innerText(),/Untranslated SignalFlow/)
   assert.match(await unresolved.innerText(),/over/)
   assert.match(await page.locator('body').innerText(),/Native query translation/)
  })
  await capture('move-in-history')
  console.log('Seven challenger source-evidence readers: exact sanitized definitions, high-cardinality metadata, source scope and open-history references, persisted resume, reconciliation and undo passed')
  console.log('Migration browser proof passed at 1440 and 390:',captures.length,'screens; no icon-only controls')
 }finally{await browser.close()}
}
