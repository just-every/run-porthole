import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
const require=createRequire(import.meta.resolve('@opentelemetry/sdk-node'))
const {LoggerProvider,BatchLogRecordProcessor}=require('@opentelemetry/sdk-logs')
const {resourceFromAttributes}=require('@opentelemetry/resources')
const {OTLPLogExporter}=require('@opentelemetry/exporter-logs-otlp-http')
const root='/api/porthole/v1/logs/clusters'
export const clusterScope={service:'synthetic-porthole-11001',environment:'synthetic-porthole-11002',team:'synthetic-porthole-11003'}
export async function clusterBrowser({origin,cookie,call,path,name,status=200,contains,exercise}){
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{for(const width of process.env.PORTHOLE_EVIDENCE_DIR?[1440,390]:[1440]){
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true})
  if(call)await context.route(origin+'/**',async route=>{const request=route.request(),response=await call(new URL(request.url()).pathname+new URL(request.url()).search,{method:request.method(),headers:request.headers(),...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
  if(cookie)await context.addCookies(cookie.split('; ').map(part=>({name:part.slice(0,part.indexOf('=')),value:part.slice(part.indexOf('=')+1),url:origin})))
  const page=await context.newPage(),response=await page.goto(origin+path)
  if(width===1440){
   assert.equal(response.status(),status)
   for(const text of Array.isArray(contains)?contains:[contains])if(text)assert.ok((await page.locator('body').innerText()).includes(text),text)
   assert.equal(await page.locator('button,a').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).length),0,'text controls need no icon tooltip')
   assert.equal(await page.locator('input,button,li,p,a,h1,h2').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)>=13)),true,'readable control and result text')
   if(exercise)await exercise(page)
   await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'keyboard reaches native controls')
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native pattern view reflows')
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,name+'-'+width+'.png'),fullPage:true})}
  await context.close()
 }}finally{await browser.close()}
}

/** Stock logger and stock exporter, with only a transport relay for the local
 * emitted Worker's self-signed HTTPS fixture. Intake and storage are real. */
