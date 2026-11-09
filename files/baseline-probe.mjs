import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {networkEstate} from '/workspace/run-porthole/tests/porthole/network/estate.mjs'
import {servicesBrowser} from '/workspace/run-porthole/tests/porthole/services.mjs'
import {form} from '/workspace/run-porthole/tests/porthole/fixture.mjs'
export async function baselineProbe({origin,freshOwner}) {
 const packet='/home/agent/rer-consolidation/work/sx-porthole-c-f466-pc1/packet'
 const cookie=await freshOwner(),call=(path,options)=>fetch(origin+path,options)
 const post=async(path,data,status=200)=>{const response=await call(path,form(origin,cookie,data));assert.equal(response.status,status,await response.clone().text());return response.json()}
 const read=async path=>{const response=await call(path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()}
 const roles=['checkout-kafka','fulfillment-kafka','checkout-rabbitmq','fulfillment-rabbitmq']
 const source=await post('/app/settings/credentials/mint',{name:'Owned network baseline probe',class:'ingest',scope:{services:roles,environments:['production'],teams:['commerce'],signals:['traces','metrics'],actions:['telemetry.write']}},201)
 const estate=await networkEstate({dispatch:call,secret:source.secret})
 try {
  await estate.start()
  const from=String(BigInt(Date.now())*1000000n)
  for(const system of ['kafka','rabbitmq'])await estate.app('checkout-'+system,'/work?count=3&window=baseline-probe')
  await new Promise(r=>setTimeout(r,4500))
  for(const role of roles)await estate.app(role,'/flush')
  await new Promise(r=>setTimeout(r,500))
  const through=String(BigInt(Date.now())*1000000n),stats=await estate.stats()
  for(let pass=0;pass<100;pass++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
  const query='?'+new URLSearchParams({from,through}),view=await read('/api/porthole/v1/network-messaging'+query),catalog=await read('/api/porthole/v1/services'+query+'&snapshot='+view.snapshot)
  assert.equal(view.scanComplete,true);assert.deepEqual(view,catalog.evidence)
  for(const system of ['kafka','rabbitmq']){
   assert.equal(stats['checkout-'+system].counts.sent.length,3)
   assert.equal(stats['fulfillment-'+system].counts.received.length,3)
   const row=view.messaging.find(q=>q.system===system&&JSON.parse(q.scope)[0]==='checkout-'+system)
   assert.equal(row.producers.observations,3)
   assert.equal(row.visibleQueue.consumers.observations,3)
   assert.equal(row.links.length,3)
  }
  const service=catalog.services.find(s=>s.service==='checkout-kafka'),network=view.network.find(n=>JSON.parse(n.key)[0]==='checkout-kafka')
  assert.ok(network.dns.observations>=3)
  process.env.PORTHOLE_EVIDENCE_DIR=packet
  await servicesBrowser({origin,cookie,path:'/app/services/'+service.id+query+'&snapshot='+view.snapshot,contains:'Network and messaging evidence',name:'network-baseline',networkExpected:{network}})
  await writeFile(packet+'/network-baseline-receipt.json',JSON.stringify({head:process.env.PORTHOLE_PROBE_HEAD,from,through,snapshot:view.snapshot,scanComplete:view.scanComplete,counts:Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v.counts])),network:view.network,messaging:view.messaging,checks:['three counted sends and receives per broker','three propagated links per broker','stock DNS observations','Services and versioned evidence share a completed snapshot','Services browser values, keyboard focus and reflow at 1440; screenshots at 1440 and 390'],faults:'Not induced; the cloud kernel lacks netem.'},null,2))
  await post('/app/settings/credentials/revoke',{id:source.credential.id})
  console.log('PROBE PORT-060 baseline: three counted sends and receives per actual broker -> exact API producer and consumer counts, trace links, stock DNS, shared Services watermark and 1440 and 390 screens')
 } finally {await estate.stop()}
}
