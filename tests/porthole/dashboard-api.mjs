import {localAgentPolicy,refusal} from '../agent-door/local-policy.mjs'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'

export async function dashboardApiJourney({origin,cookie,freshOwner,signIn}) {
 cookie=await freshOwner()
 const root='/api/porthole/v1/dashboards',scope={services:['checkout'],environments:['production'],teams:['commerce']}
 const panels=[{id:'cpu',title:'Checkout CPU',signal:'metrics',service:'checkout',metric:'checkout.cpu',aggregate:'average',unit:'%'},{id:'logs',title:'Checkout logs',signal:'logs',service:'checkout',aggregate:'count',unit:'records'},{id:'latency',title:'Checkout latency',signal:'traces',service:'checkout',aggregate:'p95',unit:'ms'}]
 const definition=(name,selected=panels,team='commerce')=>({name,scope:{...scope,teams:[team]},body:{panels:selected,variables:{team,environment:'production'},range:{from:'0',through:'18446744073709551615'},annotations:[]}})
 const post=(path,body,{session=cookie,secret,key}={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json',...(path.endsWith('/mcp')?{'mcp-protocol-version':'2025-11-25'}:{}),...(secret?{authorization:`Bearer ${secret}`}:{}) ,...(key?{'idempotency-key':key}:{})},body:JSON.stringify(body)})
 const get=(path,secret,session=cookie)=>fetch(origin+path,{headers:{cookie:session,...(secret?{authorization:`Bearer ${secret}`}:{})}})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const create=async(body,key=randomUUID())=>({receipt:await value(await post(root,body,{key}),201),key,body})
 const cli=(args,{secret,session='',body}={})=>new Promise((resolve,reject)=>{
  const childEnv={...process.env,PORTHOLE_SESSION:session}
  delete childEnv.PORTHOLE_CREDENTIAL
  if(secret)childEnv.PORTHOLE_CREDENTIAL=secret
  const child=spawn(process.execPath,['cli/porthole.mjs',origin,...args],{env:childEnv,stdio:['pipe','pipe','pipe']})
  let stdout='',stderr=''
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)
  child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.end(body===undefined?'':JSON.stringify(body))
 })
 await localAgentPolicy(origin,cookie)
 const rpc=(secret,args)=>post('/api/porthole/v1/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'porthole.definitions.read',arguments:{collection:'dashboards',...args}}},{secret})
 const mint=async(signals=['metrics','logs','traces'],extra={})=>value(await post('/app/settings/credentials/mint',{name:'Dashboard scoped reading',class:'read',scope:{...scope,signals,actions:['definitions.read']},...extra}),201)
 assert.equal((await get(root,undefined,'')).status,401)
 const first=await create(definition('Checkout API performance')),id=first.receipt.id
 const replay=await value(await post(root,first.body,{key:first.key}),201)
 assert.deepEqual(replay,first.receipt,'same key replays the committed dashboard receipt')
 assert.equal((await post(root,definition('Conflicting dashboard'),{key:first.key})).status,409)
 const concurrentKey=randomUUID(),concurrentBody=definition('Checkout API concurrent dashboard')
 const concurrent=await Promise.all([post(root,concurrentBody,{key:concurrentKey}),post(root,concurrentBody,{key:concurrentKey})])
 const concurrentRows=await Promise.all(concurrent.map(response=>value(response,201)))
 assert.equal(concurrentRows[0].id,concurrentRows[1].id)
 const logOnly=await create(definition('Checkout API log dashboard',[panels[1]]))
 const foreign=await create(definition('Payments private dashboard',panels,'payments'))
 const all=await mint(),logs=await mint(['logs'])
 assert.equal((await get(root+'/'+id,logs.secret)).status,404,'owner cookie cannot expand panel signal authority')
 assert.equal((await get(root+'/'+logOnly.receipt.id,logs.secret)).status,200)
 assert.equal((await get(root+'/'+foreign.receipt.id,all.secret)).status,404)
 for(const path of [root+'?unknown=1',root+'?limit=1&limit=2',root+'/'+id+'?cursor=anything',root+'/'+id+'?version=0'])assert.equal((await get(path,all.secret)).status,400)
 const rest=[];let cursor
 do {
  const page=await value(await get(root+'?limit=1'+(cursor?'&cursor='+cursor:''),all.secret))
  rest.push(...page.objects);cursor=page.cursor
 }while(cursor)
 assert.ok(rest.some(row=>row.id===id)&&rest.some(row=>row.id===logOnly.receipt.id))
 assert.ok(!rest.some(row=>row.id===foreign.receipt.id))
 const command=await cli(['list','dashboards','--all','--limit','1'],{secret:all.secret})
 assert.equal(command.code,0,command.stderr)
 const commandRows=command.stdout.trim().split('\n').flatMap(line=>JSON.parse(line).objects)
 assert.deepEqual(commandRows.map(row=>row.id),rest.map(row=>row.id))
 const mcp=[];cursor=undefined
 do {
  const page=(await value(await rpc(all.secret,{limit:1,...(cursor?{cursor}:{})}))).result.structuredContent
  mcp.push(...page.objects);cursor=page.cursor
 }while(cursor)
 assert.deepEqual(mcp.map(row=>row.id),rest.map(row=>row.id))
 const updateKey=randomUUID(),onlyLogs={...definition('Checkout API changed dashboard',[panels[1]]),id,revision:first.receipt.revision}
 const updated=await value(await post(root,onlyLogs,{key:updateKey}),201)
 assert.deepEqual(await value(await post(root,onlyLogs,{key:updateKey}),201),updated)
 assert.equal((await post(root,{...first.body,id,revision:first.receipt.revision},{key:randomUUID()})).status,409)
 const narrow=await value(await get(root+'/'+id,logs.secret))
 assert.ok(narrow.versions.includes(updated.revision));assert.ok(!narrow.versions.includes(first.receipt.revision))
 assert.equal((await get(root+'/'+id+'?version='+first.receipt.revision,logs.secret)).status,404)
 const historical=await value(await get(root+'/'+id+'?version='+first.receipt.revision,all.secret))
 assert.equal(historical.body.panels.length,3)
 const historyCommand=await cli(['get','dashboards',id,'--version',String(first.receipt.revision)],{secret:all.secret})
 assert.equal(historyCommand.code,0,historyCommand.stderr);assert.deepEqual(JSON.parse(historyCommand.stdout).body,historical.body)
 const historyTool=(await value(await rpc(all.secret,{id,version:first.receipt.revision}))).result.structuredContent
 assert.deepEqual(historyTool.body,historical.body)
 const fullAgain=await value(await post(root,{...first.body,id,revision:updated.revision},{key:randomUUID()}),201)
 assert.equal((await get(root+'/'+id+'?version='+updated.revision,logs.secret)).status,404,'a permitted historical signal cannot bypass current panel grants')
 const moved=await value(await post(root,{...definition('Dashboard moved to payments',panels,'payments'),id,revision:fullAgain.revision},{key:randomUUID()}),201)
 assert.equal((await get(root+'/'+id+'?version='+first.receipt.revision,all.secret)).status,404,'history also requires current whole-definition scope')
 await value(await post(root,{...first.body,id,revision:moved.revision},{key:randomUUID()}),201)
 assert.ok(!(await value(await get(root+'/'+id,all.secret))).versions.includes(moved.revision))
 assert.equal((await get(root+'/'+id+'?version='+moved.revision,all.secret)).status,404)
 const readonlyEmail=`dashboard-reader-${randomUUID()}@example.com`
 assert.equal((await post('/app/settings/members/invite',{email:readonlyEmail,displayName:'Dashboard reader',role:'read-only analyst',scope})).status,202)
 const reader=await signIn(readonlyEmail)
 assert.equal((await get(root+'/'+id,undefined,reader)).status,200)
 assert.equal((await get(root+'/'+foreign.receipt.id,undefined,reader)).status,403)
 assert.equal((await post(root,definition('Denied native mutation'),{session:reader,key:randomUUID()})).status,403)
 const financeEmail=`dashboard-finance-${randomUUID()}@example.com`
 assert.equal((await post('/app/settings/members/invite',{email:financeEmail,displayName:'Dashboard finance reader',role:'finance reader',scope})).status,202)
 const finance=await signIn(financeEmail)
 assert.equal((await get(root,undefined,finance)).status,403)
 assert.equal((await get(root+'/'+id,undefined,finance)).status,403)
 assert.equal((await post(root,definition('Denied delegated mutation'),{secret:all.secret,key:randomUUID()})).status,403)
 const denied=await cli(['update','dashboards',id,'--revision','1','--key',randomUUID()],{secret:all.secret,session:cookie,body:first.body})
 assert.equal(denied.code,1);assert.match(denied.stderr,/403/)
 const createdByCLI=await cli(['create','dashboards','--key',randomUUID()],{session:cookie,body:definition('Checkout CLI dashboard')})
 assert.equal(createdByCLI.code,0,createdByCLI.stderr)
 const cliObject=JSON.parse(createdByCLI.stdout)
 const cliChanged=await cli(['update','dashboards',cliObject.id,'--revision',String(cliObject.revision),'--key',randomUUID()],{session:cookie,body:definition('Checkout CLI updated dashboard')})
 assert.equal(cliChanged.code,0,cliChanged.stderr)
 const cliRevision=JSON.parse(cliChanged.stdout).revision,archiveKey=randomUUID()
 for(let replay=0;replay<2;replay++)assert.equal((await cli(['archive','dashboards',cliObject.id,'--revision',String(cliRevision),'--key',archiveKey],{session:cookie})).code,0)
 assert.equal((await value(await get(root+'/'+cliObject.id))).state,'archived','archive retry never reactivates the dashboard')
 cookie=await freshOwner()
 const limited=await mint(['metrics','logs','traces'],{requestsPerMinute:1})
 assert.equal((await get(root,limited.secret)).status,200)
 const throttled=await rpc(limited.secret,{limit:1})
 assert.equal(throttled.status,429);assert.ok(Number(throttled.headers.get('retry-after'))>0)
 const rpcRefusal=await throttled.json();assert.ok(Number.isSafeInteger(rpcRefusal.error.code));assert.ok(rpcRefusal.error.message.length>0)
 const restRefusal=await get(root,limited.secret);assert.equal(restRefusal.status,429)
 const refusal=await restRefusal.json();assert.equal(refusal.details.status,429);assert.equal(refusal.details.code,refusal.error);assert.match(refusal.details.requestId,/^[a-f0-9-]{36}$/)
 assert.equal((await post('/app/settings/credentials/revoke',{id:all.credential.id})).status,200)
 assert.equal((await get(root,all.secret)).status,401)
 assert.equal((await rpc(all.secret,{id})).status,401)
 assert.equal((await cli(['list','dashboards','--all'],{secret:all.secret})).code,1)
 console.log('Dashboard API journey passed: scoped HTTP, CLI and MCP, panel signal and historical authority, durable native mutations, quota and revocation')
}
