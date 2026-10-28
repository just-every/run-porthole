import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

const intake='/api/v0.2/stats',readRoot='/api/porthole/v1/agent-stats',control='/api/porthole/v1/ingest'
const scope={services:['synthetic-porthole-10101','synthetic-porthole-10102'],environments:['synthetic-porthole-10103'],teams:['synthetic-porthole-10104'],signals:['metrics','traces']}
const [service,foreignService]=scope.services
const double=(field,value)=>{const bytes=Buffer.alloc(9);bytes[0]=(field<<3)|1;bytes.writeDoubleLE(value,1);return bytes}
const varint=value=>{let n=BigInt(value);const bytes=[];while(n>127n){bytes.push(Number(n&127n)|128);n>>=7n}bytes.push(Number(n));return Buffer.from(bytes)}
const message=(field,value)=>Buffer.concat([varint((field<<3)|2),varint(value.length),value])
// Synthetic, valid official DDSketch protobuf: logarithmic mapping and a single
// contiguous positive bin. The receiver preserves bytes, without inventing quantiles.
// https://github.com/DataDog/sketches-go/blob/master/ddsketch/pb/ddsketch.proto
const sketch=count=>Buffer.concat([
 message(1,double(1,1.02)),message(2,Buffer.concat([message(2,double(0,count).subarray(1)),varint(24),varint(2*Math.ceil(Math.log(6000000)/Math.log(1.02)))])),
]).toString('base64')
function statsPayload(start) {
 return {agentHostname:'synthetic-porthole-10105',agentEnv:scope.environments[0],agentVersion:'7.70.0',clientComputed:false,splitPayload:false,stats:[{
  hostname:'synthetic-porthole-10106',env:scope.environments[0],version:'synthetic-porthole-10107',runtimeID:'synthetic-porthole-10108',sequence:'1',service,
  stats:[{start:String(start),duration:'10000000000',stats:[
   {service,name:'http.request',resource:'GET /checkout',HTTP_status_code:200,HTTP_method:'GET',HTTP_endpoint:'/checkout',type:'web',hits:'1000',errors:'17',duration:'6000000000',topLevelHits:'1000',okSummary:sketch(983),errorSummary:sketch(17),is_trace_root:1},
   {service,name:'http.request',resource:'GET /precise',HTTP_status_code:200,type:'web',hits:'2',errors:'0',duration:'9007199254740993',topLevelHits:'2'},
   {service:foreignService,name:'http.request',resource:'synthetic-porthole-10109',HTTP_status_code:500,type:'web',hits:'200',errors:'200',duration:'1200000000'},
  ]}],
 }]}
}
/** Official-schema synthetic input exercises actual public Porthole routes.
 * It is not a live Datadog comparison or stock Agent transport qualification. */