export async function logClusterJourney({origin,cookie,call=(path,options)=>fetch(origin+path,options),restartWorker,archive,screens=true,backend='local'}){
 const post=(path,data,headers={cookie})=>call(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
 const scope={services:[clusterScope.service],environments:[clusterScope.environment],teams:[clusterScope.team],signals:['logs'],actions:['telemetry.read']}
 const source=await value(await post('/app/settings/credentials/mint',{name:'Stock pattern producer',class:'ingest',scope:{...scope,actions:['telemetry.write']}}),201)
 const expected=new Map(),wire=[],receipts=[]
 const relay=createServer(async(request,response)=>{
  try{
   const chunks=[];for await(const chunk of request)chunks.push(chunk)
   const body=Buffer.concat(chunks);wire.push(body)
   const accepted=await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body})
   receipts.push({status:accepted.status,batch:accepted.headers.get('x-porthole-batch')})
   response.writeHead(accepted.status,{'content-type':'application/json'});response.end(Buffer.from(await accepted.arrayBuffer()))
  }catch{response.writeHead(500);response.end()}
 })
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve))
 const exporter=new OTLPLogExporter({url:'http://127.0.0.1:'+relay.address().port+'/v1/logs'})
 const provider=new LoggerProvider({resource:resourceFromAttributes({'service.name':clusterScope.service,'deployment.environment.name':clusterScope.environment,'team.name':clusterScope.team}),processors:[new BatchLogRecordProcessor({exporter,maxExportBatchSize:100,maxQueueSize:1000,scheduledDelayMillis:60000})]})
 const logger=provider.getLogger('synthetic-porthole-11004'),at=BigInt(Date.now()-2000)*1000000n
 const subject='synthetic-porthole-11005'
 try{
  // Both shapes share severity: grouping by severity alone must fail.
  for(let index=0;index<236;index++){
   const id='synthetic-porthole-'+(11100+index),distinct=index>=225
   const body=distinct?'Checkout failed: database unavailable request '+(70000+index):'Checkout accepted order '+(80000+index)+' request '+(90000+index)
   expected.set(id,{body,distinct})
   const timestamp=at+BigInt(index)
   logger.emit({body,severityNumber:17,severityText:'ERROR',timestamp:[Number(timestamp/1000000000n),Number(timestamp%1000000000n)],attributes:{'producer.id':id,'cluster.subject':subject}})
  }
  await provider.forceFlush()
 }finally{await provider.shutdown();await new Promise(resolve=>relay.close(resolve))}
 assert.ok(receipts.length>=3);assert.ok(receipts.every(receipt=>receipt.status===200),JSON.stringify(receipts))
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const query={...clusterScope,from:String(at),through:String(at+1000000000n),limit:1}
 const search=(data={},headers={cookie})=>post(root,{...query,...data},headers)
 assert.equal((await search({},{})).status,401)
 for(const data of [{signal:'traces'},{scanLimit:0},{limit:201},{record:'synthetic-porthole-1'},{cursor:'broken'},{dialect:'sql',expression:'SELECT COUNT(*) FROM logs'}])await value(await search(data),400)
 const partial=await value(await search({scanLimit:200}))
 assert.equal((await value(await search({scanLimit:236}))).state,'complete','an exact scan bound remains complete')
 assert.equal(partial.state,'partial');assert.equal(partial.scanned,200);assert.equal(partial.reason,'scan_limit');assert.equal(partial.totalRecords,null);assert.deepEqual(partial.clusters,[]);assert.deepEqual(partial.records,[])
 let first=await value(await search()),all=[...first.clusters]
 assert.equal(first.state,'complete');assert.equal(first.totalRecords,236);assert.equal(first.totalClusters,2);assert.ok(first.cursor)
 const snapshot=first.snapshot
 const second=await value(await search({snapshot,cursor:first.cursor}));all.push(...second.clusters)
 assert.equal(second.cursor,null);assert.deepEqual(all.map(cluster=>cluster.count).sort((a,b)=>a-b),[11,225]);assert.notEqual(all[0].id,all[1].id)
 const repeated=all.find(cluster=>cluster.count===225),distinct=all.find(cluster=>cluster.count===11)
 assert.ok(repeated.pattern.template.startsWith('Checkout accepted order'));assert.ok(distinct.pattern.template.startsWith('Checkout failed: database unavailable'))
 const originalIds=new Set(),members=[]
 for(const group of all){
  let cursor=null,count=0
  do{
   const result=await value(await search({snapshot,cluster:group.id,limit:37,...(cursor?{cursor}:{})}))
   assert.equal(result.cluster.count,group.count);assert.equal(result.state,'complete')
   for(const row of result.records){
    const id=row.payload.record.attributes.find(attribute=>attribute.key==='producer.id').value.stringValue,emitted=expected.get(id)
    assert.ok(emitted,'returned member came from an independently enumerated producer')
    assert.equal(row.payload.record.body.stringValue,emitted.body);assert.equal(emitted.distinct,group===distinct)
    assert.ok(!originalIds.has(row.id),'member pages never duplicate an original record');originalIds.add(row.id);members.push(row)
   }
   count+=result.records.length;cursor=result.cursor
  }while(cursor)
  assert.equal(count,group.count)
 }
 assert.equal(members.length,expected.size)
 assert.deepEqual(new Set(members.map(row=>row.payload.record.attributes.find(attribute=>attribute.key==='producer.id').value.stringValue)),new Set(expected.keys()))
 // Reconcile every pivot, including exact singleton contents, in native query
 // pages. A limited concurrency keeps the real audit writer below saturation.
 for(let offset=0;offset<members.length;offset+=2)await Promise.all(members.slice(offset,offset+2).map(async row=>{
  const selection=Object.fromEntries(new URL(row.pivot,origin).searchParams)
  const original=await value(await post('/api/porthole/v1/query',selection))
  assert.equal(original.records.length,1);assert.equal(original.records[0].id,row.id);assert.deepEqual(original.records[0].payload,row.payload);assert.equal(original.snapshot,snapshot)
 }))
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Pattern reader',class:'read',scope}),201)
 const quotaReader=await value(await post('/app/settings/credentials/mint',{name:'Bounded pattern reader',class:'read',scope,scannedBytesPerDay:1}),201)
 const limited=await search({},{authorization:'Bearer '+quotaReader.secret});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.deepEqual(await limited.json(),{error:'credential_quota_exceeded'})
 const auth={authorization:'Bearer '+reader.secret}
 assert.equal((await value(await search({},auth))).totalRecords,236)
 await value(await search({service:'synthetic-porthole-11099'},auth),403)
 const foreign=await value(await post('/app/settings/credentials/mint',{name:'Foreign pattern reader',class:'read',scope:{...scope,teams:['synthetic-porthole-11099']}}),201)
 const hidden=await value(await search({team:'synthetic-porthole-11099'},{authorization:'Bearer '+foreign.secret}));assert.equal(hidden.totalRecords,0);assert.equal(hidden.totalClusters,0)
 await post('/app/settings/credentials/revoke',{id:reader.credential.id})
 assert.equal((await search({snapshot,cursor:first.cursor},{cookie,authorization:'Bearer '+reader.secret})).status,401,'revoked bearer cannot borrow owner cookie')
 const empty=await value(await search({from:String(at+1000000001n),through:String(at+1000000002n)}));assert.equal(empty.totalRecords,0);assert.equal(empty.totalClusters,0)
 await value(await search({snapshot,cursor:first.cursor,from:String(at+1n)}),400)
 const savedPage=await value(await search({snapshot,cluster:repeated.id,limit:37}))
 if(restartWorker){await restartWorker();const resumed=await value(await search({snapshot,cluster:repeated.id,limit:37,cursor:savedPage.cursor}));assert.equal(resumed.records.length,37);assert.equal(resumed.totalRecords,236)}
 if(screens){
  const path='/app/explore/clusters?'+new URLSearchParams({...query,snapshot:String(snapshot),limit:'50'})
  await clusterBrowser({origin,cookie,call,path:'/app/explore/clusters',name:'patterns-form',contains:'Group retained log messages',exercise:async page=>{await page.getByRole('textbox',{name:'Service',exact:true}).fill(clusterScope.service);await page.getByRole('textbox',{name:'Environment',exact:true}).fill(clusterScope.environment);await page.getByRole('textbox',{name:'Team',exact:true}).fill(clusterScope.team);await page.getByRole('button',{name:'Find patterns'}).focus();await Promise.all([page.waitForNavigation(),page.keyboard.press('Enter')]);assert.ok((await page.locator('body').innerText()).includes('236 retained records'))}})
  await clusterBrowser({origin,cookie,call,path,name:'patterns-complete',contains:['236 retained records in 2 patterns','225 original records','11 original records']})
  await clusterBrowser({origin,cookie,call,path:path+'&cluster='+repeated.id,name:'patterns-members',contains:['225 original records','Open original record']})
  await clusterBrowser({origin,cookie,call,path:members[0].pivot,name:'patterns-original',contains:JSON.stringify(members[0].payload.record.body.stringValue).slice(1,-1)})
  await clusterBrowser({origin,cookie,call,path:path+'&scanLimit=200',name:'patterns-partial',contains:'Partial scan'})
  await clusterBrowser({origin,cookie,call,path:'/app/explore/clusters?'+new URLSearchParams({...query,from:String(at+1000000001n),through:String(at+1000000002n)}),name:'patterns-empty',contains:'0 retained records in 0 patterns'})
  await clusterBrowser({origin,cookie,call,path:'/app/explore/clusters?limit=0',name:'patterns-invalid',status:400,contains:'invalid cluster limit'})
  await clusterBrowser({origin,call,path,name:'patterns-unauthorized',status:401,contains:'unauthenticated'})
 }
 if(archive)await archive({query:{...query,snapshot},all,members,first,source,wire,subject,search})
 const replay=await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:wire[0]})
 assert.equal(replay.status,200);assert.equal(replay.headers.get('x-porthole-duplicate'),'true')
 // A new explicit producer envelope completes between requests, in the same
 // search window. Its bytes were emitted by the stock exporter above.
 const later=await call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-11999'},body:wire[0]})
 assert.equal(later.status,200)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const laterCount=JSON.parse(wire[0]).resourceLogs.reduce((n,resource)=>n+resource.scopeLogs.reduce((m,scope)=>m+scope.logRecords.length,0),0)
 const frozen=await value(await search({snapshot,cursor:first.cursor}));assert.equal(frozen.totalRecords,236);assert.deepEqual(frozen.clusters,second.clusters)
 const current=await value(await search());assert.ok(current.snapshot>snapshot);assert.equal(current.totalRecords,236+laterCount,'later completions do not enter the original watermark')
 console.log('PROBE PORT-011 clustering: stock OTel logger -> actual intake -> '+backend+' pattern API: 236 source identities, counts 225 and 11, all original pivots reconciled, complete and partial states, scoped and revoked refusals')
 return {query:{...query,snapshot},all,members,first,source,wire,subject,search,post,value,retainedTotal:236+laterCount}
}

