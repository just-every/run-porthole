import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
export async function splunkLogSearchJourney({origin,cookie,member,foreignCookie,upload,finish,snapshot,restartWorker,freshOwner,capture}){
 const route='/api/porthole/v1/migration/log-search'
 const post=(path,data,session=cookie,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json',...extra},body:JSON.stringify(data)})
 const mapping={index:'application',service:'synthetic-porthole-4380',environment:'synthetic-porthole-4381',team:'synthetic-porthole-4382'}
 const start=BigInt(Math.floor((Date.now()-5000)/1000))*1000000000n,from=String(start),through=String(start+999999999n)
 const definition={id:'synthetic-porthole-4388',name:'Linked application log count',query:'index=application | stats count by service',tags:['synthetic-porthole-4389'],sourceReference:'https://source.example.invalid/search'}
 const bounded={id:'synthetic-porthole-4390',query:`search index="application" service="${mapping.service.toUpperCase()}" AND environment=${mapping.environment} team=${mapping.team} earliest=${start/1000000000n} latest=${start/1000000000n+1n} | stats count by service`}
 const unsupported={id:'synthetic-porthole-4391',query:'index=application | eval service=lower(service) | stats count by service'}
 const relative={id:'synthetic-porthole-4392',query:'index=application earliest=-5m latest=now | stats count by service'}
 const source={logSearches:[definition,bounded,unsupported,relative]},before=await snapshot(),plan=await upload('splunk',source)
 await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},'splunk','completed')
 const imported=await snapshot(),target=id=>imported.find(row=>row.targetId==='splunk:logSearches:'+id)
 const record=target(definition.id),input={targetId:record.targetId,targetRevision:record.revision,mapping,from,through}
 for(const [session,status]of [['',401],[member,403],[foreignCookie,401]])assert.equal((await post(route,input,session)).status,status)
 assert.equal((await post(route,input,cookie,{origin:'https://foreign.invalid'})).status,403)
 assert.equal((await post(route,{...input,targetRevision:'synthetic-porthole-4393'})).status,409)
 assert.equal((await post(route,{...input,mapping:undefined})).status,422)
 assert.equal((await post(route,{...input,mapping:{...mapping,index:'synthetic-porthole-4394'}})).status,422)
 assert.equal((await post(route,{...input,mapping:{...mapping,team:'*'}})).status,422)
 for(const injected of [{records:[]},{expectedCount:202},{expression:'index=application | stats count'}])assert.equal((await post(route,{...input,...injected})).status,400)
 const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-4395',class:'ingest',scope:{services:[mapping.service],environments:[mapping.environment],teams:[mapping.team],signals:['traces','logs'],actions:['telemetry.write']}})
 assert.equal(minted.status,201,await minted.clone().text());const credential=await minted.json()
 const emitted=await promisify(execFile)(process.execPath,['tests/porthole/spl/logs.cjs'],{env:{...process.env,PORTHOLE_OTLP_ENDPOINT:origin,PORTHOLE_OTLP_SECRET:credential.secret,PORTHOLE_SPL_START_NS:from},timeout:30000})
 const actual=JSON.parse(emitted.stdout.trim());assert.match(actual.traceId,/^[a-f0-9]{32}$/)
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const response=await post(route,input);assert.equal(response.status,200,await response.clone().text())
 const result=await response.json()
 assert.deepEqual(result.rows,[{service:mapping.service,count:202}]);assert.equal(result.selectedRecords,202);assert.ok(result.queryRefs.length>1)
 assert.equal(result.sourceRevision,record.revision);assert.deepEqual(result.sourceDefinition,definition);assert.equal(result.sourceText,definition.query)
 assert.equal(result.mappingReview.targetRevision,record.revision);assert.equal(result.sourceComparison.state,'unqualified');assert.equal(result.cutover,'blocked');assert.equal(result.notifications,'inactive')
 assert.match(response.headers.get('cache-control'),/no-store/)
 // Independently page the real native public read at the returned watermark.
 const native=[],params=new URLSearchParams({signal:'logs',service:mapping.service,environment:mapping.environment,team:mapping.team,from,through,snapshot:String(result.snapshot),limit:'200'})
 for(let page=0;page<3;page++){
  const read=await fetch(origin+'/api/porthole/v1/ingest/records?'+params,{headers:{cookie}});assert.equal(read.status,200)
  const value=await read.json();native.push(...value.records)
  if(!value.cursor)break
  params.set('cursor',value.cursor)
 }
 assert.equal(native.length,result.selectedRecords);assert.ok(native.every(row=>row.trace_id===actual.traceId));assert.ok(native.some(row=>BigInt(row.event_time_ns)===start))
 const timed=target(bounded.id),timedInput={...input,targetId:timed.targetId,targetRevision:timed.revision}
 const boundedResponse=await post(route,timedInput);assert.equal(boundedResponse.status,200,await boundedResponse.clone().text());assert.deepEqual((await boundedResponse.json()).rows,result.rows)
 assert.equal((await post(route,{...timedInput,through:String(start+1000000000n)})).status,422)
 const latestOnly=await post(route,{...input,from:String(start+1000000000n),through:String(start+1000000000n)});assert.equal(latestOnly.status,200);assert.deepEqual((await latestOnly.json()).rows,[{service:mapping.service,count:1}])
 const empty=await post(route,{...input,from:String(start-1000000000n),through:String(start-1n)});assert.equal(empty.status,200);const emptyResult=await empty.json();assert.deepEqual(emptyResult.rows,[]);assert.equal(emptyResult.coverage,'no-native-data')
 for(const id of [unsupported.id,relative.id]){
  const selected=target(id),refused=await post(route,{...input,targetId:selected.targetId,targetRevision:selected.revision});assert.equal(refused.status,422)
  const reason=await refused.json();assert.equal(reason.error,'unqualified_spl');assert.ok(reason.construct);assert.ok(Number.isInteger(reason.offset))
 }
 if(capture){
  const formResult=async(page,selection,range,expected)=>{
   await page.getByText('Map a linked log search',{exact:true}).click()
   const form=page.locator('form[action="/app/import/log-search"]')
   await form.locator('[name="targetRef"]').selectOption(JSON.stringify([selection.targetId,selection.revision]))
   for(const [key,value]of Object.entries({...mapping,...range}))await form.locator(`[name="${key}"]`).fill(value)
   await form.locator('input[type="checkbox"]').check()
   if(expected==='form')return
   await form.locator('button').click();await page.getByRole('heading',{name:expected==='202'?'Mapped native log count':expected==='empty'?'Mapped native log count':'Log search unavailable',exact:true}).waitFor()
   if(expected==='202')assert.ok(await page.getByRole('cell',{name:'202',exact:true}).count())
   else if(expected==='empty')assert.match(await page.locator('body').innerText(),/No native observations/)
   else assert.ok(await page.getByRole('alert').count())
  }
  await capture('move-in-native-log-search-form','/app/import',page=>formResult(page,record,{from,through},'form'))
  await capture('move-in-native-log-search','/app/import',page=>formResult(page,record,{from,through},'202'))
  await capture('move-in-native-log-search-empty','/app/import',page=>formResult(page,record,{from:String(start-1000000000n),through:String(start-1n)},'empty'))
  await capture('move-in-native-log-search-refused','/app/import',page=>formResult(page,target(unsupported.id),{from,through},'unsupported'))
 }
 await restartWorker();cookie=await freshOwner()
 const repeated=await post(route,input);assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).rows,result.rows)
 await finish('undo',{planId:plan.planId},'splunk','undone');assert.deepEqual(await snapshot(),before)
 assert.equal((await post(route,input)).status,404)
 assert.equal((await post('/app/settings/credentials/revoke',{id:credential.credential.id})).status,200)
 console.log('Splunk linked log search: reviewed native scope mapping, stock SDK logs, complete snapshot paging, exact native counts, explicit source time boundaries, source context retention and strict refusals passed; source parity remains unqualified')
}
