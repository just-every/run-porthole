import assert from 'node:assert/strict'
import {gzipSync} from 'node:zlib'
import {ingestScope} from './ingest.mjs'

export const lokiScope={...ingestScope,services:['synthetic-porthole-18700'],signals:['logs']}
const root='/api/porthole/v1/ingest'
const v=n=>{n=BigInt(n);const b=[];while(n>127n){b.push(Number(n&127n)|128);n>>=7n}return Buffer.from([...b,Number(n)])}
const msg=(n,b)=>Buffer.concat([v(n*8+2),v(b.length),b])
const str=(n,s)=>msg(n,Buffer.from(s))
const uint=(n,x)=>Buffer.concat([v(n*8),v(x)])
const snappy=b=>{let n=b.length-1;const size=[];while(n){size.push(n&255);n>>>=8}return Buffer.concat([v(b.length),Buffer.from(b.length<61?[(b.length-1)*4]:[(59+size.length)*4,...size]),b])}
// Loki v3.5.0 pkg/logproto/logproto.proto: PushRequest, StreamAdapter,
// EntryAdapter and LabelAdapter. This is a schema edge, never a stock shipper.
export function lokiWire(streams){return snappy(Buffer.concat(streams.map(({stream,values})=>msg(1,Buffer.concat([
 str(1,'{'+Object.entries(stream).map(([k,value])=>k+'='+JSON.stringify(value)).join(',')+'}'),
 ...values.map(([at,line,metadata={}])=>msg(2,Buffer.concat([
  msg(1,Buffer.concat([uint(1,BigInt(at)/1000000000n),uint(2,BigInt(at)%1000000000n)])),str(2,line),
  ...Object.entries(metadata).map(([key,value])=>msg(3,Buffer.concat([str(1,key),...(value?[str(2,value)]:[])]))),
 ]))),
])))))}
export const streamLabels=extra=>({service:lokiScope.services[0],environment:lokiScope.environments[0],team:lokiScope.teams[0],...extra})
export async function readLokiPages({origin,cookie,service=lokiScope.services[0],archive=false}){
 const records=[];let cursor,snapshot
 do {
  const params=new URLSearchParams({signal:'logs',service,limit:'137',...(cursor?{cursor,snapshot:String(snapshot)}:{})})
  const response=await fetch(origin+root+(archive?'/archive':'/records')+'?'+params,{headers:{cookie}})
  assert.equal(response.status,200,await response.clone().text())
  const page=await response.json();snapshot??=page.snapshot;assert.equal(page.snapshot,snapshot)
  records.push(...page.records);cursor=page.cursor
 }while(cursor)
 return records
}
export const logProjection=row=>({at:String(BigInt(row.event_time_ns)),line:row.payload.record.body.stringValue,labels:row.payload.resource.attributes,metadata:row.payload.record.structuredMetadata})
export async function lokiSchemaJourney({origin,freshOwner,restartWorker}){
 let cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-18701',class:'ingest',scope:lokiScope});assert.equal(minted.status,201)
 const source=await minted.json(),now=BigInt(Date.now())*1000000n,at=now-1000000000n
 const send=(body,headers={})=>fetch(origin+'/loki/api/v1/push',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-scope-orgid':lokiScope.teams[0],...headers},body:Buffer.isBuffer(body)?body:JSON.stringify(body)})
 const entry=(time,line,extra={})=>({streams:[{stream:streamLabels(),values:[[String(time),line,extra]]}]})
 const packets=[entry(at,'synthetic-porthole-18702 日本語 Ελληνικά 😀',{empty:'',detail:'Δ 日本語'}),entry(at,'synthetic-porthole-18703'),entry(at-1n,'synthetic-porthole-18704'),entry(now-7140n*1000000000n,'synthetic-porthole-18705')]
 const wires=[JSON.stringify(packets[0]),gzipSync(JSON.stringify(packets[1])),lokiWire(packets[2].streams),lokiWire(packets[3].streams)]
 const formats=[{}, {'content-encoding':'gzip'}, {'content-type':'application/x-protobuf','content-encoding':'snappy'}, {'content-type':'application/x-protobuf'}]
 // One equal-nanosecond pair crosses wire encodings and separate envelopes.
 wires[0]=Buffer.from(wires[0]);packets[2].streams[0].values[0][2]={empty:''};wires[2]=lokiWire(packets[2].streams)
 for(let i=0;i<wires.length;i++){const r=await send(wires[i],formats[i]);assert.equal(r.status,204,await r.text());assert.equal(r.headers.get('x-porthole-accepted'),'1')}
 await restartWorker();cookie=await freshOwner()
 for(let i=wires.length-1;i>=0;i--){const r=await send(wires[i],formats[i]);assert.equal(r.status,204);assert.equal(r.headers.get('x-porthole-duplicate'),'true')}
 assert.equal((await post(root+'/drain',{})).status,200)
 const before=await readLokiPages({origin,cookie})
 const expected=packets.flatMap(p=>p.streams.flatMap(({stream,values})=>values.map(([at,line,metadata={}])=>({at,line,labels:stream,metadata}))))
 assert.deepEqual(before.map(logProjection).sort((a,b)=>a.line.localeCompare(b.line)),expected.sort((a,b)=>a.line.localeCompare(b.line)))
 const ties=before.filter(row=>BigInt(row.event_time_ns)===at);assert.equal(ties.length,2);assert.deepEqual(ties.map(row=>row.id),ties.map(row=>row.id).sort())
 assert.ok(before.some(row=>row.out_of_order===1),'earlier source batches remain explicitly reordered')
 assert.deepEqual((await readLokiPages({origin,cookie,archive:true})).map(logProjection),before.map(logProjection))
 for(const tenant of ['synthetic-porthole-18799',lokiScope.teams[0]+'|synthetic-porthole-18799',lokiScope.teams[0]+',synthetic-porthole-18799'])assert.equal((await send(entry(at+10n,'synthetic-porthole-18706'),{'x-scope-orgid':tenant})).status,403)
 const old={streams:[{stream:streamLabels(),values:[[String(now-7201n*1000000000n),'synthetic-porthole-18707'],[String(at),'synthetic-porthole-18708']]}]}
 assert.equal((await send(old)).status,400,'whole stale batch refuses both lines')
 assert.equal((await send(entry(BigInt(Date.now())*1000000n+601n*1000000000n,'synthetic-porthole-18709'))).status,400)
 const large=entry(at,'synthetic-porthole-18710');large.streams[0].stream.large='x'.repeat(4097)
 assert.equal((await send(large)).status,400)
 assert.equal((await send(Buffer.from('synthetic-porthole-18711'),{'content-encoding':'gzip'})).status,400)
 assert.equal((await send(Buffer.from([255]),{'content-type':'application/x-protobuf'})).status,400)
 assert.equal((await send(packets[0],{'content-encoding':'snappy'})).status,415)
 assert.equal((await post(root+'/control',{paused:true,maxPendingBytes:1})).status,200)
 const pressure=await send(entry(at+20n,'synthetic-porthole-18712'));assert.equal(pressure.status,429);assert.ok(Number(pressure.headers.get('retry-after'))>0)
 assert.equal((await post(root+'/control',{paused:false,maxPendingBytes:33554432})).status,200)
 assert.deepEqual((await readLokiPages({origin,cookie})).map(row=>row.id),before.map(row=>row.id),'all refused writes change no retained data')
 const status=await (await fetch(origin+root+'/status',{headers:{cookie}})).json(),rows=status.sources.filter(row=>row.sourceId===source.credential.id)
 assert.equal(rows.reduce((n,row)=>n+row.accepted,0),4)
 const reasons=rows.flatMap(row=>row.reasons)
 assert.ok(reasons.some(row=>row.reason==='loki_timestamp_older_than_two_hours'&&row.count===2),JSON.stringify(reasons))
 assert.ok(reasons.some(row=>row.reason==='queue_pressure'&&row.count===1))
 assert.ok(reasons.some(row=>row.reason==='malformed_payload'&&row.unknownBatches>0),'malformed compression is an explicitly unknown line count')
 assert.equal((await post('/app/settings/credentials/revoke',{id:source.credential.id})).status,200)
 assert.equal((await send(wires[0],formats[0])).status,401,'next request cannot replay a revoked source')
 assert.deepEqual((await readLokiPages({origin,cookie})).map(row=>row.id),before.map(row=>row.id))
 console.log('PROBE PORT-087 schema: JSON, gzip JSON and Snappy protobuf -> exact Unicode, empty metadata, ns ties, delayed input, reordered retries, refusal accounting and next-request revocation')
}
