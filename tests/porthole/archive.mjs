import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {verifyDirectory} from '../../scripts/porthole/archive.mjs'
import {browserProof} from './audit.mjs'
import {literal} from './fixture.mjs'
const execute=promisify(execFile),api='/api/porthole/v1/archive',hash=value=>createHash('sha256').update(value).digest('hex')
const post=(origin,cookie,path,data)=>fetch(origin+path,{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
const get=(origin,cookie,path)=>fetch(origin+path,{headers:{cookie}})
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
async function savedExport(origin,cookie,start){
 const job=await value(start,201),chunks=[]
 for(let index=0;index<job.totalChunks;index++)chunks.push(await value(await get(origin,cookie,`${api}/exports/${job.id}/chunks/${index}`)))
 const manifest=await value(await get(origin,cookie,`${api}/exports/${job.id}/manifest`))
 return {job,chunks,manifest,rows:chunks.flatMap(chunk=>chunk.rows)}
}
/** Real Worker/D1 journey. The harness switches to a separately migrated D1
 * destination; synthetic bootstrapping uses Base's real confirmation doors. */
export async function archiveJourney({origin,cookie,sql,restartWorker,freshOwner,withEmptyDestination}){
 cookie=await freshOwner()
 for(const path of ['/app/settings/archive',api+'/exports']){
  const response=path.endsWith('exports')?await post(origin,'',path,{}):await get(origin,'',path)
  assert.equal(response.status,401)
 }
 const forged=await fetch(origin+api+'/exports',{method:'POST',headers:{origin:'https://synthetic-porthole.invalid',cookie,'content-type':'application/json'},body:'{}'})
 assert.equal(forged.status,403)
 const key=await value(await post(origin,cookie,'/app/settings/credentials/mint',{name:'synthetic-archive-read',class:'read',scope:{services:['checkout'],environments:['production'],teams:['commerce'],signals:['logs'],actions:['telemetry.read']}}),201)
 for(const method of ['GET','POST']){
  const response=await fetch(origin+api+(method==='POST'?'/exports':'/audit'),{method,headers:{origin,authorization:`Bearer ${key.secret}`,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})})
  assert.equal(response.status,403)
 }
 const definitions=[]
 for(const [kind,team]of [['monitor','commerce'],['repair','fulfilment']]){
  const body=kind==='monitor'?{signal:'logs',operator:'above',threshold:3,windowSeconds:60}:{steps:[{kind:'rollback',target:'synthetic-checkout',revision:'synthetic-revision-1'}],expiresAt:Date.now()+86400000}
  const definition=await value(await post(origin,cookie,'/api/porthole/v1/objects',{kind,name:`synthetic-archive-${kind}`,scope:{services:['checkout'],environments:['production'],teams:[team]},body}),201)
  definitions.push(definition)
  if(kind==='repair')assert.equal((await post(origin,cookie,'/api/porthole/v1/approvals',{id:definition.id,revision:definition.revision,confirm:'approve'})).status,200)
 }
 // Archive both a confirmed own-address grant and its unconfirmed replacement.
 const ownerSession=await value(await get(origin,cookie,'/auth/session'))
 for(const recipient of [ownerSession.operator.email,'synthetic-porthole-960@example.com']) {
  const health=await value(await get(origin,cookie,'/api/v1/health'))
  await value(await post(origin,cookie,'/api/v1/health/configuration',{revision:health.configuration.revision,freshnessSeconds:300,noticesEnabled:true,recipient,confirm:'enable-independent-notices'}))
 }
 const confirmationHash=(await sql('SELECT token_hash FROM porthole_health_recipients WHERE removed_at IS NULL'))[0].token_hash
 assert.equal(confirmationHash.length,64)
 await archiveBrowserJourney({origin,cookie})
 const settings=await get(origin,cookie,'/app/settings/archive');assert.equal(settings.status,200)
 assert.match(await settings.text(),/Restore an archive/)
 const ui=await post(origin,cookie,'/app/settings/archive/export',{});assert.equal(ui.status,303)
 const jobId=ui.headers.get('location').split('/').at(-1),status=await value(await get(origin,cookie,`${api}/exports/${jobId}`))
 assert.ok(status.totalChunks>1)
 assert.equal((await get(origin,cookie,`${api}/exports/${jobId}/manifest`)).status,409)
 assert.equal((await get(origin,cookie,`${api}/exports/${jobId}/chunks/1`)).status,409)
 const first=await value(await get(origin,cookie,`${api}/exports/${jobId}/chunks/0`))
 await restartWorker();cookie=await freshOwner()
 assert.deepEqual(await value(await get(origin,cookie,`${api}/exports/${jobId}/chunks/0`)),first,'replay survives restart without resnapshot')
 const chunks=[first]
 for(let index=1;index<status.totalChunks;index++)chunks.push(await value(await get(origin,cookie,`${api}/exports/${jobId}/chunks/${index}`)))
 const manifest=await value(await get(origin,cookie,`${api}/exports/${jobId}/manifest`)),rows=chunks.flatMap(chunk=>chunk.rows),source={manifest,chunks,rows}
 const encoded=JSON.stringify(source),credential=(await sql(`SELECT secret_hash FROM porthole_credentials WHERE id=${literal(key.credential.id)}`))[0]
 for(const privateValue of [confirmationHash,key.secret,credential.secret_hash,...cookie.split('; ').map(part=>part.slice(part.indexOf('=')+1))])assert.ok(!encoded.includes(privateValue),'archive excludes native secret/hash/session/identity fields')
 assert.ok(rows.some(row=>row.table==='porthole_archive_health_history'&&row.row.table_name==='porthole_health_recipients'),'recipient history is retained as inert evidence')
 assert.ok(rows.some(row=>row.table==='porthole_objects'&&row.row.state==='approved'),'pending rollback history preserved without approval grant')
 assert.ok(!rows.some(row=>['porthole_credentials','porthole_object_approvals','oa_sessions'].includes(row.table)))
 assert.ok(rows.filter(row=>row.table==='porthole_archive_actors').every(row=>row.row.state==='inactive'&&Object.keys(row.row).sort().join(',')==='actor_ref,role,scope,state'))
 const before=(await sql('SELECT COUNT(*) AS n FROM porthole_objects'))[0].n
 assert.equal((await post(origin,cookie,api+'/restores',{manifest})).status,409)
 assert.equal((await sql('SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,before,'nonempty restore does not touch product')
 const directory=await mkdtemp(join(tmpdir(),'porthole-archive-'))
 try{
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest),{mode:0o600})
  for(const chunk of chunks)await writeFile(join(directory,`chunk-${chunk.index}.json`),JSON.stringify(chunk),{mode:0o600})
  const verified=await verifyDirectory(directory);assert.equal(verified.manifest.rowCount,rows.length)
  await assert.rejects(()=>verifyDirectory(directory,'0'.repeat(64)),/Manifest digest/)
  const damaged=structuredClone(chunks[0]);damaged.rows[0].row.name='synthetic-corrupted'
  await writeFile(join(directory,'chunk-0.json'),JSON.stringify(damaged));await assert.rejects(()=>verifyDirectory(directory),/integrity/)
  await writeFile(join(directory,'chunk-0.json'),JSON.stringify(chunks[0]))
  const cliDirectory=join(directory,'cli')
  const cli=await execute(process.execPath,['scripts/porthole/archive.mjs','export',origin,cliDirectory],{env:{...process.env,PORTHOLE_ARCHIVE_COOKIE:cookie}})
  assert.match(cli.stdout,/Verified archive/)
  assert.ok(!cli.stdout.includes(key.secret)&&!cli.stderr.includes(key.secret))
  const again=await execute(process.execPath,['scripts/porthole/archive.mjs','export',origin,cliDirectory],{env:{...process.env,PORTHOLE_ARCHIVE_COOKIE:cookie}})
  assert.match(again.stdout,/Verified archive/)
  assert.equal(typeof withEmptyDestination,'function','a separate real migrated destination is required')
  await withEmptyDestination(async destination=>{
   let destCookie=destination.freshOwner?await destination.freshOwner():destination.cookie
   const destOrigin=destination.origin,initialOwner=(await destination.sql("SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0].id
   assert.ok(!rows.some(row=>row.table==='porthole_archive_actors'&&row.row.actor_ref===initialOwner),'destination has its own independent owner')
   const restore=await value(await post(destOrigin,destCookie,api+'/restores',{manifest}),201)
   const damagedChunk=structuredClone(chunks[0]);damagedChunk.rows[0].row.name='synthetic-corrupt'
   assert.equal((await post(destOrigin,destCookie,`${api}/restores/${restore.id}/chunks`,{chunk:damagedChunk})).status,422)
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,0)
   let staged=await value(await post(destOrigin,destCookie,`${api}/restores/${restore.id}/chunks`,{chunk:chunks[0]}))
   assert.equal(staged.nextChunk,1)
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,0,'staged data remains invisible')
   await value(await post(destOrigin,destCookie,`${api}/restores/${restore.id}/chunks`,{chunk:chunks[0]}))
   await destination.restartWorker();destCookie=destination.freshOwner?await destination.freshOwner():destCookie
   assert.equal((await post(destOrigin,destCookie,`${api}/restores/${restore.id}/commit`,{confirm:'unapproved'})).status,400)
   // Seed only this client's resume receipt, then execute the real CLI: it
   // resumes remaining HTTP uploads and commits the exact reviewed root.
   await writeFile(join(directory,`restore-${hash(destOrigin).slice(0,16)}.json`),JSON.stringify({id:restore.id,rootHash:manifest.rootHash}),{mode:0o600})
   const cliRestore=await execute(process.execPath,['scripts/porthole/archive.mjs','restore',destOrigin,directory,'--confirm',`--manifest-sha256=${verified.manifestDigest}`],{env:{...process.env,PORTHOLE_ARCHIVE_COOKIE:destCookie}})
   assert.match(cliRestore.stdout,/Restored inactive product/)
   const committed=await value(await get(destOrigin,destCookie,`${api}/restores/${restore.id}`));assert.equal(committed.state,'committed')
   assert.equal((await destination.sql("SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0].id,initialOwner)
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_object_approvals'))[0].n,0)
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_health_notices'))[0].n,0,'archived pending sends never enter the live outbox')
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_health_recipients'))[0].n,0,'recipient grants and bearer tokens never become live after restore')
   assert.equal((await destination.sql('SELECT notices_enabled FROM porthole_health_configuration'))[0].notices_enabled,0,'source delivery consent cannot transfer')
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_archive_health_history'))[0].n,manifest.tables.porthole_archive_health_history)
   const deliveryHistory=(await destination.sql("SELECT row,state FROM porthole_archive_health_history WHERE table_name='porthole_health_notices'"))
   assert.ok(deliveryHistory.every(row=>row.state==='quarantined'))
   assert.deepEqual(deliveryHistory.map(row=>JSON.parse(row.row)).sort((a,b)=>a.id.localeCompare(b.id)),rows.filter(row=>row.table==='porthole_archive_health_history'&&row.row.table_name==='porthole_health_notices').map(row=>JSON.parse(row.row.row)).sort((a,b)=>a.id.localeCompare(b.id)))
   assert.equal((await destination.sql('SELECT paused FROM porthole_ingest_control'))[0].paused,1)
   const objects=await value(await get(destOrigin,destCookie,'/api/porthole/v1/objects'))
   assert.ok(objects.objects.every(object=>object.state==='quarantined'))
   for(const definition of rows.filter(row=>row.table==='porthole_objects')){
    const imported=objects.objects.find(object=>object.id===definition.row.id);assert.ok(imported)
    assert.deepEqual(imported.body,JSON.parse(definition.row.body));assert.deepEqual(imported.scope,JSON.parse(definition.row.scope));assert.equal(imported.revision,definition.row.revision)
   }
   const repair=definitions.find(definition=>rows.some(row=>row.table==='porthole_objects'&&row.row.id===definition.id&&row.row.kind==='repair'))
   assert.equal((await post(destOrigin,destCookie,'/api/porthole/v1/approvals',{id:repair.id,revision:repair.revision,confirm:'approve'})).status,409,'quarantined repair carries no approval authority')
   for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive','porthole_ingest_events','porthole_query_snapshots','porthole_monitor_evaluations'])assert.equal((await destination.sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n,manifest.tables[table])
   const streams=await value(await get(destOrigin,destCookie,api+'/audit'))
   for(const stream of streams.streams){
    const actual=[];let after=0
    do{const page=await value(await get(destOrigin,destCookie,`${api}/audit/${stream.stream}?after=${after}`));actual.push(...page.records);after=page.next}while(after!==null)
    const original=rows.filter(row=>row.table==='porthole_archive_audit'&&row.row.stream===stream.stream).map(row=>({hash:row.row.hash,entry:JSON.parse(row.row.entry)}))
    assert.deepEqual(actual,original,'source immutable audit chain remains public-readable')
   }
   const reexport=await savedExport(destOrigin,destCookie,await post(destOrigin,destCookie,api+'/exports',{}))
   for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'])assert.deepEqual(reexport.rows.filter(row=>row.table===table),rows.filter(row=>row.table===table))
   const replay=await execute(process.execPath,['scripts/porthole/archive.mjs','restore',destOrigin,directory,'--confirm'],{env:{...process.env,PORTHOLE_ARCHIVE_COOKIE:destCookie}})
   assert.match(replay.stdout,/Restored inactive product/)
   await destination.restartWorker();destCookie=destination.freshOwner?await destination.freshOwner():destCookie
   assert.equal((await destination.sql('SELECT paused FROM porthole_ingest_control'))[0].paused,1,'restart never activates restored intake')
   await browserProof({origin:destOrigin,cookie:destCookie,paths:[`/app/settings/archive/jobs/${restore.id}`,'/app/health','/app/operations'],name:'archive-restored'})
  })
 }finally{await rm(directory,{recursive:true,force:true})}
 return source
}

async function archiveBrowserJourney({origin,cookie}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),url:origin})))
   const page=await context.newPage()
   await page.goto(origin+'/app/settings/archive')
   await page.getByRole('button',{name:'Create frozen export',exact:true}).click()
   await page.getByRole('heading',{name:/Frozen export/}).waitFor()
   const job=page.url()
   const downloaded=page.waitForEvent('download')
   await page.getByRole('link',{name:/Download next chunk 0/}).click()
   const download=await downloaded
   assert.equal(await download.failure(),null)
   await page.goto(job)
   await page.getByRole('link',{name:'Download chunk 0',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'archive job fits viewport')
   if(process.env.PORTHOLE_EVIDENCE_DIR) {
    const {mkdir}=await import('node:fs/promises');await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
    await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`archive-export-${width}.png`),fullPage:true})
   }
   await context.close()
  }
 } finally {await browser.close()}
}