export async function agentStatsJourney({origin,freshOwner,restartWorker}) {
 let cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const mint=async(kind,extra={})=>value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-10110',class:kind,scope:{...scope,actions:[kind==='ingest'?'telemetry.write':'telemetry.read']},requestsPerMinute:1000,...extra}),201)
 const source=await mint('ingest'),reader=await mint('read',{scope:{...scope,services:[service],signals:['metrics'],actions:['telemetry.read']}})
 const body=statsPayload(BigInt(Date.now())*1000000n-1000000000n)
 const send=(data=body,id='synthetic-porthole-10111',extra={})=>fetch(origin+intake,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-team':scope.teams[0],'x-porthole-batch-id':id,...extra.headers},body:extra.gzip?gzipSync(JSON.stringify(data)):JSON.stringify(data)})
 const query=(extra='',secret=reader.secret)=>fetch(origin+readRoot+'?service='+service+extra,{headers:{authorization:'Bearer '+secret}})
 const all=async()=>{
  const stats=[];let cursor=''
  do {const page=await value(await query('&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):'')));stats.push(...page.stats);cursor=page.cursor??''}while(cursor)
  return stats
 }
 assert.equal((await fetch(origin+intake,{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,401,'authenticate before parsing Agent stats')
 assert.equal((await fetch(origin+readRoot)).status,401,'Agent stats are private')
 assert.equal((await fetch(origin+'/api/v9.9/stats',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(body)})).status,415,'future Agent stats versions refuse explicitly')
 const accepted=await send();assert.equal(accepted.status,204,await accepted.clone().text())
 assert.equal((await send()).headers.get('x-porthole-duplicate'),'true','exact retry has one durable envelope')
 await value(await post(control+'/drain',{}))
 const rows=await all();assert.equal(rows.length,2,'scoped pagination covers both permitted endpoint deltas')
 const checkout=rows.find(row=>row.group.resource==='GET /checkout'),precise=rows.find(row=>row.group.resource==='GET /precise')
 assert.equal(checkout.group.hits,'1000');assert.equal(checkout.group.errors,'17');assert.equal(checkout.group.duration,'6000000000')
 assert.equal(precise.group.duration,'9007199254740993','duration retains exact uint64 precision')
 assert.equal(checkout.provenance.latencySketch.ok,body.stats[0].stats[0].stats[0].okSummary)
 assert.equal(checkout.provenance.latencySketch.error,body.stats[0].stats[0].stats[0].errorSummary)
 assert.equal(checkout.provenance.latencySketch.quantilesAvailable,false)
 assert.ok(rows.every(row=>row.service===service&&row.team===scope.teams[0]&&row.provenance.independentlyVerified===false&&row.provenance.ordinaryTraceSamplingApplied===false))
 assert.ok(!JSON.stringify(rows).includes('synthetic-porthole-10109'),'foreign group content does not cross the read credential scope')
 assert.equal((await fetch(origin+readRoot+'?service='+foreignService,{headers:{authorization:'Bearer '+reader.secret}})).status,403,'foreign service cannot override scoped reads')
 const denied=await mint('read',{scope:{...scope,signals:['traces'],actions:['telemetry.read']}})
 assert.equal((await query('',denied.secret)).status,403,'trace read permission cannot read Agent metrics')
 // Ten retained spans are intentionally separate from 1,002 full-traffic hits.
 const attrs=[['service.name',service],['deployment.environment.name',scope.environments[0]],['team.name',scope.teams[0]]].map(([key,stringValue])=>({key,value:{stringValue}}))
 const traces={resourceSpans:[{resource:{attributes:attrs},scopeSpans:[{spans:Array.from({length:10},(_,i)=>({traceId:(i+1).toString(16).padStart(32,'0'),spanId:(i+1).toString(16).padStart(16,'0'),name:'http.request',startTimeUnixNano:body.stats[0].stats[0].start,endTimeUnixNano:String(BigInt(body.stats[0].stats[0].start)+6000000n)}))}]}]}
 const sampled=await fetch(origin+'/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(traces)})
 assert.equal(sampled.status,200);await value(await post(control+'/drain',{}))
 assert.deepEqual(await all(),rows,'retaining sampled trace traffic cannot dilute or supplement Agent stats')
 await restartWorker();cookie=await freshOwner()
 assert.equal((await send()).headers.get('x-porthole-duplicate'),'true','retry after restart stays deduplicated')
 assert.deepEqual(await all(),rows,'RED deltas and latency sketches survive restart')
 const changed=structuredClone(body);changed.stats[0].stats[0].stats[0].hits='1001'
 assert.equal((await send(changed)).status,409,'changed bytes cannot reuse a batch identity')
 const unknown=structuredClone(body);unknown.schemaVersion=99
 assert.equal((await send(unknown,'synthetic-porthole-10112')).status,415)
 const unsafe=structuredClone(body);unsafe.stats[0].stats[0].stats[0].duration=9007199254740992
 assert.equal((await send(unsafe,'synthetic-porthole-10113')).status,400,'unsafe JSON integers refuse instead of rounding')
 const foreign=structuredClone(body);foreign.stats[0].stats[0].stats[0].service='synthetic-porthole-10114'
 assert.equal((await send(foreign,'synthetic-porthole-10115')).status,403,'one unauthorized group refuses the atomic payload')
 assert.deepEqual(await all(),rows,'refused schemas, identities and scopes change no retained stats')
 // A separate homogeneous batch proves the inherited reviewed erasure path.
 const erased=structuredClone(body),identifier='synthetic-porthole-10116'
 erased.stats[0].stats[0].stats=[{service,name:'http.request',resource:identifier,hits:'1',errors:'1',duration:'6000000'}]
 const compressed=await send(erased,'synthetic-porthole-10117',{gzip:true,headers:{'content-encoding':'gzip'}})
 assert.equal(compressed.status,204);await value(await post(control+'/drain',{}))
 assert.ok((await all()).some(row=>row.group.resource===identifier))
 const preview=await value(await post('/api/porthole/v1/subject-erasure',{identifier}))
 assert.equal(preview.canApply,true);assert.equal(preview.records,1)
 await value(await post('/api/porthole/v1/subject-erasure/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'}))
 assert.deepEqual(await all(),rows,'reviewed erasure withdraws the selected Agent metric')
 assert.equal((await send(erased,'synthetic-porthole-10117',{gzip:true,headers:{'content-encoding':'gzip'}})).status,409,'captured erased bytes cannot resurrect Agent stats')
 await value(await post('/app/settings/credentials/revoke',{id:source.credential.id}))
 assert.equal((await send()).status,401,'revoked ingest authority cannot retry Agent stats')
 await value(await post('/app/settings/credentials/revoke',{id:reader.credential.id}))
 assert.equal((await query()).status,401,'revoked read authority cannot disclose Agent stats')
 console.log('agentStatsJourney passed: official-schema RED deltas, exact integers, separate sketches, scoped pagination, sampled trace independence, retry and restart, atomic refusals, reviewed erasure and revocation')
}
