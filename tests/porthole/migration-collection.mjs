import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

// New local requests use a newly minted Porthole identity. Source credentials
// and prior investigation content are never used as collection authority.
export async function collectAfterMigration({origin,cookie,vendor}){
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const scope={services:['synthetic-porthole-200'],environments:['synthetic-porthole-201'],teams:['synthetic-porthole-202'],signals:['traces','metrics','logs'],actions:['telemetry.write']}
 const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-871-'+vendor,class:'ingest',scope})
 assert.equal(minted.status,201,await minted.clone().text())
 const credential=await minted.json()
 const emitted=await promisify(execFile)(process.execPath,['tests/porthole/polyglot/otlp.cjs'],{env:{...process.env,PORTHOLE_OTLP_PROTOCOL:'proto',PORTHOLE_OTLP_ENDPOINT:origin,PORTHOLE_OTLP_SECRET:credential.secret},timeout:30000})
 const actual=JSON.parse(emitted.stdout.trim())
 assert.match(actual.traceId,/^[a-f0-9]{32}$/)
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const read=async signal=>{const params=new URLSearchParams({signal,service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],...(signal==='metrics'?{metric:'synthetic_porthole_1623'}:{}),...(signal==='traces'?{trace:actual.traceId}:{})});const result=await fetch(origin+'/api/porthole/v1/ingest/records?'+params,{headers:{cookie}});assert.equal(result.status,200);return (await result.json()).records.filter(row=>row.source_id===credential.credential.id)}
 const [spans,logs,metrics]=await Promise.all([read('traces'),read('logs'),read('metrics')])
 assert.ok(spans.some(row=>row.trace_id===actual.traceId&&row.payload.record.name==='synthetic-porthole-1622'))
 assert.ok(logs.some(row=>row.trace_id===actual.traceId&&row.payload.record.body.stringValue==='synthetic-porthole-1624'))
 assert.ok(metrics.some(row=>row.payload.metric?.name==='synthetic_porthole_1623'&&(row.payload.record.asInt==='1'||row.payload.record.asDouble===1)))
 return actual.traceId
}