/** A trace read extends the closed query descriptor. Prove its original scope,
 * sequence and nanoseconds through the real archive door and an independent
 * inactive destination; this is not a validator-only assertion. */
export async function traceArchiveJourney({origin,cookie,traceId,snapshot,expected,withEmptyDestination}) {
 const query=await value(await post(origin,cookie,'/api/porthole/v1/query',{signal:'traces',trace:traceId,limit:2000,snapshot}))
 assert.equal(query.records.length,expected.recordCount)
 const saved=await savedExport(origin,cookie,await post(origin,cookie,api+'/exports',{}))
 assert.ok(saved.rows.some(row=>row.table==='porthole_query_snapshots'&&JSON.parse(row.row.scope).trace===traceId))
 await withEmptyDestination(async destination=>{
  const acting=await destination.freshOwner(),restore=await value(await post(destination.origin,acting,api+'/restores',{manifest:saved.manifest}),201)
  for(const chunk of saved.chunks)await value(await post(destination.origin,acting,`${api}/restores/${restore.id}/chunks`,{chunk}))
  await value(await post(destination.origin,acting,`${api}/restores/${restore.id}/commit`,{confirm:saved.manifest.rootHash}))
  const restored=await value(await get(destination.origin,acting,`/api/porthole/v1/traces/${traceId}?snapshot=${snapshot}`))
  assert.deepEqual(restored,expected,'original trace graph, source metadata and nanoseconds survive an independently owned inactive restore')
  const replay=await value(await get(destination.origin,acting,'/api/porthole/v1/query/'+query.queryRef))
  assert.deepEqual(replay.records,query.records,'the archived bounded trace descriptor replays through the product query door')
  assert.equal(replay.snapshot,snapshot)
  assert.equal((await destination.sql('SELECT paused FROM porthole_ingest_control'))[0].paused,1)
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
  assert.equal((await get(destination.origin,cookie,`/api/porthole/v1/traces/${traceId}`)).status,401)
  await browserProof({origin:destination.origin,cookie:acting,paths:[`/app/traces/${traceId}?snapshot=${snapshot}`],name:'trace-inactive-restored'})
 })
 console.log('traceArchiveJourney passed: source snapshot descriptor and original graph/ns replay after independent inactive restore; no source session or credential authority')
}

