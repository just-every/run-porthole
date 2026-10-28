import assert from 'node:assert/strict'
import {analyticalEstate} from './analytics.mjs'
import {recipientMailJourney} from './health.mjs'
export async function pipelineAnalyticalJourney() {
 const estate=await analyticalEstate()
 try {
  await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async context=>{
   const {post,call,cookie,restart}=context
   const value=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
   const d={service:'checkout-pipeline',environment:'production',team:'payments',processors:[{type:'json'}],metrics:[{name:'checkout.logs'}],exclude:{field:'level',equals:'debug'}}
   const preview=await (await post('/api/porthole/v1/pipelines/preview',{definition:d,revision:0,samples:[]},201)).json()
   await post('/api/porthole/v1/pipelines/activate',{previewId:preview.id,digest:preview.digest,confirm:'activate-pipeline'},201)
   const config=await value(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}}))
   await post('/api/porthole/v1/analytics/configuration',{revision:config.revision,role:'primary',enabled:true,confirm:'connect-analytical-workers'})
   const scope={services:[d.service],environments:[d.environment],teams:[d.team]}
   const source=await (await post('/app/settings/credentials/mint',{name:'synthetic-porthole-12100',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}},201)).json()
   const planted=['123'+'-45-'+'6789','4111'+'1111'+'1111'+'1111','(415) 555'+'-0123'],at=BigInt(Date.now())*1000000n
   const packet={resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:d.service}},{key:'deployment.environment.name',value:{stringValue:d.environment}},{key:'team.name',value:{stringValue:d.team}}]},scopeLogs:[{logRecords:[...planted.map((secret,i)=>({timeUnixNano:String(at+BigInt(i)),body:{stringValue:JSON.stringify({message:'Checkout privacy '+secret,level:'info'})}})),{timeUnixNano:String(at+3n),body:{stringValue:JSON.stringify({message:'Checkout debug',level:'debug'})}}]}]}]}
   const ingest=()=>call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(packet)})
   assert.equal((await ingest()).status,200)
   const drained=await (await post('/api/porthole/v1/ingest/drain',{})).json();assert.equal(drained.analytical.complete,true)
   for(const path of ['/api/porthole/v1/ingest/records','/api/porthole/v1/ingest/archive']){
    const result=await value(await call(path+'?signal=logs&service='+d.service,{headers:{cookie}}))
    assert.equal(result.records.length,3);assert.equal(result.analytical.role,'primary')
    for(const secret of planted)assert.ok(!JSON.stringify(result).includes(secret),'query exposes only sanitized analytical data')
   }
   for(const role of ['primary','standby']){
    const rows=await estate.inspect(role)
    assert.equal(rows.length,3,'both physical analytical replicas receive accepted records')
    for(const secret of planted)assert.ok(!JSON.stringify(rows).includes(secret),'no planted values in analytical durable payload')
   }
   const totals=await (await post('/api/porthole/v1/pipelines/metrics',{definition:d,from:String(at),through:String(at+10n)})).json()
   assert.equal(totals.groups[0].count,4,'analytical exclusion keeps configured pre-exclusion metric totals')
   await restart();const retry=await ingest();assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-duplicate'),'true')
   await post('/api/porthole/v1/ingest/drain',{})
   assert.equal((await estate.inspect('primary')).length,3,'analytical replay after restart creates no copies')
  }})
 }finally{await estate.dispose()}
 console.log('pipelineAnalyticalJourney passed: real primary and standby custody, native query and restart replay')
}