export async function logClusterNativeJourney(context){
 const {origin,freshOwner,restartWorker,sql,withEmptyDestination}=context,cookie=await freshOwner()
 const result=await logClusterJourney({origin,cookie,restartWorker,archive:async proof=>{
  const {clusterArchiveJourney}=await import('./archive.mjs')
  await clusterArchiveJourney({origin,freshOwner,withEmptyDestination,...proof})
 }})
 const {query,first,search,post,value,subject,source,wire,members,retainedTotal}=result
 await restartWorker(()=>sql('ALTER TABLE porthole_telemetry_records RENAME TO porthole_cluster_unavailable'))
 try{
  await value(await search(),503)
  await clusterBrowser({origin,cookie,path:'/app/explore/clusters?'+new URLSearchParams(query),name:'patterns-unavailable',status:503,contains:'unavailable'})
 }finally{await restartWorker(()=>sql('ALTER TABLE porthole_cluster_unavailable RENAME TO porthole_telemetry_records'))}
 // This ordinary owner erasure door remains exact-envelope only. The new
 // pattern feature neither widens it nor invents analytical deletion authority.
 const acting=await freshOwner(),headers={cookie:acting},erasure='/api/porthole/v1/subject-erasure'
 const preview=await value(await post(erasure,{identifier:subject},headers))
 assert.equal(preview.records,retainedTotal);assert.equal(preview.canApply,true)
 const erased=await value(await post(erasure+'/apply',{identifier:subject,digest:preview.digest,confirm:'erase-exact-batches'},headers));assert.equal(erased.erasedRecords,retainedTotal)
 const now=await value(await search({snapshot:query.snapshot}));assert.equal(now.totalRecords,0);assert.equal(now.totalClusters,0)
 await value(await search({snapshot:query.snapshot,cursor:first.cursor}),400)
 await value(await search({snapshot:query.snapshot,cluster:first.clusters[0].id}),404)
 const original=await value(await post('/api/porthole/v1/query',Object.fromEntries(new URL(members[0].pivot,origin).searchParams)))
 assert.equal(original.records.length,0,'an old original-record pivot cannot resurrect erased contents')
 await clusterBrowser({origin,cookie,path:'/app/explore/clusters?'+new URLSearchParams({...query,cursor:first.cursor}),name:'patterns-stale',status:400,contains:'invalid cluster cursor'})
 await restartWorker()
 for(const body of wire){const retry=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body});assert.equal(retry.status,409,'stock exporter replay cannot recreate erased records')}
 assert.equal((await value(await search())).totalRecords,0)
 console.log('PROBE PORT-011 custody: original owner erasure -> counts 0, stale pages refuse, old pivots empty and stock wire replay refuses across restart; unavailable retained storage -> 503')
}

