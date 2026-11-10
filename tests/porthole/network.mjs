import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {form,literal,reviewRemoval} from './fixture.mjs'
import {networkEstate} from './network/estate.mjs'
import {servicesBrowser} from './services.mjs'
const root='/api/porthole/v1/network-messaging',services='/api/porthole/v1/services'
const roles=['checkout-kafka','fulfillment-kafka','checkout-rabbitmq','fulfillment-rabbitmq']
const sourceScope={services:roles,environments:['production'],teams:['commerce'],signals:['traces','metrics'],actions:['telemetry.write']}
let retainedProof
const within=(span,w)=>BigInt(span.startNs)>=BigInt(w.from)&&BigInt(span.startNs)<=BigInt(w.through)
const summary=spans=>{const d=spans.map(s=>BigInt(s.durationNs)).sort((a,b)=>a<b?-1:a>b?1:0);return {observations:spans.length,failures:spans.filter(s=>s.status.code===2).length,p95Ns:d.length?String(d[Math.ceil(d.length*.95)-1]):null}}
const snmp=(source,group,field)=>{const lines=source.split('\n').filter(l=>l.startsWith(group+':'));const keys=lines[0].trim().split(/\s+/),values=lines[1].trim().split(/\s+/);return Number(values[keys.indexOf(field)])}
export async function networkJourney({origin,call=(path,options)=>fetch(origin+path,options),freshOwner,signIn,sql,restartWorker,withEmptyDestination,analytical=false,browserDispatch,onCaptured}) {
 let cookie=await freshOwner()
 const post=async(path,data,status=200)=>{const r=await call(path,form(origin,cookie,data));assert.equal(r.status,status,await r.clone().text());return r.json()}
 const read=async(path,acting=cookie)=>{const r=await call(path,{headers:{cookie:acting}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 assert.equal((await call(root)).status,401)
 assert.equal((await read(root+'?from=1&through=2')).network.length,0)
 // Collectors export throughout the multi-minute fault windows; restart,
 // analytical and erasure proofs then replay those same packets in a burst.
 // Give this load fixture an explicit finite burst budget instead of spending
 // the ordinary 600-request / 10 MiB per-minute defaults on captured history.
 const source=await post('/app/settings/credentials/mint',{name:'Native disposable network fixture',class:'ingest',scope:sourceScope,requestsPerMinute:10000,acceptedBytesPerMinute:64*1024*1024},201)
 let proof
 if(!retainedProof){
  const estate=await networkEstate({dispatch:call,secret:source.secret})
  try{await estate.start();proof=retainedProof=await estate.exercise()}finally{await estate.stop()}
 }else{
  proof=retainedProof
  for(const p of proof.packets){const r=await call(p.path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':p.type},body:p.body});assert.equal(r.status,200,await r.clone().text())}
 }
 let pending=1;for(let i=0;i<100&&pending;i++)pending=(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches
 assert.equal(pending,0)
 // The analytical proof owns separate stores and replays this immutable capture.
 // Start it alongside native assertions/archive work, then the harness joins it.
 onCaptured?.()
 const allSpans=Object.values(proof.stats).flatMap(s=>s.spans)
 const results=[]
 for(const w of proof.windows){
  const query='?'+new URLSearchParams({from:w.from,through:w.through}),view=await read(root+query),catalog=await read(services+query+'&snapshot='+view.snapshot)
  assert.equal(view.version,1);assert.equal(view.scanComplete,true,w.name)
  assert.equal(view.snapshot,catalog.snapshot);
  assert.ok(!JSON.stringify(view).includes('synthetic-porthole-foreign'),'the other virtual host is excluded before scope assignment');assert.deepEqual(view,catalog.evidence)
  for(const row of view.network){
   const name=JSON.parse(row.key)[0],spans=allSpans.filter(s=>s.resource['service.name']===name&&within(s,w))
   for(const [type,scope]of [['dns','@opentelemetry/instrumentation-dns'],['connections','@opentelemetry/instrumentation-net']]){
    const actual=summary(spans.filter(s=>s.scope?.name===scope));for(const key of ['observations','failures','p95Ns'])assert.equal(row[type][key],actual[key],w.name+' '+name+' '+type+' '+key)
   }
   assert.ok(row.identities.every(i=>i.containerId===proof.ids[name]&&i.hostId===proof.ids.host),'only declared actual container and host identities correlate')
   for(const counter of row.counters){
    assert.equal(counter.resource.containerId,proof.ids[name]);assert.equal(counter.resource.hostId,proof.ids.host)
    if(counter.name.includes('_dropped')){const side=counter.name.includes('rx_')?'rx':'tx';assert.ok(counter.value>=w.before.containerDrops[side]&&counter.value<=w.after.containerDrops[side],'container drop sample bounded by independent interface counters')}
    if(counter.name==='node_netstat_Tcp_RetransSegs'){
     const first=snmp(w.before.snmp,'Tcp','RetransSegs'),last=snmp(w.after.snmp,'Tcp','RetransSegs')
     assert.ok(counter.value>=first&&counter.value<=last,'passive sample bounded by independent namespace snapshots')
    }
   }
  }
  for(const q of view.messaging){
   const role=JSON.parse(q.scope)[0],sent=allSpans.filter(s=>s.resource['service.name']===role&&within(s,w)&&s.kind===4&&s.attributes['messaging.system']===q.system)
   assert.equal(q.producers.observations,sent.length)
   assert.ok(q.system!=='rabbitmq'||q.namespace==='/');assert.ok(q.metrics.every(m=>q.system!=='rabbitmq'||m.attributes['rabbitmq.vhost.name']===q.namespace));
   assert.ok(q.metrics.every(m=>m.resource.hostId===proof.ids.host&&m.resource.containerId===proof.ids[q.system]))
   for(const link of q.links){assert.ok(allSpans.some(s=>s.spanId===link.producer.spanId&&s.traceId===link.producer.traceId&&s.kind===4));assert.ok(allSpans.some(s=>s.spanId===link.consumer.spanId&&s.traceId===link.consumer.traceId&&s.kind===5))}
  }
  results.push({name:w.name,query,view,catalog})
 }
 const baseline=results.find(w=>w.name==='baseline'),dns=results.find(w=>w.name==='dns-delay'),loss=results.find(w=>w.name==='packet-loss'),backlog=results.find(w=>w.name==='backlog')
 const networkFor=r=>r.view.network.find(n=>JSON.parse(n.key)[0]==='checkout-kafka')
 assert.ok(networkFor(dns).dependencies.some(d=>d.to&&JSON.parse(d.to)[0]==='fulfillment-kafka'&&d.dns.observations>=8),'trace-parent identities attach DNS to the actual peer');
 assert.ok(networkFor(dns).dns.observations>=8,'real resolver-path lookups are retained')
 assert.ok(Number(networkFor(dns).dns.p95Ns)>=80000000,'80 ms resolver fault is visible in passively captured DNS timings')
 assert.ok(Number(networkFor(dns).dns.p95Ns)>Number(networkFor(baseline).dns.p95Ns))
 const retrans=snmp(proof.windows.find(w=>w.name==='packet-loss').after.snmp,'Tcp','RetransSegs')-snmp(proof.windows.find(w=>w.name==='packet-loss').before.snmp,'Tcp','RetransSegs')
 const retransSeries=networkFor(loss).counters.find(c=>c.name==='node_netstat_Tcp_RetransSegs');assert.ok(Math.abs(retransSeries.delta-retrans)<=2,'sample delta reconciles with namespace boundaries within two counter increments');
 assert.ok(retrans>0,'pair-restricted real packet loss causes namespace retransmissions')
 assert.ok(networkFor(loss).counters.some(c=>c.name==='node_netstat_Tcp_RetransSegs'&&c.delta!==null),'stock namespace exporter supplies cumulative counter deltas')
 for(const system of ['kafka','rabbitmq']){
  const q=backlog.view.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='checkout-'+system)
  assert.ok(q,'counted broker producer association')
  const lag=q.metrics.find(m=>system==='kafka'?m.name==='kafka.consumer_group.lag':m.name==='rabbitmq.message.current'&&m.attributes.state==='ready')
  assert.ok(lag,'stock broker lag or queue-depth evidence is present');assert.equal(lag.value,24,'paused real consumer backlog equals independent application send count')
  const sourceWindow=proof.windows.find(w=>w.name==='backlog')
  if(system==='kafka'){const row=sourceWindow.after.kafka.split('\n').map(l=>l.trim().split(/\s+/)).find(p=>p[0]==='synthetic-porthole-network-group'&&p[2]==='0');assert.ok(row);for(const [name,index]of [['kafka.consumer_group.offset',3],['kafka.partition.current_offset',4],['kafka.consumer_group.lag',5]])assert.equal(q.metrics.find(m=>m.name===name).value,Number(row[index]),'independent broker offset and lag reconciliation')}
  else{const row=sourceWindow.after.rabbit.split('\n').map(l=>l.trim().split(/\s+/)).find(p=>p[0]===q.destination);assert.ok(row);assert.equal(lag.value,Number(row[1]),'independent broker-reported queue depth')}
  assert.equal(q.producers.observations,24)
  const restoredWindow=proof.windows.find(w=>w.name==='restored-consumers')
  const combined=await read(root+'?'+new URLSearchParams({from:proof.windows.find(w=>w.name==='backlog').from,through:restoredWindow.through}))
  const after=combined.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='fulfillment-'+system)
  assert.ok(after?.consumers.observations>=24,'resumed real consumer spans supply processing latency')
  assert.ok(after.links.length>=24,'stock propagation links each real producer and consumer')
 }
 const failed=networkFor(results.find(w=>w.name==='application-failures'))
 assert.ok(failed.dns.failures>0);assert.ok(failed.connections.failures>0)
 for(const [name,source]of [['namespace','tcp'],['docker-socket','container']]){
  const gap=networkFor(results.find(w=>w.name==='denied-'+name)).gaps.find(g=>g.source===source)
  assert.ok(gap,'removed '+name+' produces a named coverage gap');assert.ok(gap.missing);assert.ok(gap.nextAction)
  assert.ok(!networkFor(results.find(w=>w.name==='restored-'+name)).gaps.some(g=>g.source===source),'restoration supplies fresh '+source+' evidence')
 }
 for(const [name,system]of [['kafka-grant','kafka'],['rabbit-permission','rabbitmq']]){
  const row=results.find(w=>w.name==='denied-'+name).view.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='checkout-'+system)
  assert.ok(row,'live traffic retains the affected association');assert.ok(row.gaps.length,'removed broker read grant must not become zero lag')
 }
 const selected=await read(services+dns.query+'&snapshot='+dns.view.snapshot),checkout=selected.services.find(s=>s.service==='checkout-kafka')
 const traceRef=networkFor(dns).dns.evidence[0],trace=await read('/api/porthole/v1/traces/'+traceRef.traceId+'?snapshot='+dns.view.snapshot)
 assert.ok(trace.spans.some(s=>s.spanId===traceRef.spanId&&s.service==='checkout-kafka'))
 const retained=trace.spans.find(s=>s.spanId===traceRef.spanId).resource.attributes
 assert.equal(retained.find(a=>a.key==='container.id').value.stringValue,proof.ids['checkout-kafka'])
 assert.equal(retained.find(a=>a.key==='synthetic.private_value').value.stringValue,'[REDACTED]','ordinary resource payload values retain mandatory privacy masks')
 await servicesBrowser({origin,cookie,path:'/app/services/'+checkout.id+dns.query+'&snapshot='+dns.view.snapshot,contains:'Network and messaging evidence',name:'network-dns-'+(analytical?'analytical':'local'),dispatch:browserDispatch,networkExpected:{network:networkFor(dns)}})
 const queueService=backlog.catalog.services.find(s=>s.service==='checkout-rabbitmq')
 await servicesBrowser({origin,cookie,path:'/app/services/'+queueService.id+backlog.query+'&snapshot='+backlog.view.snapshot,contains:'rabbitmq.message.current',name:'network-backlog-'+(analytical?'analytical':'local'),dispatch:browserDispatch,networkExpected:{queue:backlog.view.messaging.find(q=>q.system==='rabbitmq'&&JSON.parse(q.scope)[0]==='checkout-rabbitmq')}})
 const gapWindow=results.find(w=>w.name==='denied-docker-socket'),gapService=gapWindow.catalog.services.find(s=>s.service==='checkout-kafka')
 await servicesBrowser({origin,cookie,path:'/app/services/'+gapService.id+gapWindow.query+'&snapshot='+gapWindow.view.snapshot,contains:'Docker socket read access',name:'network-gap-'+(analytical?'analytical':'local'),dispatch:browserDispatch})
 const email=['synthetic-porthole-9321','example.invalid'].join(String.fromCharCode(64))
 await post('/app/settings/members/invite',{email,displayName:'Scoped network responder',role:'responder',scope:{services:['checkout-kafka'],environments:['production'],teams:['commerce']}},202)
 const restricted=await signIn(email),member=(await read('/auth/session',restricted)).operator
 const hidden=await read(root+backlog.query,restricted)
 assert.ok(hidden.network.every(n=>JSON.parse(n.key)[0]==='checkout-kafka'));assert.ok(hidden.messaging.every(q=>JSON.parse(q.scope)[0]==='checkout-kafka'))
 assert.ok(!JSON.stringify(hidden).includes('checkout-rabbitmq'),'foreign queue and counter identities do not leak')
 const otherTeamAddress=['synthetic-porthole-9322','example.invalid'].join(String.fromCharCode(64))
 cookie=await freshOwner();await post('/app/settings/members/invite',{email:otherTeamAddress,displayName:'Other team network reader',role:'responder',scope:{services:roles,environments:['production'],teams:['synthetic-porthole-other-team']}},202)
 const otherTeamCookie=await signIn(otherTeamAddress),otherTeamMember=(await read('/auth/session',otherTeamCookie)).operator
 const otherTeamView=await read(root+backlog.query,otherTeamCookie);assert.deepEqual(otherTeamView.network,[]);assert.deepEqual(otherTeamView.messaging,[],'no other team edge, queue or counter appears from the nonempty fixture')
 cookie=await freshOwner();await post('/app/settings/members/remove',await reviewRemoval(origin,cookie,otherTeamMember.id,{call}))
 cookie=await freshOwner();await post('/app/settings/members/remove',await reviewRemoval(origin,cookie,member.id,{call}))
 assert.equal((await call(root+backlog.query,{headers:{cookie:restricted}})).status,401,'next-request scope revocation fences accumulated evidence')
 await restartWorker();cookie=await freshOwner()
 assert.deepEqual(await read(root+dns.query+'&snapshot='+dns.view.snapshot),dns.view,'restart reconstructs exact evidence from retained inputs')
 const before=await read(root+backlog.query)
 for(const packet of proof.packets){const r=await call(packet.path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':packet.type},body:packet.body});assert.equal(r.status,200,await r.clone().text())}
 for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
 const after=await read(root+backlog.query+'&snapshot='+before.snapshot)
 assert.deepEqual(after,before,'replayed stock packets cannot alter a completed watermark')
 if(withEmptyDestination){const {networkArchiveJourney}=await import('./archive.mjs');await networkArchiveJourney({origin,freshOwner,withEmptyDestination,query:backlog.query+'&snapshot='+before.snapshot,expected:before})}
 cookie=await freshOwner()
 if(!analytical){
  const preview=await post('/api/porthole/v1/subject-erasure',{identifier:'checkout-kafka'})
  await post('/api/porthole/v1/subject-erasure/apply',{identifier:'checkout-kafka',digest:preview.digest,confirm:'erase-exact-batches'})
  const erased=await read(root+backlog.query);assert.ok(!erased.network.some(n=>JSON.parse(n.key)[0]==='checkout-kafka'));assert.ok(!erased.messaging.some(q=>JSON.parse(q.scope)[0]==='checkout-kafka'),'no detached aggregate survives erased source custody')
  await restartWorker();cookie=await freshOwner();assert.deepEqual(await read(root+backlog.query),erased)
  let refused=0
  for(const p of proof.packets){const r=await call(p.path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':p.type},body:p.body});assert.ok([200,409].includes(r.status));if(r.status===409)refused++}
  assert.ok(refused>0,'actual erased network capture replay is refused')
  for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
  assert.ok(!(await read(root+backlog.query)).network.some(n=>JSON.parse(n.key)[0]==='checkout-kafka'),'latest intake watermark cannot resurrect erased evidence')
  const afterReplay=await read(root+backlog.query)
  await restartWorker();cookie=await freshOwner();assert.deepEqual(await read(root+backlog.query),afterReplay)
 }
 await post('/app/settings/credentials/revoke',{id:source.credential.id})
 assert.equal((await call(proof.packets[0].path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':proof.packets[0].type},body:proof.packets[0].body})).status,401)
 if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.PORTHOLE_EVIDENCE_DIR,'network-receipt-'+(analytical?'analytical':'local')+'.json'),JSON.stringify({windows:proof.windows.map(w=>({...w,before:{...w.before,apps:Object.fromEntries(Object.entries(w.before.apps).map(([k,v])=>[k,v.counts]))},after:{...w.after,apps:Object.fromEntries(Object.entries(w.after.apps).map(([k,v])=>[k,v.counts]))}})),denials:proof.denials,pins:proof.pins,results:results.map(r=>({name:r.name,query:r.query,snapshot:r.view.snapshot,network:r.view.network,messaging:r.view.messaging}))},null,2))}
 console.log('PROBE PORT-060 disposable network: real counted containers, resolver delay, pair loss and broker backlog -> reconciled stock spans, namespace and broker counters; explicit missing privileges, same-window API and Services, scope revocation, replay and restart')
 return {proof,results,query:backlog.query,view:before}
}
