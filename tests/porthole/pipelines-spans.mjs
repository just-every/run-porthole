import assert from 'node:assert/strict'
import {literal} from './fixture.mjs'
export async function pipelineSpanPrivacy({origin,cookie,sql,definition:d,post,value,planted,at}) {
 const scope={services:[d.service],environments:[d.environment],teams:[d.team]}
 const source=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-12200',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}}),201)
 const traceId='7a'.repeat(16),spanId='8b'.repeat(8)
 const packet={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:d.service}},{key:'deployment.environment.name',value:{stringValue:d.environment}},{key:'team.name',value:{stringValue:d.team}}]},scopeSpans:[{spans:[{traceId,spanId,name:'Checkout card '+planted[1],startTimeUnixNano:String(at),endTimeUnixNano:String(at+1000n),attributes:[{key:'authorization',value:{stringValue:planted[6]}},{key:'customer',value:{stringValue:planted[0]}},{key:'custom',value:{stringValue:'private-1234 private-0000'}}]}]}]}]}
 const send=()=>fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(packet)})
 const accepted=await send();assert.equal(accepted.status,200)
 const id=accepted.headers.get('x-porthole-batch'),batch=(await sql(`SELECT * FROM porthole_ingest_batches WHERE id=${literal(id)}`))[0]
 const decoded=JSON.parse(Buffer.from(batch.wire_base64,'base64').toString())
 assert.equal(decoded.format,'porthole.sanitized-trace-envelope.v1')
 for(const secret of [planted[0],planted[1],planted[6],'private-1234'])assert.ok(!JSON.stringify(decoded).includes(secret),'span queues mask sensitive nested AnyValue fields')
 assert.ok(JSON.stringify(decoded).includes('private-0000'),'approved exact custom exception survives on spans')
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const trace=await value(await fetch(origin+'/api/porthole/v1/traces/'+traceId,{headers:{cookie}}))
 assert.equal(trace.spans.length,1);assert.equal(trace.spans[0].spanId,spanId);assert.equal(trace.spans[0].startTimeNs,String(at),'structural trace identity and nanoseconds survive masking')
 const retained=await sql(`SELECT payload FROM porthole_telemetry_records WHERE batch_id=${literal(id)} UNION ALL SELECT payload FROM porthole_telemetry_archive WHERE batch_id=${literal(id)}`)
 assert.equal(retained.length,2)
 for(const secret of [planted[0],planted[1],planted[6]])assert.ok(!JSON.stringify(retained).includes(secret))
 assert.equal((await send()).headers.get('x-porthole-duplicate'),'true')
}
