// Focused public-door proof, run from the product checkout against its emitted
// Worker. Uses synthetic fixture identities and real local D1; no Docker.
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import assert from 'node:assert/strict'
const execute=promisify(execFile),load=path=>import(pathToFileURL(resolve(path)).href)
const {emittedWorker,runtimeTransport}=await load('tests/emitted-worker.mjs')
const {fixture,form,literal}=await load('tests/porthole/fixture.mjs')

const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
const origin='http://127.0.0.1:'+port,persist=await mkdtemp(join(tmpdir(),'porthole-credential-proof-')),setupToken='synthetic-porthole-credential-setup-1234567890'
const env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
const wrangler=(...args)=>execute(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{env,maxBuffer:128*1024*1024})
const sql=async command=>JSON.parse((await wrangler('d1','execute','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json','--json','--command',command)).stdout).flatMap(r=>r.results??[])
let worker;const close=runtimeTransport()
const start=async()=>{worker=await emittedWorker({config:'dist/server/wrangler.json',persist,port,bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'owner@example.com',MAIL_FROM:'synthetic-porthole-4@example.com',SESSION_SECRET:'runtime-session-secret-1234567890123456',SETUP_TOKEN:setupToken}});await worker.ready}
const restartWorker=async change=>{await worker.dispose();await change?.();await start()}
const call=(path,options)=>fetch(origin+path,options)
const send=async(path,cookie,data,status)=>{const r=await call(path,form(origin,cookie,data)),text=await r.text();assert.equal(r.status,status,text);return text?JSON.parse(text):null}
try{
 await wrangler('d1','migrations','apply','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json')
 await start()
 const boot=await call('/auth/bootstrap',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:setupToken,displayName:'Synthetic owner'})});assert.equal(boot.status,303);await boot.text()
 let cookie=boot.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 const setup=await call('/setup',{method:'POST',redirect:'manual',headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes'});assert.equal(setup.status,303);await setup.text()
 const helpers=fixture({origin,sql,restartWorker,sessionSecret:'runtime-session-secret-1234567890123456'})
 cookie=await helpers.freshOwner()
 await send('/app/settings/members/invite',cookie,{email:'synthetic-porthole-8511@example.com',displayName:'Synthetic contractor',role:'restricted contractor',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}},202)
 const restricted=await helpers.signIn('synthetic-porthole-8511@example.com')
 cookie=await helpers.freshOwner()
 const minted=await send('/app/settings/credentials/mint',cookie,{name:'synthetic-porthole-8512',class:'ingest',scope:{services:['checkout','fulfillment'],environments:['production'],teams:['commerce','fulfillment'],signals:['traces'],actions:['telemetry.write']}},201)
 const now=BigInt(Date.now())*1000000n
 const resourceSpans=['checkout','fulfillment'].map((service,i)=>({resource:{attributes:[['service.name',service],['deployment.environment.name','production'],['team.name',i?'fulfillment':'commerce']].map(([key,stringValue])=>({key,value:{stringValue}}))},scopeSpans:[{scope:{name:'synthetic-porthole-8513'},spans:[{traceId:(i?'b':'a').repeat(32),spanId:(i?'d':'c').repeat(16),name:'GET /synthetic',kind:2,startTimeUnixNano:String(now),endTimeUnixNano:String(now+1000000n),status:{code:1}}]}]}))
 const ingest=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+minted.secret,'content-type':'application/json'},body:JSON.stringify({resourceSpans})});assert.equal(ingest.status,200,await ingest.text())
 await send('/api/porthole/v1/ingest/drain',cookie,{},200)
 const query='?'+new URLSearchParams({from:String(now-1n),through:String(now+1000001n)})
 const response=await call('/api/porthole/v1/services'+query,{headers:{cookie}});assert.equal(response.status,200);const services=(await response.json()).services
 const service=services.find(s=>s.service==='checkout'),other=services.find(s=>s.service==='fulfillment');assert.ok(service&&other)
 const change={revision:1,destination:'https://handoff.example/vane',template:'https://handoff.example/vane/service/{service}?environment={environment}&from={from}&through={through}',confirm:'save-handoff'}
 await send('/api/porthole/v1/handoffs/vane',cookie,{...change,revision:0},201)
 const storage=()=>sql('SELECT * FROM porthole_handoff_versions ORDER BY product,revision')
 await sql(`UPDATE porthole_handoff_versions SET destination=${literal('https://handoff.example/?SIG=synthetic-porthole-8510')},template=${literal('https://handoff.example/?%73ig=synthetic-porthole-8510')} WHERE product='vane' AND revision=1`)
 const {chromium}=createRequire(resolve('package.json'))('@playwright/test')
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const packet=resolve(process.env.RER_PROOF_PACKET),screens=[]
 try{
  for(const reader of [{name:'owner-settings',cookie,path:'/app/settings/integrations/handoffs'},{name:'contractor-help',cookie:restricted,path:'/app/help'}]){
   const context=await browser.newContext({viewport:{width:1440,height:900}})
   await context.addCookies(reader.cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
   const page=await context.newPage(),response=await page.goto(origin+reader.path)
   assert.equal(response.status(),200);assert.ok(!(await page.content()).includes('synthetic-porthole-8510'),'legacy credential never enters the rendered page')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===1440?900:844})
    const file=reader.name+'-'+width+'.png';await page.screenshot({path:join(packet,file),fullPage:true});screens.push({file,path:reader.path,width,status:response.status(),assertionWidth:1440})
   }
   await context.close()
  }
 }finally{await browser.close()}
 await writeFile(join(packet,'browser-receipt.json'),JSON.stringify({head:'07a6af131788ac851a58d9d824ff8f128276e426',runtime:'emitted Worker and native sessions; synthetic fixtures',screens},null,2)+'\n')
 console.log('BROWSER_PROOF_PASS')
}finally{await worker?.dispose();await close();await rm(persist,{recursive:true,force:true})}
