import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {networkEstate} from '/workspace/run-porthole/tests/porthole/network/estate.mjs'
import {form,reviewRemoval} from '/workspace/run-porthole/tests/porthole/fixture.mjs'
import {servicesBrowser} from '/workspace/run-porthole/tests/porthole/services.mjs'
const roles=['checkout-kafka','fulfillment-kafka','checkout-rabbitmq','fulfillment-rabbitmq'],pause=ms=>new Promise(r=>setTimeout(r,ms))
export async function passiveNetworkProof({origin,call=(p,o)=>fetch(origin+p,o),freshOwner,signIn,sql,restartWorker,withEmptyDestination,analytical=false,browserDispatch}) {
 let cookie=await freshOwner()
 const post=async(p,d,status=200)=>{const r=await call(p,form(origin,cookie,d));assert.equal(r.status,status,await r.clone().text());return r.json()}
 const read=async(p,c=cookie)=>{const r=await call(p,{headers:{cookie:c}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const source=await post('/app/settings/credentials/mint',{name:'Passive live network proof',class:'ingest',scope:{services:roles,environments:['production'],teams:['commerce'],signals:['traces','metrics'],actions:['telemetry.write']}},201)
 const estate=await networkEstate({dispatch:call,secret:source.secret}),from=String(BigInt(Date.now())*1000000n)
 let original,stats,query,selected,spans
 try{
  await estate.start()
  for(const system of ['kafka','rabbitmq'])await estate.app('checkout-'+system,'/work?count=12&window=baseline')
  await pause(10000)
  for(const system of ['kafka','rabbitmq'])await estate.app('fulfillment-'+system,'/pause')
  for(const system of ['kafka','rabbitmq'])await estate.app('checkout-'+system,'/work?count=24&window=backlog')
  await pause(10000)
  for(const role of roles)await estate.app(role,'/flush');await pause(500)
  for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
  const through=String(BigInt(Date.now())*1000000n);query='?'+new URLSearchParams({from,through})
  original=await read('/api/porthole/v1/network-messaging'+query);selected=await read('/api/porthole/v1/services'+query+'&snapshot='+original.snapshot);stats=await estate.stats()
  const rawMetrics=[];let cursor=null;do{const data=await read('/api/porthole/v1/ingest/records?'+new URLSearchParams({signal:'metrics',from,through,snapshot:String(original.snapshot),limit:'200',...(cursor?{cursor}:{})}));rawMetrics.push(...data.records);cursor=data.cursor}while(cursor)
  await writeFile('/tmp/network-raw-'+(analytical?'analytical':'local')+'.json',JSON.stringify(rawMetrics))
  assert.equal(estate.foreign.sent,7)
  assert.ok(!JSON.stringify(rawMetrics).includes('synthetic-porthole-foreign'),'foreign virtual host metrics never enter current source scope')
  console.log('LIVE COUNTS',JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v.counts]))))
  await writeFile('/tmp/network-debug.json',JSON.stringify({original,stats,diagnostics:await estate.diagnostics(),metricPackets:estate.packets.filter(p=>p.path==='/v1/metrics').map(p=>JSON.parse(p.body))}))
  console.log('LIVE EVIDENCE',JSON.stringify({network:original.network.map(n=>({key:n.key,dns:n.dns.observations,connections:n.connections.observations,counters:n.counters.map(c=>({name:c.name,value:c.value,delta:c.delta}))})),messaging:original.messaging.map(q=>({system:q.system,scope:q.scope,producers:q.producers.observations,consumers:q.consumers.observations,metrics:q.metrics.map(m=>({name:m.name,value:m.value,attributes:m.attributes}))}))}))
  assert.deepEqual(selected.evidence,original)
  const pivot=original.network.find(n=>JSON.parse(n.key)[0]==='checkout-kafka').dns.evidence[0],trace=await read('/api/porthole/v1/traces/'+pivot.traceId+'?snapshot='+original.snapshot),attrs=trace.spans.find(s=>s.spanId===pivot.spanId).resource.attributes
  assert.equal(attrs.find(a=>a.key==='container.id').value.stringValue,estate.ids['checkout-kafka'])
  assert.equal(attrs.find(a=>a.key==='synthetic.private_value').value.stringValue,'[REDACTED]')
  assert.equal(original.scanComplete,true)
  for(const system of ['kafka','rabbitmq']){
   assert.equal(stats['checkout-'+system].counts.sent.length,36);assert.equal(stats['fulfillment-'+system].counts.received.length,12)
   const q=original.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='checkout-'+system)
   assert.ok(q);assert.equal(q.producers.observations,36);assert.equal(q.visibleQueue.producers.observations,36);assert.equal(q.visibleQueue.consumers.observations,12)
   const lag=q.metrics.find(m=>system==='kafka'?m.name==='kafka.consumer_group.lag':m.name==='rabbitmq.message.current'&&m.attributes.state==='ready')
   assert.ok(lag,'stock broker sample exists');assert.equal(lag.value,24)
  }
  const network=original.network.find(n=>JSON.parse(n.key)[0]==='checkout-kafka')
  assert.ok(network.dependencies.some(d=>d.to&&JSON.parse(d.to)[0]==='fulfillment-kafka'&&d.dns.observations===36),'real span parent identities resolve the dependency peer')
  assert.ok(network.dns.observations>=36);assert.ok(network.connections.observations>0)
  assert.ok(network.counters.some(c=>c.name==='node_netstat_Tcp_RetransSegs'&&c.delta!==null))
  assert.ok(network.counters.some(c=>c.name.startsWith('container.network.')))
  for(const system of ['kafka','rabbitmq'])await estate.app('fulfillment-'+system,'/resume')
  await pause(10000);for(const role of roles)await estate.app(role,'/flush');await pause(500)
  for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
  const current=await read('/api/porthole/v1/network-messaging?'+new URLSearchParams({from,through:String(BigInt(Date.now())*1000000n)}))
  for(const system of ['kafka','rabbitmq']){
   const q=current.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='fulfillment-'+system)
   assert.ok(q);assert.equal(q.consumers.observations,36);assert.equal(q.links.length,36)
  }
  spans=(await estate.stats());console.log('PASSIVE source reconciliation passed')
 } finally{await estate.stop()}
 const root='/api/porthole/v1/network-messaging',fixed=query+'&snapshot='+original.snapshot
 assert.equal((await call(root)).status,401)
 assert.equal((await read(root+'?from=1&through=2')).network.length,0)
 const id=selected.services.find(s=>s.service==='checkout-kafka').id
 await servicesBrowser({origin,cookie,path:'/app/services/'+id+fixed,contains:'Network and messaging evidence',name:'passive-network-'+(analytical?'analytical':'local'),dispatch:browserDispatch,networkExpected:{network:original.network.find(n=>JSON.parse(n.key)[0]==='checkout-kafka')}})
 const queueId=selected.services.find(s=>s.service==='checkout-rabbitmq').id
 await servicesBrowser({origin,cookie,path:'/app/services/'+queueId+fixed,contains:'rabbitmq.message.current',name:'passive-queue-'+(analytical?'analytical':'local'),dispatch:browserDispatch,networkExpected:{queue:original.messaging.find(q=>q.system==='rabbitmq'&&JSON.parse(q.scope)[0]==='checkout-rabbitmq')}})
 const email=['synthetic-porthole-9333','example.invalid'].join(String.fromCharCode(64))
 await post('/app/settings/members/invite',{email,displayName:'Native network reader',role:'responder',scope:{services:['checkout-kafka'],environments:['production'],teams:['commerce']}},202)
 const restricted=await signIn(email),member=(await read('/auth/session',restricted)).operator
 assert.ok(!JSON.stringify(await read(root+fixed,restricted)).includes('rabbitmq'))
 cookie=await freshOwner();const otherAddress=['synthetic-porthole-9334','example.invalid'].join(String.fromCharCode(64))
 await post('/app/settings/members/invite',{email:otherAddress,displayName:'Other team reader',role:'responder',scope:{services:roles,environments:['production'],teams:['synthetic-porthole-other-team']}},202)
 const otherCookie=await signIn(otherAddress),otherMember=(await read('/auth/session',otherCookie)).operator,otherView=await read(root+fixed,otherCookie)
 assert.deepEqual(otherView.network,[]);assert.deepEqual(otherView.messaging,[])
 cookie=await freshOwner();await post('/app/settings/members/remove',await reviewRemoval(origin,cookie,otherMember.id,{call}))
 cookie=await freshOwner();await post('/app/settings/members/remove',await reviewRemoval(origin,cookie,member.id,{call}))
 assert.equal((await call(root+fixed,{headers:{cookie:restricted}})).status,401)
 await restartWorker();cookie=await freshOwner();assert.deepEqual(await read(root+fixed),original)
 if(withEmptyDestination){const {networkArchiveJourney}=await import('/workspace/run-porthole/tests/porthole/archive.mjs');await networkArchiveJourney({origin,freshOwner,withEmptyDestination,query:fixed,expected:original})}
 cookie=await freshOwner()
 if(!analytical){const preview=await post('/api/porthole/v1/subject-erasure',{identifier:'checkout-kafka'});await post('/api/porthole/v1/subject-erasure/apply',{identifier:'checkout-kafka',digest:preview.digest,confirm:'erase-exact-batches'});assert.ok(!(await read(root+query)).network.some(n=>JSON.parse(n.key)[0]==='checkout-kafka'))
  let refused=0;for(const p of estate.packets){const r=await call(p.path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':p.type},body:p.body});assert.ok([200,409].includes(r.status));if(r.status===409)refused++}
  assert.ok(refused>0);for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
  assert.ok(!(await read(root+query)).network.some(n=>JSON.parse(n.key)[0]==='checkout-kafka'))}
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 const receipt={status:'pass',head:process.env.PORTHOLE_PROOF_HEAD??'working-tree',analytical,foreignNamespaceControl:estate.foreign,proof:'Counted real producer and consumer backlog; no netem claim',query:fixed,view:original,sourceCounts:Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v.counts])),omittedSourceFields:['resource.synthetic.private_value'],capturedSpans:Object.fromEntries(Object.entries(spans).map(([k,v])=>[k,v.spans.map(s=>{const resource={...s.resource};delete resource['synthetic.private_value'];return {...s,resource}})])),checks:['native API and Services parity','Kafka and RabbitMQ 24 message backlog','36 sends and 36 resumed consume spans','36 propagated links per broker','real DNS and TCP spans','namespace counter deltas','container counters','scope and next-request revocation','restart',...(withEmptyDestination?['inactive restore and re-export']:[]),...(!analytical?['erasure withdraws derived evidence']:[])]}
 await writeFile(process.env.PORTHOLE_EVIDENCE_DIR+'/PASSIVE-'+(analytical?'analytical':'local')+'.json',JSON.stringify(receipt,null,2))
 console.log('PASSIVE-NETWORK-PROOF PASS '+(analytical?'analytical':'local'))
 return receipt
}
