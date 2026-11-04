import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {collect,deliver,planDigest} from '../../collectors/database/collector.mjs'
import {fingerprint,structuralPlan} from '../../src/porthole/database/sql.mjs'
import {databaseEstate} from './database/estate.mjs'
import {form} from './fixture.mjs'
import {healthBrowser} from './health.mjs'
const api='/api/porthole/v1/database',marker='synthetic-porthole-16005-sensitive-literal',pause=ms=>new Promise(r=>setTimeout(r,ms))

async function stock(estate,call,source,run){
 const packets=[],events=[],waiters=[]
 const bridge=createServer(async(req,res)=>{
  try{const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts);packets.push(body)
   const response=await call('/v1/traces',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/x-protobuf'},body})
   res.writeHead(response.status,{'content-type':'application/x-protobuf'});res.end(Buffer.from(await response.arrayBuffer()))
  }catch{res.writeHead(503);res.end()}
 })
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve))
 const cfg=Object.fromEntries(['postgresql','mysql'].map(engine=>[engine,{host:'127.0.0.1',port:estate.ports[engine],database:'porthole',...estate.workload}]))
 cfg.marker=marker
 const child=spawn(process.execPath,['tests/porthole/database/stock.cjs'],{env:{...process.env,PORTHOLE_DATABASE_WORKLOAD:JSON.stringify(cfg),OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:'+bridge.address().port,OTEL_SERVICE_NAME:'database-checkout',OTEL_RESOURCE_ATTRIBUTES:'deployment.environment.name=production,team.name=commerce',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',OTEL_TRACES_SAMPLER:'always_on'},stdio:['pipe','pipe','pipe']})
 let buffer='',errors=''
 child.stderr.on('data',part=>errors+=part)
 child.stdout.on('data',part=>{buffer+=part;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{events.push(JSON.parse(line));for(const notify of waiters)notify()}catch{}}})
 const event=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('stock_database_event_timeout_'+type+' '+errors.slice(-1500))),60000);const check=()=>{const found=events.find(e=>e.event===type);if(found){clearTimeout(timer);resolve(found)}};waiters.push(check);check()})
 try{
  const ready=await event('ready')
  const receipts=await run({origin:ready.origin,child,event,events})
  child.stdin.write('stop\n')
  const exit=await new Promise(resolve=>{if(child.exitCode!==null)resolve(child.exitCode);else child.once('exit',resolve)})
  assert.equal(exit,0,errors.slice(-2000));assert.ok(packets.length>0,'actual stock exporter emitted database spans');assert.ok(!errors.includes(marker),'value-free producer diagnostics')
  return {receipts,packets,events}
 }finally{
  if(child.exitCode===null){child.stdin.write('stop\n');await Promise.race([new Promise(r=>child.once('exit',r)),pause(5000)]);if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}}
  await new Promise(resolve=>bridge.close(resolve))
 }
}
function nativeCompare(capture,native,engine){
 const expected=native.find(r=>fingerprint(r.query)===fingerprint('SELECT count(*) FROM porthole_orders WHERE customer = ?'))
 assert.ok(expected,'native independently queried expensive fingerprint exists')
 const actual=capture.queries.find(q=>q.queryId===String(expected.id).replace('-','n'))
 assert.ok(actual,JSON.stringify(capture));assert.equal(actual.fingerprint,fingerprint(expected.query));assert.equal(actual.calls,Number(expected.calls));assert.equal(actual.rows,Number(expected.rows??expected.rows_sent))
 assert.ok(Math.abs(actual.totalMs-Number(expected.total_ms))<0.00001);assert.ok(Math.abs(actual.meanMs-Number(expected.mean_ms))<0.00001)
 assert.ok(actual.plan.some(p=>p.operator===(engine==='postgresql'?'Seq Scan':'ALL')),'real non-executing missing-index plan')
 return actual
}
export async function databaseJourney({origin,freshOwner,restartWorker,sql,signIn,withEmptyDestination,withPinnedClock}){
 let cookie=await freshOwner()
 const call=(path,options={})=>fetch(origin+path,options),post=async(path,data,status=200,acting=cookie)=>{const response=await call(path,form(origin,acting,data));assert.equal(response.status,status,await response.clone().text());return response.json()},read=async(path=api,acting=cookie)=>{const r=await call(path,{headers:{cookie:acting}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const scope={services:['database-checkout'],environments:['production'],teams:['commerce']},source=await post('/app/settings/credentials/mint',{name:'Local database diagnostics',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}},201)
 const estate=await databaseEstate(),captures=[],configs={}
 const sourceReview=(engine,revision=0,enabled=true,credential=source)=>({id:'local-'+engine,revision,credentialId:credential.credential.id,engine,service:scope.services[0],environment:'production',team:'commerce',plans:estate.config(engine).plans,enabled,confirm:'review-read-only-database'})
 try{
  await healthBrowser({origin,cookie,path:'/app/database',name:'database-empty',contains:'No database captures'})
  for(const engine of ['postgresql','mysql']){
   configs[engine]={...estate.config(engine),id:'local-'+engine,revision:1,origin,secret:source.secret}
   const raw=await collect(configs[engine]);assert.equal((await call(api+'/captures',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({id:configs[engine].id,revision:1,planDigest:planDigest(configs[engine].plans),capture:raw})})).status,403,'unreviewed capture refused')
   const review=await post(api+'/sources',sourceReview(engine),201);assert.equal(review.planDigest,planDigest(configs[engine].plans))
  }
  await post('/api/porthole/v1/ingest/control',{paused:true})
  const receipts=await stock(estate,call,source,async({origin:producer,child,events})=>{
   const receipts=[]
   for(const engine of ['postgresql','mysql']){
    const slow=await (await fetch(producer+'/'+engine+'/slow')).json();assert.equal(slow.calls,6);receipts.push(slow)
    assert.equal((await fetch(producer+'/'+engine+'/error')).status,500,'actual driver error is emitted through stock tracing')
    const blocked=fetch(producer+'/'+engine+'/blocked')
    let wait,nativeWaits
    for(let i=0;i<80;i++){const native=engine==='postgresql'?(await estate.admins.postgresql.query("SELECT a.pid::text AS waiting,b::text AS blocking FROM pg_stat_activity a CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) b WHERE a.usename='porthole_work'")).rows:(await estate.admins.mysql.query('SELECT t.PROCESSLIST_ID AS waiting,b.PROCESSLIST_ID AS blocking FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID'))[0];if(native.length>=2){nativeWaits=native;const emitted=events.find(e=>e.event==='blocking'&&e.engine===engine);wait=native.find(w=>String(w.waiting)===emitted?.waiting);if(wait)break}await pause(50)}
    assert.ok(wait,'real blocked transaction observed independently: '+engine+' events='+JSON.stringify(events))
    assert.equal(await estate.deniedMutation(engine),true,'the monitoring role cannot mutate application data even outside the collector transaction')
    const before=await estate.state(engine),first=await deliver(configs[engine],(url,opts)=>call(new URL(url).pathname,opts))
    assert.equal(first.capture.coverage.statistics,'collected',JSON.stringify(first.capture));assert.equal(first.capture.coverage.waits,'collected');assert.equal(first.capture.coverage.plans,'collected',JSON.stringify(first.capture))
    const actual=nativeCompare(first.capture,await estate.native(engine),engine)
    assert.ok(actual.calls>=6)
    const blocking=first.capture.waits.find(w=>w.waiting===String(wait.waiting)&&w.blocking===String(wait.blocking));assert.ok(blocking,JSON.stringify(first.capture.waits));assert.ok(blocking.traceId&&blocking.spanId)
    for(const edge of nativeWaits)assert.ok(first.capture.waits.some(w=>w.waiting===String(edge.waiting)&&w.blocking===String(edge.blocking)),'every native edge in the real three-session blocking chain is retained')
    const nativePlan=engine==='postgresql'?(await estate.admins.postgresql.query("EXPLAIN (FORMAT JSON) SELECT count(*) FROM porthole_orders WHERE customer = $1",[marker])).rows[0]['QUERY PLAN']:JSON.parse((await estate.admins.mysql.execute('EXPLAIN FORMAT=JSON SELECT count(*) FROM porthole_orders WHERE customer = ?',[marker]))[0][0].EXPLAIN)
    assert.deepEqual(actual.plan,structuralPlan(nativePlan,engine),'structural plan equals independent engine explain')
    assert.deepEqual(await estate.state(engine),before,'read-only diagnostics changed no application rows')
    assert.ok(!JSON.stringify(first).includes(marker),'collector removes literals before transmission')
    captures.push(first.capture)
    const repeated=await call(api+'/captures',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({id:configs[engine].id,revision:1,planDigest:planDigest(configs[engine].plans),capture:first.capture})})
    assert.equal(repeated.status,201);assert.equal((await repeated.json()).duplicate,true)
    child.stdin.write('release\n');assert.equal((await blocked).status,200)
   }
   return receipts
  })
  let pending=await sql('SELECT state,records,wire_base64 FROM porthole_ingest_batches')
  assert.ok(pending.some(r=>r.state==='pending'));assert.ok(!JSON.stringify(pending).includes(marker));for(const row of pending)assert.ok(!Buffer.from(row.wire_base64,'base64').includes(Buffer.from(marker)),'pending stored wire contains no planted SQL literal')
  await restartWorker();cookie=await freshOwner();await post('/api/porthole/v1/ingest/control',{paused:false});await post('/api/porthole/v1/ingest/drain',{})
  let view=await read();assert.equal(view.captures.length,2)
  for(const c of view.captures){assert.ok(c.queries.some(q=>q.plan.length));assert.ok(c.callers.length>=6,JSON.stringify(c));const receipt=receipts.receipts.find(r=>r.engine===c.engine);assert.ok(c.callers.some(r=>r.traceId===receipt.traceId&&r.endpoint==='/'+c.engine+'/slow'),'native caller pivot identifies the actual request route');const trace=await read('/api/porthole/v1/traces/'+receipt.traceId);assert.ok(trace.spans.some(s=>s.instrumentation.name==='@opentelemetry/instrumentation-'+(c.engine==='mysql'?'mysql2':'pg')));assert.ok(!JSON.stringify(trace).includes(marker));assert.ok(c.waits.some(w=>w.traceId))}
  await healthBrowser({origin,cookie,path:'/app/database',name:'database-diagnostics',contains:['Database','Seq Scan','ALL','Calling trace','Endpoint']})
  await healthBrowser({origin,cookie,path:'/app/settings/database',name:'database-settings',contains:'Reviewed sources'})
  const first=await read(api+'?limit=1');assert.equal(first.captures.length,1);assert.ok(first.cursor);assert.equal(first.complete,false)
  const second=await read(api+'?limit=1&snapshot='+first.snapshot+'&cursor='+encodeURIComponent(first.cursor));assert.equal(second.captures.length,1);assert.notEqual(first.captures[0].id,second.captures[0].id);assert.equal(second.cursor,null)
  assert.equal((await call(api+'?cursor=bad',{headers:{cookie}})).status,400)
  await withPinnedClock(Date.now()+61000,async()=>{assert.ok((await read()).captures.every(c=>c.collection==='stale'))})
  const {databaseAnalyticalJourney}=await import('./analytics.mjs')
  await databaseAnalyticalJourney({captures,packets:receipts.packets,marker,plans:configs.postgresql.plans})
  for(const engine of ['postgresql','mysql']){
   const next=await estate.rotate(engine),denied=await deliver(configs[engine],(url,opts)=>call(new URL(url).pathname,opts));assert.equal(denied.capture.coverage.statistics,'privilege_denied','rotated database password explicitly denies capture')
   configs[engine].connection.password=next;await estate.restrict(engine)
   const limited=await deliver(configs[engine],(url,opts)=>call(new URL(url).pathname,opts));assert.equal(limited.capture.coverage.statistics,'privilege_denied');assert.equal(limited.capture.coverage.plans,'privilege_denied')
   assert.equal((await post(api+'/sources',sourceReview(engine,1,false),201)).enabled,false)
   assert.equal((await call(api+'/captures',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({id:configs[engine].id,revision:1,planDigest:planDigest(configs[engine].plans),capture:captures.find(c=>c.engine===engine)})})).status,403,'stopped collection refuses replay before persistence')
  }
  await post('/api/porthole/v1/ingest/drain',{})
  const limitedView=await read();assert.ok(limitedView.captures.some(c=>c.coverage.statistics==='privilege_denied'));assert.ok(limitedView.captures.some(c=>c.collection==='stopped'))
  const before=await sql('SELECT * FROM porthole_database_sources ORDER BY id')
  await post(api+'/sources',sourceReview('postgresql',1),409);assert.deepEqual(await sql('SELECT * FROM porthole_database_sources ORDER BY id'),before)
  const deniedReader=await post('/app/settings/credentials/mint',{name:'No database administration',class:'read',scope:{...scope,signals:['logs'],actions:['telemetry.read']}},201)
  assert.equal((await call(api+'/sources',{...form(origin,cookie,sourceReview('postgresql',2)),headers:{...form(origin,cookie,{}).headers,authorization:'Bearer '+deniedReader.secret}})).status,403,'bearer takes precedence over owner cookie')
  const address=n=>['synthetic-porthole-'+n,'example.com'].join(String.fromCharCode(64))
  const invited=await post('/app/settings/members/invite',{email:address(16010),displayName:'Database scoped reader',role:'read-only analyst',scope},202)
  const scoped=await signIn(address(16010));assert.ok((await read(api,scoped)).captures.length>0)
  assert.equal((await call(api+'/sources',form(origin,scoped,sourceReview('postgresql',2)))).status,403,'non-owner cannot review collection')
  cookie=await freshOwner()
  const members=await sql("SELECT operator_id,revision FROM porthole_members WHERE operator_id=(SELECT id FROM oa_operators WHERE email='"+address(16010)+"')")
  await post('/app/settings/members/change',{operatorId:members[0].operator_id,revision:members[0].revision,role:'read-only analyst',scope:{...scope,services:['foreign-database']}},200)
  assert.equal((await call(api,{headers:{cookie:scoped}})).status,401,'next-request scope revocation invalidates the prior native session')
  const narrowed=await signIn(address(16010));assert.equal((await read(api,narrowed)).captures.length,0,'current narrowed scope hides all prior database evidence')
  assert.equal((await call(api+'?service=database-checkout',{headers:{cookie:narrowed}})).status,403)
  assert.deepEqual(await sql('SELECT * FROM porthole_database_sources ORDER BY id'),before,'denied reviews and membership changes leave collection sources unchanged')
  await post('/app/settings/members/remove',{operatorId:members[0].operator_id})
  await post('/api/porthole/v1/actors/erase',{actorRef:members[0].operator_id,confirm:'erase'})
  assert.equal((await call(api,{headers:{cookie:narrowed}})).status,401,'erased actors cannot reuse a native database session')
  const {databaseArchiveJourney}=await import('./archive.mjs')
  cookie=await freshOwner();await databaseArchiveJourney({origin,cookie,withEmptyDestination,marker,expected:limitedView.captures})
  cookie=await freshOwner()
  const erasure='/api/porthole/v1/subject-erasure',selection=await post(erasure,{identifier:'porthole_orders'})
  assert.ok(selection.batches.length>=2,'the real captures appear in the current owner erasure inventory')
  const prior=await sql('SELECT records FROM porthole_ingest_batches ORDER BY id')
  await post(erasure+'/apply',{identifier:'porthole_orders',digest:selection.digest,confirm:'wrong'},409)
  assert.deepEqual(await sql('SELECT records FROM porthole_ingest_batches ORDER BY id'),prior,'unconfirmed erasure leaves database custody unchanged')
  await post(erasure+'/apply',{identifier:'porthole_orders',digest:selection.digest,confirm:'erase-exact-batches'})
  assert.ok((await read()).captures.every(c=>c.queries.length===0),'erased query captures are absent through Database')
  await post(api+'/sources',sourceReview('postgresql',2,true),201)
  const replay={id:configs.postgresql.id,revision:3,planDigest:planDigest(configs.postgresql.plans),capture:captures.find(c=>c.engine==='postgresql')}
  const deniedReplay=await call(api+'/captures',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(replay)})
  assert.equal(deniedReplay.status,409);assert.equal((await deniedReplay.json()).error,'erased_batch_refused','a later review revision cannot resurrect an erased capture')
  await restartWorker();cookie=await freshOwner();assert.ok((await read()).captures.every(c=>c.queries.length===0))
  await post('/app/settings/credentials/revoke',{id:source.credential.id})
  const refused=await call(api+'/captures',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:'{}'});assert.equal(refused.status,401)
  const {nativeDatabaseBackupJourney}=await import('./archive.mjs')
  await nativeDatabaseBackupJourney({captures,packets:receipts.packets,marker,plans:configs.postgresql.plans})
  const audit=await read('/api/v1/audit?limit=100');assert.ok(audit.records.some(r=>r.entry.action==='database.review'))
  assert.ok(!JSON.stringify(await sql('SELECT records,wire_base64 FROM porthole_ingest_batches')).includes(marker))
  console.log('PROBE PORT-016 local PostgreSQL and MySQL: real missing-index SELECTs and blocked requests -> native statistics, plans, blockers and stock caller traces reconciled; role rotation, restriction, stop, replay, archive and restart passed')
 }finally{await estate.dispose()}
}