export async function logClusterAnalyticalProof({context,estate,cookie}){
 const {origin,call,restart,getDb}=context
 const result=await logClusterJourney({origin,cookie,call,restartWorker:restart,screens:false,backend:'analytical primary'})
 const {query,all,members,search,post,value}=result
 const connect=async role=>{const config=await value(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}}));await value(await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role,enabled:true,confirm:'connect-analytical-workers'}))}
 await connect('standby')
 const standby=await value(await search({snapshot:query.snapshot,limit:200}))
 assert.deepEqual(standby.clusters,all.slice().sort((a,b)=>a.id.localeCompare(b.id)))
 const standbyMembers=[]
 for(const cluster of all){let cursor;do{const page=await value(await search({snapshot:query.snapshot,cluster:cluster.id,limit:100,...(cursor?{cursor}:{})}));standbyMembers.push(...page.records);cursor=page.cursor}while(cursor)}
 assert.deepEqual(standbyMembers.map(row=>row.id).sort(),members.map(row=>row.id).sort())
 for(let offset=0;offset<standbyMembers.length;offset+=2)await Promise.all(standbyMembers.slice(offset,offset+2).map(async row=>{const page=await value(await post('/api/porthole/v1/query',Object.fromEntries(new URL(row.pivot,origin).searchParams)));assert.deepEqual(page.records.map(item=>[item.id,item.payload]),[[row.id,row.payload]])}))
 const scope={services:[clusterScope.service],environments:[clusterScope.environment],teams:[clusterScope.team],signals:['logs'],actions:['telemetry.read']}
 const reader=await value(await post('/app/settings/credentials/mint',{name:'Mid-scan pattern reader',class:'read',scope}),201)
 // Intercept only after a real analytical page has returned. The authority
 // mutation uses the public revoke door; no query response is fabricated.
 const revokeAfterLast=async response=>{assert.equal(response.status,200);const page=await response.json();if(page.cursor)estate.afterQuery(revokeAfterLast);else await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))}
 estate.afterQuery(revokeAfterLast)
 const revoked=await search({snapshot:query.snapshot},{authorization:'Bearer '+reader.secret})
 assert.equal(revoked.status,401);assert.ok(!JSON.stringify(await revoked.json()).includes('Checkout accepted'),'accumulated first-page bodies are never released after revocation')
 // Physical custody loss is a fault injection, not a newly authorized
 // analytical-erasure operation. The endpoint must consult retained custody
 // after accumulating an actual last page, before returning even its counts.
 const row=members[0],stored=await getDb().prepare('SELECT * FROM porthole_telemetry_records WHERE id=?').bind(row.id).first()
 const removeAfterLast=async response=>{const page=await response.json();if(page.cursor)estate.afterQuery(removeAfterLast);else await getDb().prepare('DELETE FROM porthole_telemetry_records WHERE id=?').bind(row.id).run()}
 estate.afterQuery(removeAfterLast)
 const changed=await search({snapshot:query.snapshot})
 assert.equal(changed.status,409);assert.deepEqual(await changed.json(),{error:'cluster_custody_changed'})
 const columns=Object.keys(stored)
 await getDb().prepare('INSERT INTO porthole_telemetry_records('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...columns.map(key=>stored[key])).run()
 await estate.stop('standby')
 try{
  const outage=await value(await search({snapshot:query.snapshot}),503)
  assert.ok(['analytics_unreachable','analytics_unavailable','analytics_invalid_response'].includes(outage.error),JSON.stringify(outage))
  await clusterBrowser({origin,cookie,call,path:'/app/explore/clusters?'+new URLSearchParams(query),name:'patterns-analytical-unavailable',status:503,contains:outage.error.replaceAll('_',' ')})
 }finally{await estate.start('standby')}
 assert.equal((await value(await search({snapshot:query.snapshot}))).totalRecords,236)
 await connect('primary')
 console.log('PROBE PORT-011 analytical: primary and standby -> all 236 memberships and singleton pivots agree; real mid-read revoke -> 401; retained custody loss -> 409 with no accumulated results; stopped selected store -> 503')
}

export async function logClusterAnalyticalJourney(){
 const {analyticalEstate}=await import('./analytics.mjs'),{recipientMailJourney}=await import('./health.mjs'),estate=await analyticalEstate()
 try{await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
  const config=await (await context.call('/api/porthole/v1/analytics/configuration',{headers:{cookie:context.cookie}})).json()
  await context.post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
  await logClusterAnalyticalProof({context,estate,cookie:context.cookie})
 }})}finally{await estate.dispose()}
}
