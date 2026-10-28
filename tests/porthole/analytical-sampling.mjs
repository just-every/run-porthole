import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

/** Extend the real primary and standby journey with durable late promotion. */
export async function analyticalSamplingJourney({context,cookie,estate,source,scope}) {
 const {call,post,getDb}=context,api='/api/porthole/v1/analytics'
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
 const read=path=>call(path,{headers:{cookie}}).then(json)
 const change=async(role,status=200)=>{const state=await read(api+'/configuration');return post(api+'/configuration',{revision:state.revision,role,enabled:true,confirm:'connect-analytical-workers'},status,cookie)}
 let traceId
 for(let i=0;!traceId;i++){
  const id=createHash('sha256').update('synthetic-porthole-analytical-sampling-'+i).digest('hex').slice(0,32)
  const draw=parseInt(createHash('sha256').update(JSON.stringify([scope.teams[0],scope.environments[0],id])).digest('hex').slice(0,8),16)%10000
  if(draw>=1000)traceId=id
 }
 const at=BigInt(Date.now())*1000000n,resource={attributes:[['service.name',scope.services[0]],['deployment.environment.name',scope.environments[0]],['team.name',scope.teams[0]]].map(([key,stringValue])=>({key,value:{stringValue}}))}
 const span=(id,error)=>({traceId,spanId:id,name:'analytical_sampling',startTimeUnixNano:String(at),endTimeUnixNano:String(at+1000000n),status:{code:error?2:1}})
 const send=async record=>{const response=await call('/api/porthole/v1/ingest/pre-sampling/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({resourceSpans:[{resource,scopeSpans:[{spans:[record]}]}]})});assert.equal(response.status,200,await response.clone().text());return response.headers.get('x-porthole-batch')}
 const records=()=>read('/api/porthole/v1/ingest/records?signal=traces&trace='+traceId)
 await send(span('aaaaaaaaaaaaaaa1',false))
 assert.deepEqual((await records()).records,[],'ordinary sampled-out parent is absent on selected analytical reads')
 await estate.stop('standby')
 const childId=await send(span('aaaaaaaaaaaaaaa2',true))
 let product=await records();assert.equal(product.analytical.role,'primary');assert.equal(product.records.length,2);assert.ok(product.records.every(row=>row.payload.sampling.reason==='error'))
 await estate.start('standby')
 // Catch up only the immutable base through the real worker transport. Its
 // separate projection cursor must still block selection and ordinary reads.
 const batch=await getDb().prepare('SELECT * FROM porthole_ingest_batches WHERE id=?').bind(childId).first(),original=JSON.parse(batch.records)
 const packet={id:batch.id,completionSequence:batch.completion_sequence,sourceId:batch.source_id,signal:batch.signal,digest:batch.digest,acceptedAt:batch.accepted_at,completedAt:batch.completed_at,records:[],samplingOrigins:original.map((row,ordinal)=>({ordinal,team:row.team,service:row.service,environment:row.environment,eventTimeNs:row.eventTimeNs,traceId:row.traceId,spanId:row.spanId}))}
 const identity=(await getDb().prepare('SELECT source_identity FROM porthole_analytical_configuration').first()).source_identity
 const response=await fetch(estate.origin('standby')+'/v1/replicate',{method:'POST',headers:{authorization:'Bearer '+estate.bindings.ANALYTICS_STANDBY_TOKEN,'content-type':'application/json'},body:JSON.stringify({sourceIdentity:identity,batches:[packet]})})
 const behind=await json(response)
 assert.equal(behind.watermark,batch.completion_sequence)
 await change('standby',409)
 assert.equal((await read(api+'/configuration')).role,'primary','base-only coverage cannot conceal missing retained promotions')
 await post(api+'/reconcile',{},200,cookie)
 await change('standby')
 product=await records();assert.equal(product.analytical.role,'standby');assert.equal(product.records.length,2)
 assert.deepEqual(product.records.map(row=>row.span_id).sort(),['aaaaaaaaaaaaaaa1','aaaaaaaaaaaaaaa2'])
 await context.restart()
 await send(span('aaaaaaaaaaaaaaa2',true))
 assert.equal((await records()).records.length,2,'native restart and captured retry cannot duplicate projected spans')
 await change('primary')
 const replay=await records();assert.equal(replay.records.length,2);assert.ok(replay.records.every(row=>row.payload.sampling.weight===1))
 console.log('analyticalSamplingJourney passed: sampled-out parent, late protected promotion, sparse origins, real stopped standby, base-only coverage refusal, projection replay and failover with no native-data fallback')
}
