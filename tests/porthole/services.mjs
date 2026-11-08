import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal,fixture} from './fixture.mjs'
import {serviceCatalogEstate} from './polyglot/estate.mjs'
const api='/api/porthole/v1/services',address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
const scope={services:['checkout','fulfillment'],environments:['production','staging'],teams:['commerce','fulfillment']}
export async function servicesJourney({origin,freshOwner,signIn,sql,restartWorker,withPinnedClock,withEmptyDestination,call=(path,options)=>fetch(origin+path,options),analytical=false,browserDispatch}) {
 let cookie=await freshOwner()
 const send=async(path,data,status=200,acting=cookie)=>{const response=await call(path,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.headers.get('content-type')?.includes('json')?response.json():response}
 const read=async(path=api,acting=cookie)=>{const response=await call(path,{headers:{cookie:acting}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const metaStorage=()=>sql('SELECT * FROM porthole_service_versions ORDER BY id,revision')
 const grants=()=>sql('SELECT operator_id,role,scope,revision FROM porthole_members ORDER BY operator_id')
 const denied=async(path,data,status=403,acting=cookie,headers={})=>{const before=await metaStorage(),response=await call(path,{...form(origin,acting,data),headers:{...form(origin,acting,data).headers,...headers}});assert.equal(response.status,status,await response.clone().text());assert.deepEqual(await metaStorage(),before,'forbidden or stale writes leave metadata unchanged')}
 assert.equal((await call(api)).status,401)
 assert.equal((await read()).services.length,0)
 await servicesBrowser({origin,cookie,path:'/app/services',contains:'No services with retained evidence',name:'services-empty',dispatch:browserDispatch})
 const source=await send('/app/settings/credentials/mint',{name:'synthetic-porthole-8206',class:'ingest',scope:{...scope,signals:['traces','logs'],actions:['telemetry.write']}},201)
 const proof=await serviceCatalogEstate({origin,secret:source.secret,dispatch:call})
 assert.equal(proof.statuses.filter(s=>s===503).length,8,'independently counted application errors')
 assert.equal(proof.statuses.filter(s=>s===200).length,28)
 assert.equal(proof.receipts.find(r=>r.received.length).received.length,36,'all actual queue messages arrived once')
 let pending=1
 for(let pass=0;pass<20&&pending;pass++)pending=(await send('/api/porthole/v1/ingest/drain',{})).pendingBatches
 assert.equal(pending,0)
 console.log('Services: stock export drained; checking source counters and catalog')
 const start=proof.spans.reduce((a,s)=>BigInt(s.startNs)<a?BigInt(s.startNs):a,BigInt(proof.spans[0].startNs)),end=proof.spans.reduce((a,s)=>BigInt(s.startNs)+BigInt(s.durationNs)>a?BigInt(s.startNs)+BigInt(s.durationNs):a,0n)
 const query='?'+new URLSearchParams({from:String(start-1n),through:String(end+1n)}),view=await read(api+query)
 assert.equal(view.coverage.scanComplete,true);assert.equal(view.coverage.fullTraffic,false)
 assert.equal(view.services.length,2);assert.ok(view.services.every(s=>s.versions.includes('synthetic-porthole-8205')))
 assert.ok(view.services.every(s=>s.freshness==='recent'))
 const expectedRequests=proof.spans.filter(s=>s.kind===2||s.kind===5)
 for(const service of view.services){
  const captured=expectedRequests.filter(s=>s.resource['service.name']===service.service),app=proof.receipts.find(r=>r.spans.some(s=>s.resource['service.name']===service.service))
  assert.equal(service.summary.requests,Object.values(app.counts).reduce((a,b)=>a+b,0)+app.received.length,'source counters include server requests and consumers only')
  assert.equal(service.summary.requests,captured.length)
  assert.equal(service.summary.errors,service.service==='checkout'?8:8)
  const durations=captured.map(s=>BigInt(s.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0)
  for(const [key,p]of [['p50Ns',.5],['p95Ns',.95],['p99Ns',.99]])assert.equal(service.summary[key],durations[Math.ceil(durations.length*p)-1].toString(),'exact quantile from independently captured stock spans')
  assert.equal(service.summary.requestsPerSecond,captured.length/(Number(end-start+3n)/1e9))
  for(const endpoint of service.endpoints){
   const spans=captured.filter(s=>(s.attributes['http.route']??s.name)===endpoint.endpoint)
   assert.equal(endpoint.requests,spans.length,'source endpoint membership: '+endpoint.endpoint)
   assert.equal(endpoint.errors,spans.filter(s=>s.status.code===2||Number(s.attributes['http.response.status_code']??s.attributes['http.status_code'])>=500).length)
   const latency=spans.map(span=>BigInt(span.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0)
   for(const [key,p]of [['p50Ns',.5],['p95Ns',.95],['p99Ns',.99]])assert.equal(endpoint[key],latency[Math.ceil(latency.length*p)-1].toString(),'per-endpoint latency reconciles with the original stock spans')
   assert.equal(endpoint.requestsPerSecond,spans.length/(Number(end-start+3n)/1e9))
  }
 }
 const checkout=view.services.find(s=>s.service==='checkout'),fulfillment=view.services.find(s=>s.service==='fulfillment')
 const database=checkout.associations.filter(a=>a.kind==='database')
 assert.equal(proof.receipts.reduce((n,r)=>n+r.databaseQueries,0),36,'application independently counts every successful database query')
 assert.equal(database.length,1);assert.equal(database[0].system,'postgresql');assert.equal(database[0].target,'synthetic_porthole_8400');assert.equal(database[0].address,'127.0.0.1');assert.equal(database[0].port,proof.databasePort)
 const databaseSpans=proof.spans.filter(s=>s.kind===3&&(s.attributes['db.system.name']??s.attributes['db.system'])==='postgresql')
 assert.equal(database[0].observations,databaseSpans.length,'database association includes every stock client span, including the initial connection')
 assert.equal(databaseSpans.filter(s=>s.name!=='pg.connect').length,36,'stock query operations reconcile with the independent application counter')
 assert.equal(fulfillment.associations.filter(a=>a.kind==='database').length,0,'database association does not cross service scope')
 for(const service of [checkout,fulfillment]){
  const spans=proof.spans.filter(s=>s.resource['service.name']===service.service),hosts=[...new Set(spans.map(s=>s.resource['host.id']??s.resource['host.name']).filter(Boolean))]
  assert.ok(hosts.length,'stock resource detection reports the actual host')
  assert.deepEqual(service.associations.filter(a=>a.kind==='infrastructure'&&a.system==='host').map(a=>a.target).sort(),hosts.sort())
  const messaging=service.associations.filter(a=>a.kind==='messaging')
  assert.equal(messaging.reduce((n,a)=>n+a.observations,0),36,'each actual queue send or receive contributes exactly one observed association')
  assert.ok(messaging.every(a=>a.system==='kafka'&&a.target===proof.topic&&a.relation===(service===checkout?'produces':'consumes')))
  for(const association of service.associations)assert.ok(spans.some(s=>BigInt(s.startNs)+BigInt(s.durationNs)===BigInt(association.lastSeenNs)),'association freshness comes from the original stock export')
 }
 const discoverySpans=[...proof.spans,...proof.discovery.spans],discoveryEnd=discoverySpans.reduce((end,span)=>{const time=BigInt(span.startNs)+BigInt(span.durationNs);return time>end?time:end},end)
 const discoveryQuery='?'+new URLSearchParams({from:String(start-1n),through:String(discoveryEnd+1n)})
 const discovered=await read(api+discoveryQuery)
 assert.equal(discovered.coverage.scanComplete,true);assert.equal(discovered.services.length,3)
 const production=discovered.services.find(service=>service.service==='checkout'&&service.environment==='production'),staging=discovered.services.find(service=>service.service==='checkout'&&service.environment==='staging')
 assert.notEqual(staging.id,production.id,'environment is part of the native catalog identity')
 assert.deepEqual(production.versions,['synthetic-porthole-8205','synthetic-porthole-8210']);assert.deepEqual(staging.versions,['synthetic-porthole-8211'])
 for(const receipt of proof.discovery.receipts){
  assert.equal(Object.values(receipt.counts).reduce((total,count)=>total+count,0),receipt.outcomes.length,'independent replacement-runtime request counters')
  const service=receipt.environment==='production'?production:staging,spans=discoverySpans.filter(span=>span.kind===2&&span.resource['service.name']==='checkout'&&span.resource['deployment.environment.name']===receipt.environment)
  const original=receipt.environment==='production'?proof.statuses:[]
  assert.equal(service.summary.requests,original.length+receipt.outcomes.length)
  assert.equal(service.summary.errors,[...original,...receipt.outcomes].filter(code=>code===503).length)
  const durations=spans.map(span=>BigInt(span.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0)
  for(const [key,p]of [['p50Ns',.5],['p95Ns',.95],['p99Ns',.99]])assert.equal(service.summary[key],durations[Math.ceil(durations.length*p)-1].toString(),'rollout percentiles use all retained versions only in this environment')
 }
 assert.deepEqual(staging.associations.filter(row=>row.kind!=='infrastructure'),[],'staging runtime does not inherit production database or queue associations')
 assert.ok(discovered.edges.filter(edge=>edge.from===staging.id||edge.to===staging.id).length===0,'matching names alone cannot create a cross-environment dependency')
 const {serviceTopologyProof}=await import('./traces.mjs')
 await serviceTopologyProof({read,proof,view,checkout,fulfillment})
 await servicesBrowser({origin,cookie,path:'/app/services/'+checkout.id+query,contains:'Observed requests',name:'services-summary',dispatch:browserDispatch,observed:checkout.summary})
 for(const [index,packet]of proof.packets.filter(packet=>packet.path!=='/v1/logs').entries()){
  const replay=await call(packet.path??'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':packet.type,'x-porthole-batch-id':'synthetic-porthole-replay-'+index},body:packet.body})
  assert.equal(replay.status,200,await replay.clone().text())
 }
 await send('/api/porthole/v1/ingest/drain',{})
 const replayed=await read(api+query)
 assert.deepEqual(replayed.services.map(s=>s.summary),view.services.map(s=>s.summary),'replaying the original stock export never adds requests')
 assert.deepEqual(replayed.services.map(s=>s.associations),view.services.map(s=>s.associations),'replay cannot add association evidence')
 assert.deepEqual(replayed.edges,view.edges)
 const partial=await read(api+query+'&budget=200');assert.equal(partial.coverage.scanComplete,false,'multi-page bounded scans stay partial')
 await servicesBrowser({origin,cookie,path:'/app/services'+query+'&budget=200',contains:'Partial scan',name:'services-partial',dispatch:browserDispatch})
 await send('/app/settings/members/invite',{email:address(8207),displayName:'Eligible service owner',role:'responder',scope:{services:['checkout'],environments:['production'],teams:['commerce']}},202)
 let eligibleCookie=await signIn(address(8207)),eligible=(await read('/auth/session',eligibleCookie)).operator
 const eligibleView=await read(api+query,eligibleCookie)
 assert.deepEqual(eligibleView.services.map(service=>service.service),['checkout'],'the eligible responder remains restricted to the existing checkout scope')
 const scopedDiscovery=await read(api+discoveryQuery,eligibleCookie)
 assert.deepEqual(scopedDiscovery.services.map(service=>service.id),[production.id],'a production responder cannot discover staging versions or counts')
 assert.equal((await call(api+'/'+staging.id+discoveryQuery,{headers:{cookie:eligibleCookie}})).status,404,'the foreign environment identity has no native read door')
 assert.ok(eligibleView.edges.some(edge=>edge.kind==='unresolved-target'&&edge.to===null),'an outbound call without an authorized receiver remains explicitly unresolved')
 cookie=await freshOwner()
 const owner=(await read('/auth/session')).operator,baselineGrants=await grants(),values={revision:0,ownerRef:owner.id,repository:'https://example.invalid/checkout.git',runbook:'https://restricted.example/runbooks/checkout?view=synthetic-porthole-8209#recovery',criticality:'high',confirm:'save-service-metadata'}
 await send(api+'/'+checkout.id,values,201)
 assert.deepEqual(await grants(),baselineGrants,'attribution grants no membership or scope')
 await denied(api+'/'+checkout.id,values,409)
 await denied(api+'/'+checkout.id,{...values,revision:1},403,eligibleCookie)
 await denied(api+'/'+checkout.id,{...values,revision:1},403,cookie,{origin:'https://foreign.example'})
 await denied(api+'/'+checkout.id,{...values,revision:1},403,cookie,{authorization:'Bearer '+source.secret})
 await denied(api+'/'+checkout.id,{...values,revision:1,runbook:'javascript:alert(1)'},400)
 await send('/app/settings/members/invite',{email:address(8208),displayName:'Restricted responder',role:'restricted contractor',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}},202)
 const restricted=await signIn(address(8208)),restrictedId=(await read('/auth/session',restricted)).operator.id
 cookie=await freshOwner()
 await denied(api+'/'+checkout.id,{...values,revision:1,ownerRef:restrictedId})
 const hidden=await read(api+query,restricted)
 assert.deepEqual(hidden.services.map(s=>s.service),['fulfillment']);assert.ok(hidden.edges.some(e=>e.to===null));assert.ok(!JSON.stringify(hidden).includes('checkout'))
 assert.equal((await call(api+'/'+checkout.id+query,{headers:{cookie:restricted}})).status,404)
 const grantsBeforeReassignment=await grants()
 await send(api+'/'+checkout.id,{...values,revision:1,ownerRef:eligible.id},201)
 assert.deepEqual(await grants(),grantsBeforeReassignment,'reassignment grants no new dataset or membership scope')
 const assigned=await read(api+'/'+checkout.id+query,eligibleCookie)
 assert.equal(assigned.metadata.owner_ref,eligible.id);assert.deepEqual(assigned.history.map(r=>r.revision),[2,1])
 assert.equal(assigned.history[1].owner_ref,owner.id)
 assert.equal((await grants()).find(m=>m.operator_id===eligible.id).role,'responder')
 // Use the existing count-monitor door; no new detection or delivery is enabled.
 const alertScope={services:['checkout'],environments:['production'],teams:['commerce']}
 const alert=await send('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-8401',scope:alertScope,body:{signal:'traces',operator:'above',threshold:0,windowSeconds:3600}},201)
 await send('/api/porthole/v1/objects/activate',{id:alert.id,revision:alert.revision,confirm:'activate'})
 const broad=await send('/api/porthole/v1/objects',{kind:'monitor',name:'synthetic-porthole-8403',scope,body:{signal:'traces',operator:'above',threshold:0,windowSeconds:3600}},201)
 await send('/api/porthole/v1/objects/activate',{id:broad.id,revision:broad.revision,confirm:'activate'})
 const heartbeat=await call('/api/v1/health/heartbeat',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({collectorId:'synthetic-porthole-8402',service:'checkout',environment:'production',team:'commerce',signal:'traces'})})
 assert.equal(heartbeat.status,200,await heartbeat.clone().text())
 const tick=await send('/api/v1/health/tick',{})
 const fired=tick.monitors.monitors.find(m=>m.monitorId===alert.id)
 assert.equal(fired.status,'Firing',JSON.stringify(fired));assert.ok(fired.firingEpisode)
 const ownerAlerts=(await read(api+'/'+checkout.id+query)).alerts
 assert.ok(ownerAlerts.some(a=>a.monitorId===broad.id),'owner can read the complete multi-service monitor context')
 const originalAlert=ownerAlerts.find(a=>a.monitorId===alert.id)
 assert.equal(originalAlert.firingEpisode,fired.firingEpisode);assert.equal(originalAlert.metadataAtFirstFiring.revision,2);assert.equal(originalAlert.currentMetadata.revision,2)
 assert.equal((await read(api+'/'+fulfillment.id+query,restricted)).alerts.length,0,'foreign service reader sees no checkout or multi-service alert identity')
 console.log('Services: scoped metadata refusal checks passed; checking native Settings')
 await servicesBrowser({origin,cookie,path:'/app/settings/services/'+checkout.id+query,contains:'Review service metadata',name:'services-settings',dispatch:browserDispatch,save:true})
 const changed=await read(api+'/'+checkout.id+query)
 assert.equal(changed.metadata.revision,3);assert.equal(changed.metadata.criticality,'critical');assert.equal(changed.metadata.runbook,'https://restricted.example/runbooks/reviewed')
 assert.deepEqual(await grants(),grantsBeforeReassignment,'firing context and metadata edits create no grants')
 const {handoffJourney}=await import('./handoffs.mjs')
 const handoffPacket=await handoffJourney({origin,freshOwner,signIn,sql,call,service:changed,query,ownerCookie:cookie,responders:[{cookie:eligibleCookie,serviceId:checkout.id},{cookie:restricted,serviceId:fulfillment.id}],bearer:source.secret,dispatch:browserDispatch,withPinnedClock})
 const alertContext=changed.alerts.find(a=>a.monitorId===alert.id)
 assert.equal(alertContext.metadataAtFirstFiring.revision,2);assert.equal(alertContext.metadataAtFirstFiring.runbook,values.runbook);assert.equal(alertContext.currentMetadata.revision,3);assert.equal(alertContext.currentMetadata.runbook,changed.metadata.runbook);assert.equal(alertContext.currentMetadata.criticality,'critical');assert.equal(alertContext.currentMetadata.owner_ref,eligible.id);assert.equal(alertContext.delivery,'not-requested')
 const responderAlerts=(await read(api+'/'+checkout.id+query,eligibleCookie)).alerts
 assert.deepEqual(responderAlerts,[alertContext],'responder sees exact checkout metadata but cannot learn a monitor covering another service')
 assert.equal((await sql("SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='services.revise' AND json_extract(entry,'$.phase')='committed'"))[0].n,3,'each immutable revision has an atomic audit fact')
 await restartWorker();cookie=await freshOwner()
 const reloaded=await read(api+'/'+checkout.id+query)
 assert.deepEqual(reloaded.metadata,changed.metadata);assert.deepEqual(reloaded.history,changed.history)
 assert.deepEqual(reloaded.alerts,changed.alerts);assert.deepEqual(reloaded.associations,checkout.associations)
 assert.equal((await read('/api/porthole/v1/handoffs')).handoffs.length,12,'handoff configuration survives restart')
 assert.equal((await call('/api/porthole/v1/service-evidence/'+handoffPacket.id+'/download',{headers:{cookie}})).status,200,'approved current packet survives restart')
 const discoveryFields=service=>Object.fromEntries(['id','service','environment','team','versions','summary','associations'].map(key=>[key,service[key]]))
 const discoveryProof={query:discoveryQuery,services:discovered.services.map(discoveryFields)}
 assert.deepEqual((await read(api+discoveryQuery)).services.map(discoveryFields),discoveryProof.services,'restart preserves both version history and isolated environment observations')
 // The replacement runtimes also emitted real traffic. Start the quiet window
 // after their final captured span, independently of their startup duration.
 const quietQuery='?'+new URLSearchParams({from:String(discoveryEnd+2n),through:String(discoveryEnd+1000000000n)})
 const quiet=await read(api+'/'+checkout.id+quietQuery)
 assert.equal(quiet.freshness,'no-retained-evidence');assert.equal(quiet.spanCount,0);assert.equal(quiet.summary.p95Ns,null);assert.deepEqual(quiet.associations,[])
 assert.equal(quiet.metadata.revision,3);assert.deepEqual(quiet.history,reloaded.history);assert.equal(quiet.coverage.fullTraffic,false,'an empty observation window cannot establish healthy full traffic')
 await servicesBrowser({origin,cookie,path:'/app/services/'+checkout.id+quietQuery,contains:'no-retained-evidence',name:'services-no-retained-evidence',dispatch:browserDispatch})
 if(withPinnedClock){const at=Number(end/1000000n)+300001;await withPinnedClock(at,async()=>{const stale=await read(api+query);assert.ok(stale.services.every(s=>s.freshness==='stale'));assert.equal(stale.services.find(s=>s.id===checkout.id).metadata.owner_ref,eligible.id);await servicesBrowser({origin,cookie,path:'/app/services'+query,contains:'Freshness: stale',name:'services-freshness-stale',dispatch:browserDispatch})})}
 await servicesBrowser({origin,cookie:eligibleCookie,path:'/app/services/'+checkout.id+query,contains:'critical',name:'services-responder',dispatch:browserDispatch,follow:true})
 await send('/app/settings/members/change',{operatorId:eligible.id,role:'responder',scope:{services:['fulfillment'],environments:['production'],teams:['fulfillment']}})
 assert.equal((await call(api,{headers:{cookie:eligibleCookie}})).status,401,'scope revocation invalidates the old native session on its next request')
 const associationTrace='/api/porthole/v1/traces/'+checkout.associations[0].evidence.traceId+'?snapshot='+view.snapshot
 assert.equal((await call(associationTrace,{headers:{cookie:eligibleCookie}})).status,401,'an old association pivot cannot preserve a revoked native session')
 await denied(api+'/'+checkout.id,{...values,revision:3},401,eligibleCookie)
 eligibleCookie=await signIn(address(8207))
 assert.ok(!(await read(api+query,eligibleCookie)).services.some(s=>s.id===checkout.id),'ownership does not preserve data access after scope revocation')
 assert.ok((await read(associationTrace,eligibleCookie)).spans.every(span=>span.service==='fulfillment'),'a historical association reference cannot confer the former service scope')
 await denied(api+'/'+checkout.id,{...values,revision:3},403,eligibleCookie)
 await send('/app/settings/members/remove',{operatorId:restrictedId})
 cookie=await freshOwner()
 await send('/app/settings/members/remove',{operatorId:eligible.id})
 await send('/api/porthole/v1/actors/erase',{actorRef:eligible.id,confirm:'erase'})
 const erased=await read(api+'/'+checkout.id+query)
 assert.equal(erased.names[eligible.id],'Unavailable member');assert.ok(!JSON.stringify(erased).includes('Eligible service owner'),'erased attribution has no retained identity label')
 await denied(api+'/'+checkout.id,{...values,revision:2},409)
 await denied(api+'/'+checkout.id,{...values,revision:3,ownerRef:eligible.id},403)
 assert.equal((await call(api,{headers:{cookie:restricted}})).status,401)
 await servicesBrowser({origin,path:'/app/services',contains:'unauthenticated',name:'services-unauthorized',status:401,dispatch:browserDispatch})
 assert.equal((await call(api+'?budget=3',{headers:{cookie}})).status,400)
 await servicesBrowser({origin,cookie,path:'/app/services?budget=3',contains:'invalid service budget',name:'services-invalid',status:400,dispatch:browserDispatch})
 let backup
 if(withEmptyDestination){const {servicesArchiveJourney}=await import('./archive.mjs');backup=await servicesArchiveJourney({origin,freshOwner,restartWorker,withEmptyDestination,id:checkout.id,query,expected:changed.metadata,summary:checkout.summary,associations:checkout.associations,discovery:discoveryProof,handoffPacket})}
 cookie=await freshOwner()
 const erasure='/api/porthole/v1/subject-erasure',preview=await send(erasure,{identifier:'checkout'})
 assert.equal(preview.canApply,true);assert.ok(preview.records>36,'actual stock checkout envelopes are present in the exact erasure preview')
 if(analytical){
  const before=await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records')
  await send(erasure+'/apply',{identifier:'checkout',digest:preview.digest,confirm:'erase-exact-batches'},409)
  assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'),before,'unqualified analytical erasure refuses unchanged')
 }else{
  const receipt=await send(erasure+'/apply',{identifier:'checkout',digest:preview.digest,confirm:'erase-exact-batches'})
  assert.equal(receipt.erasedRecords,preview.records)
  if(backup)assert.equal((await call('/api/porthole/v1/archive/exports/'+backup.id+'/chunks/'+backup.chunk,{headers:{cookie}})).status,404,'erasure withdraws cached and reconstructed archive packets together')
  const removed=await read(api+'/'+checkout.id+query)
  assert.equal(removed.spanCount,0);assert.equal((await call('/api/porthole/v1/service-evidence/'+handoffPacket.id+'/download',{headers:{cookie}})).status,409,'erased input cannot survive as a downloadable packet')
  assert.deepEqual(removed.associations,[]);assert.equal(removed.summary.p95Ns,null);assert.equal(removed.metadata.revision,3)
  assert.ok((await read(associationTrace)).spans.every(span=>span.service!=='checkout'),'an erased association pivot cannot restore its original input')
  assert.ok(removed.alerts.every(a=>a.status==='Unknown'),'erased input cannot leave firing context labeled as fresh measured evidence')
  const peer=(await read(api+'/'+fulfillment.id+query));assert.deepEqual(peer.summary,fulfillment.summary);assert.deepEqual(peer.associations,fulfillment.associations,'unrelated service evidence stays unchanged')
  let refused=0
  for(const packet of proof.packets){const response=await call(packet.path??'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':packet.type},body:packet.body});assert.ok([200,409].includes(response.status));if(response.status===409)refused++}
  assert.ok(refused>0,'original checkout wire replay is fenced by the real erasure journal')
  await restartWorker();cookie=await freshOwner()
  assert.deepEqual((await read(api+'/'+checkout.id+query)).associations,[],'restart and replay cannot resurrect derived associations')
  console.log('PROBE PORT-008 erasure: exact native-owner preview and approval of actual checkout envelopes -> derived associations disappear, original replay refuses, unrelated fulfillment stays exact; restart preserves missing evidence')
 }
 await send('/app/settings/credentials/revoke',{id:source.credential.id})
 const retainedBefore=await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records')
 assert.equal((await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':proof.packets[0].type},body:proof.packets[0].body})).status,401)
 assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'),retainedBefore,'a revoked source cannot replay more custody')
 console.log('PROBE PORT-008 discovery: stock two-team HTTP and Kafka estate plus replacement and staging runtimes -> three scope identities, two production versions, isolated staging version and source-counted summaries; production responder cannot read staging')
 console.log('PROBE PORT-008 association-pivots: native Services trace links and versioned trace API -> exact original span, service, environment, team and last-observed nanoseconds; current authority applies independently')
 console.log('PROBE PORT-008 summaries: 36 counted checkout requests, eight errors and eight slow requests -> exact observed counts, rates, endpoint values and p50, p95 and p99 from captured stock spans; client spans excluded')
 console.log('PROBE PORT-008 metadata: native reviewed owner reassignment, Settings edit, reload and restart -> three immutable audited revisions; stale, foreign, bearer and forbidden writes leave metadata unchanged')
 console.log('PROBE PORT-008 authority: restricted and revoked native readers -> hidden services absent and unresolved parent links; metadata grants no access; external runbook remains private')
 console.log('PROBE PORT-008 associations: 36 real PostgreSQL queries and 36 real Kafka sends and receives -> exact scoped database, messaging and detected host identities; replay adds no observations')
 console.log('PROBE PORT-008 fired-context: existing activated count monitor over actual checkout traces -> Firing episode with service revision 2; edit and restart -> original revision preserved and exact current revision 3 for owner and scoped responder, without grants or delivery')
 console.log('servicesJourney passed '+(analytical?'analytical':'local')+': source counters and stock spans, multi-page bounds, ownership and native browser states')
 return {view,query,checkoutId:checkout.id,packetId:handoffPacket.id}
}

export async function servicesBrowser({origin,cookie='',path,contains,name,status=200,dispatch,save=false,follow=false,observed}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  if(cookie)await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  if(dispatch)await context.route(origin+'/**',async route=>{const r=route.request(),response=await dispatch(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:r.postDataBuffer()}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
  const page=await context.newPage(),response=await page.goto(origin+path)
  assert.equal(response.status(),status);assert.ok((await page.locator('body').innerText()).includes(contains))
  if(observed){const body=await page.locator('body').innerText();assert.ok(body.includes(observed.requests+' requests · '+observed.errors+' errors'));for(const name of ['p50','p95','p99'])assert.ok(body.includes(name+' '+(Number(observed[name+'Ns'])/1e6).toFixed(2)+' ms'),'Services shows the independently reconciled '+name);const href=await page.getByRole('link',{name:'Read this snapshot as JSON',exact:true}).getAttribute('href');const linked=await page.goto(origin+href);assert.equal(linked.status(),200);const json=await linked.json();assert.equal(json.summary.requests,observed.requests);assert.equal(json.summary.errors,observed.errors);assert.equal(json.summary.p95Ns,observed.p95Ns);await page.goto(origin+path)}
  if(observed){assert.match(await page.locator('body').innerText(),/database.*postgresql.*synthetic_porthole_8400/);assert.match(await page.locator('body').innerText(),/messaging.*kafka/)}
  if(observed){
   const pivot=page.getByRole('link',{name:'Inspect association trace',exact:true}).first(),href=await pivot.getAttribute('href')
   assert.equal(new URL(href,origin).searchParams.get('snapshot'),new URL(await page.getByRole('link',{name:'Read this snapshot as JSON',exact:true}).getAttribute('href'),origin).searchParams.get('snapshot'))
   await pivot.click();assert.match(await page.locator('body').innerText(),/Trace waterfall/);assert.ok((await page.locator('body').innerText()).includes('checkout'))
   assert.equal(new URL(page.url()).hash,new URL(href,origin).hash,'association pivot focuses the original span')
   const target=page.locator(new URL(page.url()).hash)
   assert.equal(await target.count(),1);assert.ok(await target.evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.top<innerHeight&&bounds.bottom>0}),'the original association span is in view')
   if(process.env.PORTHOLE_EVIDENCE_DIR)for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?900:844});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'services-association-trace-'+width+'.png'),fullPage:true})}
   await page.setViewportSize({width:1440,height:900});await page.goto(origin+path)
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native Services reflows')
  assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).length),0,'every control has a text label')
  assert.ok(await page.locator('main').evaluate(node=>[...node.querySelectorAll('p,a,button,label,input,select,dt,dd,li')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)),'ordinary text is at least 13px')
  const link=page.getByRole('link',{name:'All services',exact:true});if(await link.count()){await link.focus();assert.ok(await link.evaluate(n=>n===document.activeElement))}
  if(save){
   const stale=await context.newPage();await stale.goto(origin+path)
   await page.getByLabel('Runbook URL').fill('https://restricted.example/runbooks/reviewed');await page.getByLabel('Criticality',{exact:true}).selectOption('critical');await page.getByLabel('I approve these exact values').check()
   await Promise.all([page.waitForURL(origin+'/app/settings/services/'+path.split('/').at(-1).split('?')[0]),page.getByRole('button',{name:'Save reviewed metadata'}).click()])
   assert.match(await page.locator('body').innerText(),/Revision\s+3/)
   await stale.getByLabel('I approve these exact values').check()
   const refusal=stale.waitForResponse(r=>r.request().method()==='POST')
   await stale.getByRole('button',{name:'Save reviewed metadata'}).click()
   assert.equal((await refusal).status(),409);assert.match(await stale.locator('body').innerText(),/service revision changed/)
   if(process.env.PORTHOLE_EVIDENCE_DIR)for(const width of [1440,390]){await stale.setViewportSize({width,height:width===1440?900:844});await stale.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,'services-stale-revision-'+width+'.png'),fullPage:true})}
   await stale.close()
  }
  if(follow){
   const text=await page.locator('body').innerText();assert.ok(text.includes('synthetic-porthole-8401'));assert.ok(text.includes('Current service revision 3 · critical'));assert.ok(text.includes('service revision 2'))
   let requestHeaders
   await context.route('https://restricted.example/**',async route=>{requestHeaders=route.request().headers();await route.fulfill({status:401,body:'Private runbook: authorization required'})})
   await page.getByRole('link',{name:'Open runbook',exact:true}).click();assert.ok((await page.locator('body').innerText()).includes('authorization required'));assert.ok(!requestHeaders.cookie,'native session is never sent to the runbook destination')
   await page.goto(origin+path)
   await page.getByRole('link',{name:'Open alert runbook',exact:true}).click();assert.ok((await page.locator('body').innerText()).includes('authorization required'));assert.ok(!requestHeaders.cookie,'firing context cannot grant document access');await page.goto(origin+path)
  }
  // Assertions run once at 1440. The same changed state is captured at both
  // widths; 390 is browser evidence, not a second permanent assertion suite.
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?900:844});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,name+'-'+width+'.png'),fullPage:true})}}
  await context.close()
 }finally{await browser.close()}
}
