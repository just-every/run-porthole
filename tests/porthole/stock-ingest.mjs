import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { ingestScope,otlpLogBatch,otlpProtoBatch } from './ingest.mjs'
import { literal } from './fixture.mjs'

/** Qualification uses an unmodified, separately checksum-verified official
 * Grafana Alloy v1.10.2 binary, not a substitute implementation of its clients.
 * Sources: grafana/alloy v1.10.2 docs otelcol.exporter.otlphttp,
 * otelcol.exporter.prometheus, prometheus.remote_write, loki.source.api/loki.write.
 * No dependencies are fetched and no binary is installed by this journey. */
const port=async()=>{const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return value}
async function until(check,message,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(100)}assert.fail(message)}
function config({origin,otlpPort,lokiPort}) {
 return `logging {
 level = "info"
}
otelcol.receiver.otlp "synthetic_porthole_250" {
 http {
  endpoint = "127.0.0.1:${otlpPort}"
 }
 output {
  logs = [otelcol.exporter.otlphttp.synthetic_porthole_250.input]
  traces = [otelcol.exporter.otlphttp.synthetic_porthole_250.input]
  metrics = [otelcol.exporter.otlphttp.synthetic_porthole_250.input, otelcol.exporter.prometheus.synthetic_porthole_250.input]
 }
}
otelcol.exporter.otlphttp "synthetic_porthole_250" {
 client {
  endpoint = ${JSON.stringify(origin)}
  headers = { "Authorization" = "Bearer " + sys.env("PORTHOLE_STOCK_TOKEN") }
 }
 sending_queue {
  enabled = false
 }
}
otelcol.exporter.prometheus "synthetic_porthole_250" {
 forward_to = [prometheus.remote_write.synthetic_porthole_250.receiver]
 include_target_info = false
 include_scope_info = false
 include_scope_labels = false
 resource_to_telemetry_conversion = true
 add_metric_suffixes = false
}
prometheus.remote_write "synthetic_porthole_250" {
 endpoint {
  url = ${JSON.stringify(origin+'/api/v1/write')}
  bearer_token = sys.env("PORTHOLE_STOCK_TOKEN")
  queue_config {
   min_shards = 1
   max_shards = 1
   batch_send_deadline = "1s"
  }
 }
}
loki.source.api "synthetic_porthole_250" {
 http {
  listen_address = "127.0.0.1"
  listen_port = ${lokiPort}
 }
 use_incoming_timestamp = true
 forward_to = [loki.write.synthetic_porthole_250.receiver]
}
loki.write "synthetic_porthole_250" {
 endpoint {
  url = ${JSON.stringify(origin+'/loki/api/v1/push')}
  bearer_token = sys.env("PORTHOLE_STOCK_TOKEN")
  tenant_id = ${JSON.stringify(ingestScope.teams[0])}
 }
}
`
}
export async function stockIngestJourney({origin,cookie,sql,restartWorker,freshOwner,alloyBinary=process.env.PORTHOLE_ALLOY_BIN}) {
 assert.ok(alloyBinary,'stock qualification requires PORTHOLE_ALLOY_BIN pointing to a verified official Grafana Alloy binary')
 cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const minted=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-250',class:'ingest',scope:ingestScope})
 assert.equal(minted.status,201)
 const source=await minted.json()
 assert.equal((await post('/api/porthole/v1/ingest/control',{paused:true,maxPendingBytes:33554432})).status,200)
 const scratch=await mkdtemp(join(tmpdir(),'synthetic-porthole-250-'))
 let child,logs=''
 try {
  const [httpPort,otlpPort,lokiPort]=await Promise.all([port(),port(),port()])
  const path=join(scratch,'synthetic-porthole-250.alloy')
  await writeFile(path,config({origin,otlpPort,lokiPort}),{mode:0o600})
  child=spawn(alloyBinary,['run','--server.http.listen-addr=127.0.0.1:'+httpPort,'--storage.path='+join(scratch,'state'),path],{env:{...process.env,GOMAXPROCS:'2',PORTHOLE_STOCK_TOKEN:source.secret},stdio:['ignore','pipe','pipe']})
  let launchError
  child.on('error',error=>{launchError=error})
  const capture=data=>{logs=(logs+String(data)).slice(-12000)}
  child.stdout.on('data',capture);child.stderr.on('data',capture)
  await until(async()=>{
   if(launchError)throw launchError
   if(child.exitCode!==null)throw new Error('Stock Alloy exited: '+logs.split(source.secret).join('[redacted]'))
   return fetch(`http://127.0.0.1:${httpPort}/-/ready`).then(response=>response.ok).catch(()=>false)
  },'stock Alloy readiness')
  const time=BigInt(Date.now())*1000000n-1000000000n
  // Only the input into the stock collector is fixture-built. Every request
  // reaching Porthole is encoded and sent by unchanged stock exporter code.
  const logsResponse=await fetch(`http://127.0.0.1:${otlpPort}/v1/logs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(otlpLogBatch([time,time+1n],'synthetic-porthole-251'))})
  assert.equal(logsResponse.status,200)
  for(const signal of ['traces','metrics']){
   const response=await fetch(`http://127.0.0.1:${otlpPort}/v1/${signal}`,{method:'POST',headers:{'content-type':'application/x-protobuf'},body:otlpProtoBatch(signal,time+10n)})
   assert.equal(response.status,200,'stock collector input '+signal)
  }
  const loki={streams:[{stream:{service:ingestScope.services[0],environment:ingestScope.environments[0],team:ingestScope.teams[0]},values:[[String(time+20n),'synthetic-porthole-252'],[String(time+21n),'synthetic-porthole-253 日本語']]}]}
  assert.equal((await fetch(`http://127.0.0.1:${lokiPort}/loki/api/v1/push`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(loki)})).status,204)
  const sourceBatches=()=>sql(`SELECT * FROM porthole_ingest_batches WHERE source_id=${literal(source.credential.id)} ORDER BY sequence`)
  try {await until(async()=>{const rows=await sourceBatches();return rows.reduce((n,row)=>n+row.record_count,0)===7},'seven stock-emitted records durably acknowledged')}
  catch {
   const batches=await sourceBatches()
   const metrics=await (await fetch(`http://127.0.0.1:${httpPort}/metrics`)).text()
   const counters=metrics.split('\n').filter(line=>/^(?:otelcol_(?:receiver_accepted_metric_points|exporter_sent_metric_points|exporter_send_failed_metric_points)|prometheus_remote_storage_(?:samples_in_total|samples_total|samples_pending|failed_samples_total|dropped_samples_total))/.test(line)).map(line=>line.replace(/\{[^}]*\}/g,''))
   const diagnostic=logs.split(source.secret).join('[redacted]').replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]')
   throw Error('Stock collector did not reconcile: '+JSON.stringify(batches.map(row=>({protocol:row.protocol,signal:row.signal,count:row.record_count})))+'\n'+counters.join('\n')+'\n'+diagnostic)
  }
  let batches=await sourceBatches()
  assert.equal(batches.filter(row=>row.protocol==='otlp.http/v1.9.0').reduce((n,row)=>n+row.record_count,0),4)
  assert.equal(batches.filter(row=>row.protocol==='prometheus.WriteRequest/v1').reduce((n,row)=>n+row.record_count,0),1)
  assert.equal(batches.filter(row=>row.protocol==='loki.PushRequest/v3.5').reduce((n,row)=>n+row.record_count,0),2)
  assert.ok(batches.every(row=>row.state==='pending'),'durable ack precedes asynchronous indexing')
  await restartWorker()
  batches=await sourceBatches()
  for(const batch of batches){
   const wire=Buffer.from(batch.wire_base64,'base64'),otlp=batch.protocol.startsWith('otlp'),remote=batch.protocol.startsWith('prometheus')
   const path=otlp?'/v1/'+batch.signal:remote?'/api/v1/write':'/loki/api/v1/push'
   const headers={authorization:`Bearer ${source.secret}`,'content-type':'application/x-protobuf',...(otlp&&wire[0]===31&&wire[1]===139?{'content-encoding':'gzip'}:{}),...(remote?{'content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'}:{}),...(!otlp&&!remote?{'x-scope-orgid':ingestScope.teams[0]}:{})}
   const response=await fetch(origin+path,{method:'POST',headers,body:wire})
   assert.equal(response.status,otlp?200:204,'stock wire retry')
   assert.equal(response.headers.get('x-porthole-duplicate'),'true')
  }
  assert.equal((await sourceBatches()).reduce((n,row)=>n+row.record_count,0),7)
  assert.equal((await post('/api/porthole/v1/ingest/control',{paused:false})).status,200)
  assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
  const statusResponse=await fetch(origin+'/api/porthole/v1/ingest/status',{headers:{cookie}})
  assert.equal(statusResponse.status,200)
  const status=await statusResponse.json(),rows=status.sources.filter(row=>row.sourceId===source.credential.id)
  for(const key of ['accepted','queryable','archived'])assert.equal(rows.reduce((n,row)=>n+row[key],0),7,key+' reconciles to stock source counts')
  assert.equal(rows.reduce((n,row)=>n+row.pending,0),0)
  assert.ok(rows.every(row=>row.complete),'successful stock source coverage is complete')
  const retained=(await sql(`SELECT signal,payload,event_time_ns FROM porthole_telemetry_records WHERE source_id=${literal(source.credential.id)}`))
  assert.ok(retained.some(row=>JSON.parse(row.payload).record?.structuredMetadata!==undefined&&row.event_time_ns===String(time+21n).padStart(20,'0')),'stock Loki preserves original nanoseconds')
  assert.ok(retained.some(row=>row.signal==='metrics'&&JSON.parse(row.payload).protocol==='prometheus.WriteRequest'&&JSON.parse(row.payload).record.value===24.5),'stock remote-write numeric value is queryable')
  console.log('Porthole stock Alloy qualification passed: counted stock OTLP, Prometheus remote-write and Loki batches, durable paused acknowledgement/restart, exact-wire retry and seven archived/queryable records')
  return {cookie,sourceId:source.credential.id,accepted:7,queryable:7,archived:7,stock:'Grafana Alloy v1.10.2'}
 } finally {
  if(child?.pid&&child.exitCode===null&&!child.killed){
   const exited=once(child,'exit').catch(()=>{});child.kill('SIGTERM')
   const stopped=await Promise.race([exited.then(()=>true),delay(10000).then(()=>false)])
   if(!stopped){child.kill('SIGKILL');await exited}
  }
  await rm(scratch,{recursive:true,force:true})
 }
}
