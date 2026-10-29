import {localAgentPolicy,refusal} from '../agent-door/local-policy.mjs'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'

/** Public HTTP and spawned CLI journey; the host owns the real Worker. */
export async function apiJourney({origin,cookie,freshOwner}) {
 cookie=await freshOwner()
 const root='/api/porthole/v1/configuration/monitors'
 const scope={services:['checkout-api'],environments:['review'],teams:['commerce-api']}
 const monitor=name=>({name,scope,body:{signal:'logs',operator:'above',threshold:5,windowSeconds:60}})
 const headers={cookie,origin,'content-type':'application/json'}
 const native=(path,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)})
 const create=async(body,key=randomUUID())=>{
  const response=await native(root,'POST',body,{'idempotency-key':key})
  assert.equal(response.status,201);return {value:await response.json(),key}
 }
 const cli=(args,secret,body)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['cli/porthole.mjs',origin,...args],{env:{...process.env,PORTHOLE_CREDENTIAL:secret,PORTHOLE_SESSION:''},stdio:['pipe','pipe','pipe']})
  let stdout='',stderr=''
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)
  child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.end(body===undefined?'':JSON.stringify(body))
 })
 assert.equal((await fetch(origin+root)).status,401)
 const firstBody=monitor('Checkout API error count'),first=await create(firstBody)
 const replay=await native(root,'POST',firstBody,{'idempotency-key':first.key})
 assert.equal(replay.status,201);assert.equal(replay.headers.get('idempotency-replayed'),'true');assert.deepEqual(await replay.json(),first.value)
 const conflict=await native(root,'POST',monitor('Different definition'),{'idempotency-key':first.key})
 assert.equal(conflict.status,409)
 const concurrentKey=randomUUID(),concurrentBody=monitor('Checkout API concurrent apply')
 const concurrent=await Promise.all([native(root,'POST',concurrentBody,{'idempotency-key':concurrentKey}),native(root,'POST',concurrentBody,{'idempotency-key':concurrentKey})])
 assert.deepEqual(concurrent.map(response=>response.status),[201,201])
 const concurrentValues=await Promise.all(concurrent.map(response=>response.json()))
 assert.equal(concurrentValues[0].id,concurrentValues[1].id,'one durable definition for concurrent replay')
 const second=await create(monitor('Checkout API rate alert'))
 await create({...monitor('Payments API private alert'),scope:{...scope,teams:['payments-api']}})
 await create({...monitor('Checkout API trace alert'),body:{signal:'traces',operator:'above',threshold:1,windowSeconds:60}})
 const detail=await native(root+'/'+first.value.id)
 assert.equal(detail.status,200)
 const etag=detail.headers.get('etag');assert.ok(etag)
 const changed={...firstBody,name:'Checkout API updated error count'}
 const updateKey=randomUUID()
 const update=await native(root+'/'+first.value.id,'PUT',changed,{'if-match':etag,'idempotency-key':updateKey})
 assert.equal(update.status,200);const updated=await update.json();assert.equal(updated.revision,first.value.revision+1)
 assert.equal((await native(root+'/'+first.value.id,'PUT',changed,{'idempotency-key':randomUUID()})).status,428)
 assert.equal((await native(root+'/'+first.value.id,'PUT',firstBody,{'if-match':etag,'idempotency-key':randomUUID()})).status,412)
 const uiEdit=await native('/app/operations/save','POST',{id:first.value.id,kind:'monitor',revision:updated.revision,...firstBody,name:'Checkout API native edit'})
 assert.equal(uiEdit.status,201)
 assert.equal((await native(root+'/'+first.value.id,'PUT',changed,{'if-match':update.headers.get('etag'),'idempotency-key':randomUUID()})).status,412,'concurrent native edit refuses stale API apply')
 const updateReplay=await native(root+'/'+first.value.id,'PUT',changed,{'if-match':etag,'idempotency-key':updateKey})
 assert.equal(updateReplay.status,200);assert.deepEqual(await updateReplay.json(),updated)
 const mint=async(extra={})=>{
  const response=await native('/app/settings/credentials/mint','POST',{name:'Scoped configuration investigation',class:'read',scope:{...scope,signals:['logs'],actions:['definitions.read']},...extra})
  assert.equal(response.status,201);return response.json()
 }
 const key=await mint(),auth={authorization:`Bearer ${key.secret}`}
 const read=path=>fetch(origin+path,{headers:auth})
 const pages=await cli(['list','monitors','--all','--limit','1'],key.secret)
 assert.equal(pages.code,0,pages.stderr)
 const rows=pages.stdout.trim().split('\n').map(line=>JSON.parse(line)).flatMap(page=>page.objects)
 assert.deepEqual(new Set(rows.map(row=>row.id)),new Set([first.value.id,second.value.id,concurrentValues[0].id]))
 assert.ok(rows.every(row=>row.scope.teams.includes('commerce-api')&&row.body.signal==='logs'))
 await localAgentPolicy(origin,cookie)
 const mcp=async(name,args={})=>fetch(origin+'/api/porthole/v1/mcp',{method:'POST',headers:{...auth,'content-type':'application/json','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})
 const tool=await mcp('porthole.definitions.read',{collection:'monitors',limit:1})
 assert.equal(tool.status,200)
 const result=(await tool.json()).result.structuredContent
 assert.equal(result.objects.length,1);assert.ok(result.cursor)
 assert.equal((await mcp('porthole.definitions.read',{collection:'monitors',id:first.value.id})).status,200)
 assert.equal((await native(root,'POST',firstBody,{...auth,'idempotency-key':randomUUID()})).status,403,'native cookie cannot escalate bearer')
 assert.equal(refusal(await (await mcp('approval.create')).json()),'tool_not_found')
 const privateRows=(await (await native(root+'?limit=200')).json()).objects
 const foreign=privateRows.find(row=>row.scope.teams.includes('payments-api'))
 assert.equal((await read(root+'/'+foreign.id)).status,404)
 const signalRestricted=privateRows.find(row=>row.scope.teams.includes('commerce-api')&&row.body.signal==='traces')
 assert.equal((await read(root+'/'+signalRestricted.id)).status,404)
 const deniedMutation=await cli(['update','monitors',first.value.id,'--revision','1','--key',randomUUID()],key.secret,firstBody)
 assert.equal(deniedMutation.code,1);assert.match(deniedMutation.stderr,/403/)
 const limited=await mint({requestsPerMinute:1})
 assert.equal((await fetch(origin+root,{headers:{authorization:`Bearer ${limited.secret}`}})).status,200)
 const throttled=await fetch(origin+root,{headers:{authorization:`Bearer ${limited.secret}`}})
 assert.equal(throttled.status,429);assert.ok(Number(throttled.headers.get('retry-after'))>0)
 assert.equal((await throttled.json()).details.status,429)
 assert.equal((await native('/app/settings/credentials/revoke','POST',{id:key.credential.id})).status,200)
 assert.equal((await read(root)).status,401)
 assert.equal((await mcp('porthole.definitions.read',{collection:'monitors'})).status,401)
 assert.equal((await cli(['list','monitors','--all'],key.secret)).code,1)
 const archived=await native(root+'/'+second.value.id,'DELETE',undefined,{'if-match':`"${second.value.revision}"`,'idempotency-key':randomUUID()})
 assert.equal(archived.status,200);assert.equal((await archived.json()).state,'archived');assert.equal((await (await native(root+'/'+second.value.id)).json()).state,'archived')
 console.log('Configuration API journey passed: native revisions and drift, durable idempotency, CLI pagination, scoped MCP definitions, quota, refusal, revocation and audited archival')
}