export async function analyticalArchiveSnapshot({context,cookie}) {
 const job=await value(await context.post(api+'/exports',{},201,cookie),201),chunks=[]
 for(let index=0;index<job.totalChunks;index++)chunks.push(await value(await context.call(`${api}/exports/${job.id}/chunks/${index}`,{headers:{cookie}})))
 const manifest=await value(await context.call(`${api}/exports/${job.id}/manifest`,{headers:{cookie}}))
 return {job,chunks,manifest,rows:chunks.flatMap(chunk=>chunk.rows)}
}
export async function restoreAnalyticalSnapshot({context,saved,times}) {
 const {post,call,cookie,getDb,health}=context
 const valueOf=async(path,data,status=200)=>(await post(path,data,status)).json()
 const restore=await valueOf(api+'/restores',{manifest:saved.manifest},201)
 for(const chunk of saved.chunks)await valueOf(`${api}/restores/${restore.id}/chunks`,{chunk})
 await valueOf(`${api}/restores/${restore.id}/commit`,{confirm:saved.manifest.rootHash})
 const db=getDb(),config=await db.prepare('SELECT * FROM porthole_analytical_configuration').first()
 assert.equal(config.enabled,0);assert.equal(config.configured_by,null,'source connection authority never becomes live')
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM porthole_credentials').first()).n,0)
 assert.equal((await db.prepare('SELECT paused FROM porthole_ingest_control').first()).paused,1)
 const history=(await db.prepare("SELECT row FROM porthole_archive_health_history WHERE table_name='porthole_analytical_configuration'").all()).results
 assert.ok(history.some(row=>JSON.parse(row.row).enabled===1),'owner connection history is retained only as quarantined evidence')
 assert.equal((await health()).status,'Unknown')
 const retained=(await db.prepare("SELECT event_time_ns FROM porthole_telemetry_records WHERE service='checkout-api' AND signal='logs'").all()).results
 assert.deepEqual(retained.map(row=>row.event_time_ns).sort(),times.map(time=>time.padStart(20,'0')).sort())
 assert.equal((await call('/api/porthole/v1/ingest/records?signal=logs',{headers:{cookie}})).status,503,'destination requires its own explicit analytical connection')
 return config
}

