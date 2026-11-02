import assert from 'node:assert/strict'
import {literal} from './fixture.mjs'
export async function pipelineSpanPrivacy({origin,cookie,sql,definition:d,post,value,planted,at}) {
 const scope={services:[d.service],environments:[d.environment],teams:[d.team]}
 const source=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-12200',class:'ingest',scope:{...scope,signals:['traces'],actions:['telemetry.write']}}),201)
 const traceId='7a'.repeat(16),spanId='8b'.repeat(8)
 const packet={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:d.service}},{key:'deployment.environment.name',value:{stringValue:d.environment}},{key:'team.name',value:{stringValue:d.team}}]},scopeSpans:[{spans:[{traceId,spanId,name:'Checkout card '+planted[1],startTimeUnixNano:String(at),endTimeUnixNano:String(at+1000n),attributes:[{key:'authorization',value:{stringValue:planted[6]}},{key:'customer',value:{stringValue:planted[0]}},{key:'custom',value:{stringValue:'private-1234 private-0000'}},{key:'sensitive',value:{stringValue:planted.slice(0,6).concat(planted.slice(7,10),['Bearer '+planted[10],'Basic '+Buffer.from(planted[11]).toString('base64')]).join(' ')}},{key:'api_key',value:{stringValue:planted[12]}},{key:'client_secret',value:{stringValue:planted[13]}},{key:'http.request.header.x-api-key',value:{stringValue:planted[10]}},{key:'db.password',value:{stringValue:planted[11]}},{key:'aws.secret_access_key',value:{stringValue:planted[13]}},{key:'http.request.header.x-amz-security-token',value:{stringValue:planted[10]}},{key:'http.request.header.x-goog-api-key',value:{stringValue:planted[12]}},{key:'http.request.header.ocp-apim-subscription-key',value:{stringValue:planted[11]}},{key:'numericIdentifier',value:{doubleValue:Number(planted[9])}}],events:[{timeUnixNano:String(at),name:'Checkout event '+planted[0],attributes:[{key:'db.password',value:{stringValue:planted[11]}}]}],links:[{traceId,spanId:'1'.repeat(16),attributes:[{key:'api_key',value:{stringValue:planted[12]}}]}]}]}]}]}
 const send=()=>fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(packet)})
 const accepted=await send();assert.equal(accepted.status,200)
 const id=accepted.headers.get('x-porthole-batch'),batch=(await sql(`SELECT * FROM porthole_ingest_batches WHERE id=${literal(id)}`))[0]
 const decoded=JSON.parse(Buffer.from(batch.wire_base64,'base64').toString())
 assert.equal(decoded.format,'porthole.sanitized-trace-envelope.v1')
 const queuedSpan=decoded.records[0].payload.record
 assert.equal(queuedSpan.events[0].timeUnixNano,String(at),'event clocks survive pre-write redaction')
 assert.equal(queuedSpan.links[0].spanId,'1'.repeat(16),'span links survive pre-write redaction')
 assert.equal(queuedSpan.links[0].attributes[0].value.stringValue,'[REDACTED]')
 for(const secret of [...planted,Buffer.from(planted[11]).toString('base64')])assert.ok(!JSON.stringify(decoded).includes(secret),'span queues mask sensitive nested AnyValue fields')
 assert.ok(JSON.stringify(decoded).includes('private-0000'),'approved exact custom exception survives on spans')
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const trace=await value(await fetch(origin+'/api/porthole/v1/traces/'+traceId,{headers:{cookie}}))
 assert.equal(trace.spans.length,1);assert.equal(trace.spans[0].spanId,spanId);assert.equal(trace.spans[0].startTimeNs,String(at),'structural trace identity and nanoseconds survive masking')
 const retained=await sql(`SELECT payload FROM porthole_telemetry_records WHERE batch_id=${literal(id)} UNION ALL SELECT payload FROM porthole_telemetry_archive WHERE batch_id=${literal(id)}`)
 assert.equal(retained.length,2)
 for(const secret of [...planted,Buffer.from(planted[11]).toString('base64')])assert.ok(!JSON.stringify(retained).includes(secret))
 assert.equal((await send()).headers.get('x-porthole-duplicate'),'true')
}
