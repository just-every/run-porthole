import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {verifyCollector,release} from '../../collectors/splunk/release.mjs'
import {freePort,privateProcessEnvironment,startCollector} from '../../collectors/splunk/process.mjs'
import {capturedRecords,comparable,requestCorrelation,signals} from '../../collectors/splunk/reconcile.mjs'

// The only substitute is the provider's OTLP network edge. Every telemetry
// envelope comes from the stock Node SDK and unchanged official collector.
async function sourceCapture(){
 const packets=[],attempts=new Map(),failures=[]
 const authorization='Bearer synthetic-porthole-4320'
 const server=createServer(async(request,response)=>{
  try{
   assert.equal(request.method,'POST');assert.ok(request.headers.authorization===authorization,'unexpected credential at old source edge')
   const signal=request.url?.match(/^\/v1\/(traces|metrics|logs)$/)?.[1]
   assert.ok(signal);assert.match(request.headers['content-type'],/^application\/json/)
   const parts=[];for await(const part of request)parts.push(part)
   const body=Buffer.concat(parts).toString('utf8'),key=signal+' '+body
   JSON.parse(body)
   const count=(attempts.get(key)??0)+1;attempts.set(key,count)
   if(count===1){response.writeHead(503,{'content-type':'application/json','retry-after':'0'});response.end('{}');return}
   if(count===2)packets.push({signal,body})
   response.writeHead(200,{'content-type':'application/json'});response.end('{}')
  }catch(error){failures.push(error);response.writeHead(400);response.end()}
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 return {packets,attempts,failures,authorization,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})}
}
async function emit(port){
 // The SDK's upstream and placeholder receiver credential remain identical
 // before and after repointing; it never receives either export credential.
 const {stdout}=await promisify(execFile)(process.execPath,['tests/porthole/polyglot/otlp.cjs'],{
  env:{...privateProcessEnvironment(),PORTHOLE_OTLP_PROTOCOL:'proto',PORTHOLE_OTLP_ENDPOINT:'http://127.0.0.1:'+port,PORTHOLE_OTLP_SECRET:'synthetic-porthole-4321'},timeout:30000,maxBuffer:128*1024
 })
 const result=JSON.parse(stdout.trim());assert.match(result.traceId,/^[a-f0-9]{32}$/)
 return result
}
export async function splunkCollectorJourney({origin,cookie,restartWorker,freshOwner,collectorBinary=process.env.PORTHOLE_SPLUNK_COLLECTOR_BIN}){
 const target=new URL(origin)
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname),'collector qualification uses a local Porthole installation')
 assert.ok(!target.username&&!target.password&&!target.search&&!target.hash&&target.pathname==='/','collector destination contains no credentials or path')
 const binary=await verifyCollector(collectorBinary)
 const [port,healthPort]=await Promise.all([freePort(),freePort()])
 const source=await sourceCapture()
 let running,credential,paused=false
 const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 const control=async value=>{assert.equal((await post('/api/porthole/v1/ingest/control',{paused:value})).status,200);paused=value}
 const scope={services:['synthetic-porthole-200'],environments:['synthetic-porthole-201'],teams:['synthetic-porthole-202'],signals,actions:['telemetry.write']}
 const read=async(signal,archive=false)=>{
  const params=new URLSearchParams({signal,service:scope.services[0],environment:scope.environments[0],team:scope.teams[0],limit:'200'})
  const response=await fetch(origin+'/api/porthole/v1/ingest/'+(archive?'archive':'records')+'?'+params,{headers:{cookie},signal:AbortSignal.timeout(15000)})
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.cursor,null)
  return result.records.filter(row=>row.source_id===credential.credential.id)
 }
 const status=async()=>{
  const response=await fetch(origin+'/api/porthole/v1/ingest/status',{headers:{cookie},signal:AbortSignal.timeout(15000)})
  assert.equal(response.status,200)
  return (await response.json()).sources.filter(row=>row.sourceId===credential.credential.id)
 }
 const total=(rows,key)=>rows.reduce((sum,row)=>sum+Number(row[key]??0),0)
 const resend=async()=>{
  for(const packet of source.packets){
   running.healthy()
   const response=await fetch('http://127.0.0.1:'+port+'/v1/'+packet.signal,{method:'POST',headers:{'content-type':'application/json'},body:packet.body,signal:AbortSignal.timeout(15000)})
   assert.equal(response.status,200,'stock collector forwards source request cohort')
  }
 }
 try{
  running=await startCollector({binary,port,healthPort,destination:source.origin,authorization:source.authorization})
  const original=await emit(port)
  assert.deepEqual(source.failures,[])
  assert.deepEqual(new Set(source.packets.map(packet=>packet.signal)),new Set(signals))
  assert.ok([...source.attempts.values()].every(count=>count>=2),'official exporter retried every first 503 without a harness retry')
  const expected=capturedRecords(source.packets),sourceCount=expected.length,sourceDeliveries=source.packets.length
  requestCorrelation(expected,original.traceId)
  for(const row of expected){assert.equal(row.service,scope.services[0]);assert.equal(row.environment,scope.environments[0]);assert.equal(row.team,scope.teams[0])}
  await running.stop();running=undefined
  cookie=await freshOwner()
  const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-4322',class:'ingest',scope})
  assert.equal(minted.status,201);credential=await minted.json()
  assert.notEqual('Bearer '+credential.secret,source.authorization)
  await control(true)
  // The config file, receiver, SDK and pipelines are unchanged. Only these
  // two supported exporter environment inputs change at the cutover.
  const destination={binary,port,healthPort,destination:origin,authorization:'Bearer '+credential.secret}
  running=await startCollector(destination)
  await resend()
  let counts=await status();assert.equal(total(counts,'accepted'),sourceCount);assert.equal(total(counts,'pending'),sourceCount)
  assert.equal(total(counts,'queryable'),0,'durable acceptance precedes indexing')
  await running.stop();running=undefined
  await restartWorker();cookie=await freshOwner()
  running=await startCollector(destination)
  await resend()
  counts=await status()
  assert.equal(total(counts,'accepted'),sourceCount,'collector and Worker restart preserve exact source cohort')
  assert.equal(total(counts,'pending'),sourceCount)
  assert.ok(total(counts,'duplicates')>=sourceDeliveries,'same source cohort is deduplicated after both restarts')
  await control(false)
  assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
  const retained=(await Promise.all(signals.map(signal=>read(signal)))).flat()
  assert.deepEqual(comparable(retained),comparable(expected),'exact source tags, values, timestamps, records and trace context survive supported collector repointing')
  assert.deepEqual(comparable((await Promise.all(signals.map(signal=>read(signal,true)))).flat()),comparable(expected),'archive retains the exact source cohort')
  requestCorrelation(retained,original.traceId)
  const fresh=await emit(port)
  assert.notEqual(fresh.traceId,original.traceId)
  assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
  const all=(await Promise.all(signals.map(signal=>read(signal)))).flat()
  const sourceRows=new Set(comparable(expected)),newRows=all.filter(row=>!sourceRows.has(comparable([row])[0]))
  requestCorrelation(newRows,fresh.traceId)
  for(const signal of signals)assert.equal(newRows.filter(row=>row.signal===signal).length,expected.filter(row=>row.signal===signal).length,'fresh real request preserves stock per-signal point counts')
  counts=await status()
  for(const key of ['accepted','queryable','archived'])assert.equal(total(counts,key),sourceCount*2,'both actual request cohorts reconcile in '+key)
  assert.equal(total(counts,'pending'),0)
  assert.ok(counts.every(row=>row.complete),'both source cohorts have complete durable native coverage')
  assert.equal(source.packets.length,sourceDeliveries,'repointed collector no longer exports to the source')
  assert.deepEqual(source.failures,[],'Porthole credential never reaches the old source edge')
  assert.equal((await post('/app/settings/credentials/revoke',{id:credential.credential.id})).status,200)
  for(const packet of source.packets){
   const response=await fetch('http://127.0.0.1:'+port+'/v1/'+packet.signal,{method:'POST',headers:{'content-type':'application/json'},body:packet.body,signal:AbortSignal.timeout(15000)})
   assert.equal(response.ok,false,'stock collector surfaces revoked downstream authority for '+packet.signal)
  }
  counts=await status();assert.equal(total(counts,'accepted'),sourceCount*2,'revocation refuses even previously accepted wire retries')
  assert.deepEqual(comparable((await Promise.all(signals.map(signal=>read(signal)))).flat()),comparable(all),'refused requests cannot alter retained telemetry')
  return {cookie,traceId:fresh.traceId,sourceTraceId:original.traceId,sourceId:credential.credential.id,accepted:sourceCount*2,collector:'Splunk OpenTelemetry Collector '+release}
 }finally{
  await running?.stop()
  await source.close()
  if(paused)await control(false)
  if(credential)await post('/app/settings/credentials/revoke',{id:credential.credential.id})
 }
}