/** Extend the existing inactive-archive boundary to profile dictionaries and
 * protected profile query snapshots, using a separately owned real D1 store. */
export async function profileArchiveJourney({origin,cookie,records,queryRef,withEmptyDestination}) {
 const saved=await savedExport(origin,cookie,await post(origin,cookie,api+'/exports',{}))
 const profileRows=saved.rows.filter(row=>row.table==='porthole_telemetry_records'&&row.row.signal==='profiles')
 assert.ok(profileRows.length>0)
 await withEmptyDestination(async destination=>{
  const acting=await destination.freshOwner(),restore=await value(await post(destination.origin,acting,api+'/restores',{manifest:saved.manifest}),201)
  for(const chunk of saved.chunks)await value(await post(destination.origin,acting,`${api}/restores/${restore.id}/chunks`,{chunk}))
  await value(await post(destination.origin,acting,`${api}/restores/${restore.id}/commit`,{confirm:saved.manifest.rootHash}))
  const replay=await value(await get(destination.origin,acting,'/api/porthole/v1/query/'+queryRef))
  assert.deepEqual(replay.records,records,'all original profile dictionaries, links, samples and ns survive inactive restore and current-authority replay')
  const copies=await value(await get(destination.origin,acting,'/api/porthole/v1/ingest/archive?signal=profiles'))
  assert.equal(copies.records.length,profileRows.length)
  assert.equal((await destination.sql('SELECT paused FROM porthole_ingest_control'))[0].paused,1)
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
  assert.equal((await get(destination.origin,cookie,'/api/porthole/v1/ingest/records?signal=profiles')).status,401)
  const reexport=await savedExport(destination.origin,acting,await post(destination.origin,acting,api+'/exports',{}))
  assert.deepEqual(reexport.rows.filter(row=>['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'].includes(row.table)),saved.rows.filter(row=>['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'].includes(row.table)))
 })
 console.log('profileArchiveJourney passed: byte-exact profile history/dictionaries and protected query replay after independent inactive restore, with no transferred credential or session')
}
