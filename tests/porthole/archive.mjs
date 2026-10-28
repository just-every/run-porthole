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
/** Notebook context is portable history, never a copied sharing capability. */
export async function notebookArchiveJourney({origin,freshOwner,withEmptyDestination,notebookId,initialRevision,publicationId,scope}) {
 const cookie=await freshOwner(),root='/api/porthole/v1/notebooks/'+notebookId
 const before=await value(await get(origin,cookie,root))
 const source=await savedExport(origin,cookie,await post(origin,cookie,api+'/exports',{}))
 const notebookRows=source.rows.filter(row=>['porthole_notebooks','porthole_notebook_versions'].includes(row.table))
 assert.ok(notebookRows.length>4,'archive preserves the actual revision history')
 assert.ok(!source.rows.some(row=>row.table==='porthole_notebook_shares'),'live grants never enter the archive')
 const publications=source.rows.filter(row=>row.table==='porthole_notebook_publications')
 assert.ok(publications.some(p=>p.row.id===publicationId&&p.row.state==='published'),'archive contains the exact reviewed publication as inert context')
 assert.ok(!JSON.stringify(notebookRows).includes('synthetic-porthole-log-0'),'notebook context has references, never detached telemetry')
 assert.ok(notebookRows.some(row=>JSON.parse(row.row.body).cells.some(cell=>cell.kind==='change')),'service-change cells and their original references are archived')
 assert.ok(!JSON.stringify(notebookRows).includes('synthetic-porthole-2450'),'service-change source facts are not detached notebook copies')
 const {notebookBrowser}=await import('./notebooks.mjs')
 await withEmptyDestination(async destination=>{
  const destCookie=await destination.freshOwner(),start=await value(await post(destination.origin,destCookie,api+'/restores',{manifest:source.manifest}),201)
  for(const chunk of source.chunks)await value(await post(destination.origin,destCookie,`${api}/restores/${start.id}/chunks`,{chunk}))
  await value(await post(destination.origin,destCookie,`${api}/restores/${start.id}/commit`,{confirm:source.manifest.rootHash}))
  let restored=await value(await get(destination.origin,destCookie,root))
  assert.equal(restored.state,'quarantined');assert.equal(restored.revision,before.revision)
  assert.deepEqual((await value(await get(destination.origin,destCookie,'/api/porthole/v1/notebooks/evaluations'))).evaluations,[],'inactive restored monitors cannot become live investigation authority')
  await value(await post(destination.origin,destCookie,'/api/porthole/v1/notebooks',{name:'No restored firing authority',evaluationId:before.body.origin.evaluationId}),404)
  assert.deepEqual(restored.body,before.body)
  assert.ok(restored.results.filter(Boolean).every(result=>result.state==='unavailable'&&result.count===null&&result.records.length===0))
  const historical=await value(await get(destination.origin,destCookie,root+'?version='+initialRevision))
  assert.equal(historical.revision,initialRevision)
  assert.ok(historical.results.filter(Boolean).every(result=>result.state==='unavailable'))
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_notebook_shares'))[0].n,0)
  assert.equal((await destination.sql("SELECT COUNT(*) AS n FROM porthole_notebook_publications WHERE state!='quarantined'"))[0].n,0,'no published, draft or revoked authority is restored')
  for(const publication of publications) {
   const unavailable=await fetch(destination.origin+'/shared/notebooks/'+publication.row.id)
   assert.equal(unavailable.status,404);assert.ok(!(await unavailable.text()).includes('205 records'))
  }
  await value(await post(destination.origin,destCookie,root+'/publications/'+publicationId+'/approve',{}),409)
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_health_notices'))[0].n,0,'mentions and notices do not enter a restored outbox')
  assert.equal((await get(destination.origin,cookie,root)).status,401,'old native sessions never become restored authority')
  await value(await post(destination.origin,destCookie,root+'/share',{revision:restored.revision,kind:'team',target:'synthetic-porthole-2402'}),409)
  await value(await post(destination.origin,destCookie,root+'/comment',{revision:restored.revision,text:'Must remain inert'}),409)
  const address=['synthetic-porthole-2421','example.com'].join(String.fromCharCode(64))
  await value(await post(destination.origin,destCookie,'/app/settings/members/invite',{email:address,displayName:'Reinvited responder',role:'responder',scope}),202)
  const reinvited=await destination.signIn(address)
  assert.equal((await get(destination.origin,reinvited,root)).status,404,'a new membership with the same address and team cannot inherit a restored share')
  await destination.restartWorker()
  const fresh=await destination.freshOwner()
  restored=await value(await get(destination.origin,fresh,root))
  assert.equal((await fetch(destination.origin+'/shared/notebooks/'+publicationId)).status,404,'restart cannot reactivate restored publication authority')
  assert.deepEqual(restored.body,before.body)
  assert.deepEqual(restored.body.comments[0].mentions,before.body.comments[0].mentions)
  await notebookBrowser({origin:destination.origin,cookie:fresh,path:'/app/notebooks/'+notebookId,name:'notebook-restored-private',exercise:async page=>{
   const text=await page.locator('body').innerText();assert.ok(text.includes('Restored, inactive'));assert.ok(text.includes('No sharing grants or outbound mention work were restored.'))
   assert.ok(text.includes('Undelivered. No notification was sent.'))
   assert.equal(await page.locator('form').count(),0)
  }})
 })
 return source
}
/** The later local erasure journal also fences an older downloaded archive. */
export async function notebookJournalRestoreJourney({origin,freshOwner,withEmptyDestination,source,publicationId,notebookId}) {
 const cookie=await freshOwner(),journal=await value(await get(origin,cookie,'/api/porthole/v1/subject-erasure/journal'))
 assert.ok(journal.records.length>0)
 await withEmptyDestination(async destination=>{
  const fresh=await destination.freshOwner()
  await value(await post(destination.origin,fresh,'/api/porthole/v1/subject-erasure/journal',{...journal,confirm:'apply-erasure-journal'}))
  const start=await value(await post(destination.origin,fresh,api+'/restores',{manifest:source.manifest}),201)
  for(const chunk of source.chunks)await value(await post(destination.origin,fresh,`${api}/restores/${start.id}/chunks`,{chunk}))
  await value(await post(destination.origin,fresh,`${api}/restores/${start.id}/commit`,{confirm:source.manifest.rootHash}))
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_notebook_publications'))[0].n,0,'older archive projections are purged against the destination journal before restore commits')
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records WHERE batch_id IN (SELECT id FROM porthole_erased_batches)'))[0].n,0)
  assert.equal((await destination.sql("SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE id IN (SELECT id FROM porthole_erased_batches) AND wire_base64!=''"))[0].n,0)
  assert.equal((await fetch(destination.origin+'/shared/notebooks/'+publicationId)).status,404)
  assert.equal((await value(await get(destination.origin,fresh,'/api/porthole/v1/notebooks/'+notebookId))).state,'quarantined')
  await destination.restartWorker()
  assert.equal((await fetch(destination.origin+'/shared/notebooks/'+publicationId)).status,404,'restart cannot resurrect the erased projection')
 })
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
  // The CLI attaches the owner session itself, so the cookie's Secure flag
  // cannot keep it off a remote cleartext origin. The network edge records sends.
  const edge='data:text/javascript,'+encodeURIComponent("globalThis.fetch=async url=>{process.stderr.write('synthetic-porthole-sent '+url+'\\n');throw Error('offline')}")
  for(const [operation,target]of [['export',join(directory,'remote')],['restore',cliDirectory]]){
   const remote=await execute(process.execPath,['--import',edge,'scripts/porthole/archive.mjs',operation,'http://synthetic-porthole.example',target,'--confirm'],{env:{...process.env,PORTHOLE_ARCHIVE_COOKIE:cookie}}).then(()=>null,error=>error)
   assert.ok(remote&&!remote.stderr.includes('synthetic-porthole-sent'),'archive '+operation+' never sends the owner session to a remote HTTP origin')
  }
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
 const sourcePolicy=await value(await get(origin,cookie,'/app/settings/instrumentation/policy.json'))
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
  const restoredPolicy=await value(await get(destination.origin,acting,'/app/settings/instrumentation/policy.json'))
  assert.equal(restoredPolicy.enabled,false,'independent restore disables baggage forwarding')
  assert.deepEqual(restoredPolicy.allowedKeys,sourcePolicy.allowedKeys);assert.deepEqual(restoredPolicy.attributeKeys,sourcePolicy.attributeKeys)
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
 const sourcePolicy=await value(await get(origin,cookie,'/app/settings/instrumentation/policy.json'))
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
  const restoredPolicy=await value(await get(destination.origin,acting,'/app/settings/instrumentation/policy.json'))
  assert.equal(restoredPolicy.enabled,false,'independent restore disables baggage forwarding')
  assert.deepEqual(restoredPolicy.allowedKeys,sourcePolicy.allowedKeys);assert.deepEqual(restoredPolicy.attributeKeys,sourcePolicy.attributeKeys)
  assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
  assert.equal((await get(destination.origin,cookie,'/api/porthole/v1/ingest/records?signal=profiles')).status,401)
  const reexport=await savedExport(destination.origin,acting,await post(destination.origin,acting,api+'/exports',{}))
  assert.deepEqual(reexport.rows.filter(row=>['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'].includes(row.table)),saved.rows.filter(row=>['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'].includes(row.table)))
 })
 console.log('profileArchiveJourney passed: byte-exact profile history/dictionaries and protected query replay after independent inactive restore, with no transferred credential or session')
}

/** Portable signal pages are a separate owner-approved public data door. */
export async function signalExportJourney({origin,cookie,freshOwner,restartWorker,sql,signIn,withEmptyDestination}) {
 const {otlpLogBatch,profileBatch,otlpProtoBatch,ingestScope}=await import('./ingest.mjs')
 const {runExport}=await import('../../scripts/porthole/export.mjs')
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
 const {mkdtemp,readFile,readdir,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os')
 const root='/api/porthole/v1/exports',time=BigInt(Date.now())*1000000n-1000000000n
 cookie=await freshOwner()
 const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
 const value=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
 const mint=async(kind,scope)=>{const response=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-1700',class:kind,scope:{...scope,actions:[kind==='ingest'?'telemetry.write':'telemetry.read']}});assert.equal(response.status,201);return response.json()}
 const scope={...ingestScope,teams:[...ingestScope.teams,'synthetic-porthole-1701']}
 const source=await mint('ingest',scope),reader=await mint('read',scope)
 const send=async(signal,body,proto=false)=>{const response=await fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':proto?'application/x-protobuf':'application/json'},body:proto?body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text())}
 for (const [index,team] of scope.teams.entries()) {
  const logs=otlpLogBatch(Array.from({length:7},(_,i)=>time+BigInt(i)),`synthetic-porthole-${1702+index}`);logs.resourceLogs[0].resource.attributes[2].value.stringValue=team
  await send('logs',logs)
  const profiles=profileBatch(time);profiles.resourceProfiles[0].resource.attributes[2].value.stringValue=team
  await send('profiles',profiles)
 }
 for (const signal of ['metrics','traces'])await send(signal,otlpProtoBatch(signal,time),true)
 assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
 const selection={scope:{services:scope.services,environments:scope.environments,teams:scope.teams},signals:scope.signals,from:String(time),through:String(time+100n),pageSize:3}
 assert.equal((await fetch(origin+root,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(selection)})).status,401)
 assert.equal((await fetch(origin+root,{method:'POST',headers:{authorization:'Bearer '+reader.secret,'content-type':'application/json'},body:JSON.stringify(selection)})).status,403,'a read credential cannot approve its own export')
 const preview=await runExport({operation:'preview',origin,cookie,selection})
 assert.equal(preview.state,'preview');assert.equal(preview.estimate.totalRecords,18);assert.ok(preview.estimate.payloadBytes>0);assert.equal(preview.estimate.usd,null)
 const costModel={source:'synthetic-porthole-1714 owner rate card',fixedUsdMicros:1234567,usdMicrosPerMillionRecords:25000000,usdMicrosPerGiBPayload:1700000}
 for(const model of [{...costModel,fixedUsdMicros:-1},{...costModel,usdMicrosPerGiBPayload:0.5},{...costModel,source:''},{...costModel,unknown:1}])assert.equal((await post(root,{...selection,costModel:model})).status,400,'invalid pricing never silently falls back to a free estimate')
 const priced=await runExport({operation:'preview',origin,cookie,selection:{...selection,costModel}})
 const expectedMicros=1234567n+450n+(BigInt(priced.estimate.payloadBytes)*1700000n+1073741823n)/1073741824n
 assert.equal(priced.estimate.usdMicros,String(expectedMicros))
 assert.equal(priced.estimate.usd,`${expectedMicros/1000000n}.${String(expectedMicros%1000000n).padStart(6,'0')}`)
 assert.deepEqual(priced.estimate.costModel,costModel)
 assert.deepEqual(priced.selection.costModel,costModel)
 assert.match(priced.estimate.costNote,/not a provider quote/)
 const approvedPrice=await value(await post(root+'/'+priced.id+'/approve',{confirm:priced.id}))
 assert.deepEqual(approvedPrice.estimate,priced.estimate,'the exact approved estimate and rate source remain immutable')
 await value(await post(root+'/'+priced.id+'/cancel',{confirm:priced.id}))

 const pages=(id,credential=reader.secret,query='')=>fetch(origin+root+'/'+id+'/pages'+query,{headers:{authorization:'Bearer '+credential}})
 for(const id of [preview.id,'00000000-0000-4000-8000-000000000000']) {
  assert.equal((await fetch(origin+root+'/'+id+'/pages',{headers:{cookie,authorization:'Bearer synthetic-porthole-1713'}})).status,401,'invalid credentials cannot probe private export existence or borrow owner authority')
  assert.equal((await fetch(origin+root+'/'+id)).status,401,'authenticate before looking up an export manifest')
 }
 assert.equal((await fetch(origin+root+'/'+preview.id+'/pages',{headers:{cookie}})).status,409)
 assert.equal((await post(root+'/'+preview.id+'/approve',{confirm:'wrong'})).status,409)
 const narrow=await mint('read',{...scope,teams:[scope.teams[0]]})
 assert.equal((await post(root+'/'+preview.id+'/approve',{confirm:preview.id,credentialId:narrow.credential.id})).status,403)
 await value(await post(root+'/'+preview.id+'/approve',{confirm:preview.id,credentialId:reader.credential.id}))
 assert.equal((await pages(preview.id,narrow.secret)).status,403,'a different read credential cannot reuse approval')
 const directory=await mkdtemp(join(tmpdir(),'porthole-signal-export-'))
 const otlpDirectory=await mkdtemp(join(tmpdir(),'porthole-signal-otlp-'))
 const revokeDirectory=await mkdtemp(join(tmpdir(),'porthole-signal-revoke-'))
 try {
  const cli=async(directory,extra=[])=>JSON.parse((await promisify(execFile)(process.execPath,['scripts/porthole/export.mjs','download',origin,preview.id,directory,...extra],{env:{...process.env,PORTHOLE_CREDENTIAL:reader.secret},timeout:30000})).stdout)
  const interrupted=await cli(directory,['--max-pages=1']);assert.equal(interrupted.complete,false);assert.equal(interrupted.records,3)
  const first=await pages(preview.id),firstBytes=await first.text(),replay=await pages(preview.id)
  assert.equal(await replay.text(),firstBytes,'same page is exactly replayable')
  // An already approved watermark excludes later ingestion with old timestamps.
  await send('logs',otlpLogBatch([time+50n],'synthetic-porthole-1709'));await post('/api/porthole/v1/ingest/drain',{})
  await restartWorker();cookie=await freshOwner()
  const resumed=await cli(directory);assert.equal(resumed.complete,true);assert.equal(resumed.records,18)
  const files=(await readdir(directory)).filter(name=>name.endsWith('.ndjson')).sort()
  const rows=(await Promise.all(files.map(name=>readFile(join(directory,name),'utf8')))).join('').trim().split('\n').map(JSON.parse)
  assert.equal(new Set(rows.map(row=>row.id)).size,18,'no duplicate on resume')
  assert.deepEqual([...new Set(rows.map(row=>row.signal))].sort(),['logs','metrics','profiles','traces'])
  assert.deepEqual([...new Set(rows.map(row=>row.team))].sort(),[...scope.teams].sort())
  assert.ok(rows.every(row=>BigInt(row.event_time_ns)>=time && BigInt(row.event_time_ns)<=time+100n))
  const trace=rows.find(row=>row.signal==='traces'),log=rows.find(row=>row.signal==='logs')
  assert.equal(log.trace_id,trace.trace_id);assert.equal(log.span_id,trace.span_id)
  assert.equal(rows.find(row=>row.signal==='metrics').payload.metric.unit,'ms')
  for(const signal of scope.signals) {
   const query=await value(await post('/api/porthole/v1/query',{signal,from:String(time),through:String(time+100n),snapshot:preview.snapshot,limit:200}))
   const exported=rows.filter(row=>row.signal===signal)
   assert.deepEqual(query.records.map(row=>row.id).sort(),exported.map(row=>row.id).sort())
   for(const row of exported)assert.deepEqual(row.payload,query.records.find(item=>item.id===row.id).payload)
  }
  const converted=await cli(otlpDirectory,['--format=otlp-json']);assert.equal(converted.records,18)
  const otlp=(await Promise.all((await readdir(otlpDirectory)).filter(name=>name.endsWith('.ndjson')).sort().map(name=>readFile(join(otlpDirectory,name),'utf8')))).join('').trim().split('\n').map(JSON.parse)
  const python=process.env.PORTHOLE_EXPORT_PYTHON || join(process.cwd(),'.cache/export-readers/bin/python')
  const independentlyRead=(await promisify(execFile)(python,['tests/porthole/export-otlp-reader.py',otlpDirectory])).stdout.trim().split('\n').map(JSON.parse)
  assert.equal(independentlyRead.length,otlp.length)
  for(const decoded of independentlyRead) {
   const source=otlp.find(row=>row.id===decoded.id)
   assert.equal(decoded.signal,source.signal)
   // Protobuf omits an empty schema URL, which is the specified default.
   const defaults=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==='schemaUrl' && item===''?undefined:item))
   assert.deepEqual(decoded.exportRequest,defaults(source.exportRequest),'official OTLP schema preserves complete signal content, profile dictionaries and exact integers')
  }
  // Save history before suppression, then carry the later portable journal
  // into an independent destination before restoring that older history.
  const olderArchive=await savedExport(origin,cookie,await post(api+'/exports',{}))
  const exclusions=scope.signals.map(signal=>({recordId:rows.find(row=>row.signal===signal).id,excludedAt:Date.now()}))
  const exclusionRoot='/api/porthole/v1/export-exclusions'
  const apply={confirm:'apply-exclusions',journal:{format:'porthole.export-exclusions.v1',records:exclusions}}
  assert.equal((await fetch(origin+exclusionRoot,{method:'POST',headers:{origin,authorization:'Bearer '+reader.secret,'content-type':'application/json'},body:JSON.stringify(apply)})).status,403,'credentials cannot alter export exclusions')
  assert.equal((await post(exclusionRoot,{...apply,confirm:'wrong'})).status,400)
  await value(await post(exclusionRoot,apply))
  const journal=await value(await fetch(origin+exclusionRoot,{headers:{cookie}}))
  assert.deepEqual(journal.records,[...exclusions].sort((a,b)=>a.recordId.localeCompare(b.recordId)))
  assert.equal(journal.next,null)
  await value(await post(exclusionRoot,{...apply,journal:{...apply.journal,records:exclusions.map(row=>({...row,excludedAt:0}))}}))
  assert.deepEqual((await value(await fetch(origin+exclusionRoot,{headers:{cookie}}))).records,journal.records,'replaying an older journal cannot remove or roll back exclusions')
  const excludedIds=new Set(exclusions.map(row=>row.recordId))
  let excludedCursor='',remaining=[]
  do {
   const page=await pages(preview.id,reader.secret,excludedCursor?'?cursor='+encodeURIComponent(excludedCursor):'')
   assert.equal(page.status,200)
   remaining.push(...(await page.text()).trim().split('\n').filter(Boolean).map(JSON.parse))
   excludedCursor=page.headers.get('x-porthole-next-cursor')
  }while(excludedCursor)
  assert.equal(remaining.length,14)
  assert.ok(remaining.every(row=>!excludedIds.has(row.id)),'an approval made before exclusion cannot release excluded records')
  const archiveWithJournal=await savedExport(origin,cookie,await post(api+'/exports',{}))
  assert.deepEqual(archiveWithJournal.rows.filter(row=>row.table==='porthole_export_exclusions').map(row=>row.row.record_id).sort(),[...excludedIds].sort(),'whole-installation archives carry the portable exclusions')
  await withEmptyDestination(async destination=>{
   const owner=await destination.freshOwner()
   const send=(path,data)=>fetch(destination.origin+path,{method:'POST',headers:{origin:destination.origin,cookie:owner,'content-type':'application/json'},body:JSON.stringify(data)})
   await value(await send(exclusionRoot,{confirm:'apply-exclusions',journal:{format:journal.format,records:journal.records}}))
   const legacy=structuredClone(olderArchive.manifest)
   delete legacy.tables.porthole_export_exclusions
   const restored=await (await send(api+'/restores',{manifest:legacy})).json()
   assert.ok(restored.id)
   for(const chunk of olderArchive.chunks)await value(await send(api+'/restores/'+restored.id+'/chunks',{chunk}))
   await value(await send(api+'/restores/'+restored.id+'/commit',{confirm:legacy.rootHash}))
   const fresh=await runExport({operation:'preview',origin:destination.origin,cookie:owner,selection})
   const archivedRecords=olderArchive.rows.filter(row=>row.table==='porthole_telemetry_records').map(row=>row.row).filter(row=>scope.services.includes(row.service)&&scope.environments.includes(row.environment)&&scope.teams.includes(row.team)&&BigInt(row.event_time_ns)>=time&&BigInt(row.event_time_ns)<=time+100n)
   const eligible=archivedRecords.filter(row=>!excludedIds.has(row.id))
   assert.equal(fresh.estimate.totalRecords,eligible.length,'restored history retains late arrivals but cannot revive later excluded records')
   await runExport({operation:'approve',origin:destination.origin,cookie:owner,id:fresh.id})
   let cursor='',records=[]
   do {
    const response=await fetch(destination.origin+root+'/'+fresh.id+'/pages'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:{cookie:owner}})
    assert.equal(response.status,200)
    records.push(...(await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse));cursor=response.headers.get('x-porthole-next-cursor')
   }while(cursor)
   assert.deepEqual(records.map(row=>row.id).sort(),eligible.map(row=>row.id).sort())
   assert.deepEqual((await value(await fetch(destination.origin+exclusionRoot,{headers:{cookie:owner}}))).records,journal.records)
  })
  cookie=await freshOwner()
  // Re-ingest independently framed OTLP requests through the public wire parser.
  // Profile dictionaries, metric types and exact original context must survive.
  const roundtrip=await mint('ingest',scope)
  for(const row of otlp)assert.equal((await fetch(origin+'/v1/'+row.signal,{method:'POST',headers:{authorization:'Bearer '+roundtrip.secret,'content-type':'application/json'},body:JSON.stringify(row.exportRequest)})).status,200)
  await post('/api/porthole/v1/ingest/drain',{})
  for(const signal of scope.signals) {
   const queried=await value(await post('/api/porthole/v1/query',{signal,from:String(time),through:String(time+100n),limit:200}))
   const copies=queried.records.filter(row=>row.source_id===roundtrip.credential.id),original=rows.filter(row=>row.signal===signal)
   // Repeated identical requests are deduplicated by ingest; each unique payload
   // still has a matching original record without lossy conversion.
   for(const copy of copies){const source=original.find(row=>row.event_time_ns===copy.event_time_ns&&row.team===copy.team);assert.ok(source);const clean=value=>{const {delivery,...rest}=value;return rest};assert.deepEqual(clean(copy.payload),clean(source.payload))}
   assert.ok(copies.length>0)
  }
  // Exercise the byte boundary independently of the row limit, using real
  // intake envelopes with large log bodies rather than synthetic SQL rows.
  const largeTime=time+1000000n
  for(let index=0;index<3;index++)await send('logs',otlpLogBatch([largeTime+BigInt(index)],'synthetic-porthole-1711 '+ 'x'.repeat(600000)))
  await post('/api/porthole/v1/ingest/drain',{})
  const large=await runExport({operation:'preview',origin,cookie,selection:{...selection,signals:['logs'],from:String(largeTime),through:String(largeTime+2n),pageSize:50}})
  await runExport({operation:'approve',origin,cookie,id:large.id,credentialId:reader.credential.id})
  let largeCursor='',largeCount=0,largePages=0
  do {
   const response=await pages(large.id,reader.secret,largeCursor?'?cursor='+encodeURIComponent(largeCursor):'')
   assert.equal(response.status,200)
   const batch=(await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse)
   assert.equal(batch.length,1,'payload boundary shortens the page without truncating the export')
   assert.ok(batch.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row.payload)),0)<=1024*1024)
   largeCount+=batch.length;largePages++;largeCursor=response.headers.get('x-porthole-next-cursor')
  }while(largeCursor)
  assert.equal(largeCount,3);assert.equal(largePages,3)
  await cli(revokeDirectory,['--max-pages=1'])
  await post('/app/settings/credentials/revoke',{id:reader.credential.id})
  assert.equal((await pages(preview.id)).status,401)
  const before=await readFile(join(revokeDirectory,'progress.json'),'utf8')
  await assert.rejects(()=>cli(revokeDirectory),/Export refused \(401/)
  assert.equal(await readFile(join(revokeDirectory,'progress.json'),'utf8'),before,'refused resume preserves checkpoint')
  const parquet=join(otlpDirectory,'parquet')
  const convertedParquet=JSON.parse((await promisify(execFile)(python,['scripts/porthole/export-parquet.py',directory,parquet])).stdout)
  assert.equal(convertedParquet.records,18)
  // DuckDB is independent of the Arrow writer and reads every original field.
  const independent=JSON.parse((await promisify(execFile)(python,['-c',"import duckdb,json,sys; rows=duckdb.connect().execute('SELECT id,signal,CAST(event_time_ns AS VARCHAR),trace_id,span_id,metric_unit,payload_json FROM read_parquet(?) ORDER BY id',[sys.argv[1]]).fetchall(); print(json.dumps(rows))",join(parquet,'*.parquet')])).stdout)
  assert.equal(independent.length,18)
  for(const [id,signal,time,trace,span,unit,payload]of independent){const source=rows.find(row=>row.id===id);assert.equal(signal,source.signal);assert.equal(BigInt(time),BigInt(source.event_time_ns));assert.equal(trace,source.trace_id);assert.equal(span,source.span_id);assert.equal(unit,source.payload.metric?.unit??null);assert.deepEqual(JSON.parse(payload),source.payload)}
  // File corruption is refused locally before another page can be appended.
  await writeFile(join(directory,files[0]),'synthetic-porthole-1710\n')
  await assert.rejects(()=>runExport({operation:'download',origin,cookie,id:preview.id,directory}),/integrity mismatch/)
  await value(await post(root+'/'+preview.id+'/cancel',{confirm:preview.id}))
  assert.equal((await fetch(origin+root+'/'+preview.id+'/pages',{headers:{cookie}})).status,409)
  // Current authority fences metadata too: an old manifest's counts and
  // selection cannot survive a narrower owner scope.
  const stale=await runExport({operation:'preview',origin,cookie,selection})
  await runExport({operation:'approve',origin,cookie,id:stale.id})
  const allScope={services:['*'],environments:['*'],teams:['*']}
  assert.equal((await post('/app/settings/members/invite',{email:'synthetic-porthole-1712@example.com',displayName:'Export reviewer',role:'admin',scope:allScope})).status,202)
  let reviewer=await signIn('synthetic-porthole-1712@example.com')
  const members=(await sql("SELECT id,email FROM oa_operators WHERE email IN ('owner@example.com','synthetic-porthole-1712@example.com')"))
  const ownerId=members.find(row=>row.email==='owner@example.com').id,reviewerId=members.find(row=>row.email==='synthetic-porthole-1712@example.com').id
  assert.equal((await post('/app/settings/members/change',{operatorId:reviewerId,role:'owner',confirmEmail:'synthetic-porthole-1712@example.com',scope:allScope})).status,200)
  reviewer=await signIn('synthetic-porthole-1712@example.com')
  const rescope=(scope,role)=>fetch(origin+'/app/settings/members/change',{method:'POST',headers:{origin,cookie:reviewer,'content-type':'application/json'},body:JSON.stringify({operatorId:ownerId,role,scope,confirmEmail:'owner@example.com'})})
  assert.equal((await rescope({...selection.scope,teams:[scope.teams[0]]},'admin')).status,200)
  cookie=await signIn('owner@example.com')
  for(const suffix of ['', '/pages'])assert.equal((await fetch(origin+root+'/'+stale.id+suffix,{headers:{cookie}})).status,403,'narrowed owner cannot read old export metadata or payload')
  assert.equal((await rescope(allScope,'owner')).status,200);cookie=await freshOwner()
  for(const suffix of ['', '/pages'])assert.equal((await fetch(origin+root+'/'+stale.id+suffix,{headers:{cookie}})).status,409,'restored owner authority does not revive old export approval')
  assert.equal((await post('/app/settings/members/remove',{operatorId:reviewerId})).status,200)
  const facts=await sql(`SELECT action FROM porthole_audit_facts WHERE entity_ref='${preview.id}'`)
  for(const action of ['signals.export-preview','signals.export-approved','signals.export-cancelled'])assert.ok(facts.some(row=>row.action===action))
 } finally {for(const path of [directory,otlpDirectory,revokeDirectory])await rm(path,{recursive:true,force:true})}
 console.log('signalExportJourney passed: owner preview and approval, bounded four-signal pages, multi-team exact counts and context, CLI interruption and restart, snapshot and credential fencing, OTLP roundtrip and cancellation; independent DuckDB Parquet reads; official OTLP readers for all four signals including standard profiles; portable exclusions fence already approved jobs and old archives; full subject erasure remains PORT-035')
}

/** Exact owner-approved local envelope erasure and later-journal restore fence. */
export async function subjectErasureJourney({origin,freshOwner,restartWorker,sql,withEmptyDestination,withPinnedClock}) {
 const {otlpLogBatch,profileBatch,ingestScope}=await import('./ingest.mjs')
 const root='/api/porthole/v1/subject-erasure',identifier='synthetic-porthole-1800@example.com'
 const scope={...ingestScope,services:['synthetic-porthole-1801']}
 let cookie=await freshOwner()
 const send=(path,data,session=cookie)=>post(origin,session,path,data)
 const source=await value(await send('/app/settings/credentials/mint',{name:'synthetic-porthole-1802',class:'ingest',scope}),201)
 const time=BigInt(Date.now())*1000000n-5000000000n
 const attributes=marker=>[{key:'service.name',value:{stringValue:scope.services[0]}},{key:'deployment.environment.name',value:{stringValue:scope.environments[0]}},{key:'team.name',value:{stringValue:scope.teams[0]}},{key:'user.email',value:{stringValue:marker}}]
 const logs=otlpLogBatch([time,time+1n]);logs.resourceLogs[0].resource.attributes=attributes(identifier)
 const profiles=profileBatch(time);profiles.resourceProfiles[0].resource.attributes=attributes(identifier)
 const metrics={resourceMetrics:[{resource:{attributes:attributes(identifier)},scopeMetrics:[{metrics:[{name:'synthetic_porthole_1803',gauge:{dataPoints:[{timeUnixNano:String(time),asDouble:2}]}}]}]}]}
 const traces={resourceSpans:[{resource:{attributes:attributes(identifier)},scopeSpans:[{spans:[{traceId:'1234567890abcdef1234567890abcdef',spanId:'1234567890abcdef',name:'synthetic-porthole-1804',startTimeUnixNano:String(time),endTimeUnixNano:String(time+100n)}]}]}]}
 const intake=(signal,body)=>fetch(origin+'/v1/'+signal,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(body)})
 for(const [signal,body] of [['logs',logs],['metrics',metrics],['traces',traces],['profiles',profiles]])await value(await intake(signal,body))
 await value(await send('/api/porthole/v1/ingest/drain',{}))
 const unrelated=otlpLogBatch([time+10n]);unrelated.resourceLogs[0].resource.attributes=attributes('synthetic-porthole-1805@example.com')
 await value(await intake('logs',unrelated));await value(await send('/api/porthole/v1/ingest/drain',{}))
 const old=otlpLogBatch([time-20n*86400n*1000000000n]);old.resourceLogs[0].resource.attributes=attributes('synthetic-porthole-1806@example.com')
 await value(await intake('logs',old));await value(await send('/api/porthole/v1/ingest/drain',{}))
 const retention='/api/porthole/v1/retention',selection={signal:'logs',service:scope.services[0],team:scope.teams[0]}
 const thirty=await value(await send(retention+'/preview',{selection,days:30}))
 assert.equal(thirty.volumes.records,0)
 assert.equal((await send(retention+'/approve',{selection,days:30,cutoffNs:thirty.cutoffNs,confirm:'wrong'})).status,409)
 await value(await send(retention+'/approve',{selection,days:30,cutoffNs:thirty.cutoffNs,confirm:thirty.digest}))
 const reduction=await value(await send(retention+'/preview',{selection,days:15}))
 assert.equal(reduction.volumes.records,1);assert.ok(reduction.volumes.payloadBytes>0)
 const policy=await value(await get(origin,cookie,retention))
 assert.equal(policy.policies[0].days,30,'unapproved reduction changes no policy')
 assert.equal((await sql(`SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE instr(records,${literal('synthetic-porthole-1806@example.com')})>0`))[0].n,1,'unapproved reduction removes no original envelope')
 for(const days of [15,30,7]) {
  const preview=await value(await send(retention+'/preview',{selection:{...selection,signal:'traces'},days}))
  assert.match(preview.qualification,days<15?/Below/:/unproved/)
 }
 const mixedIdentifier='synthetic-porthole-1807@example.com',mixed=otlpLogBatch([time+30n,time+31n])
 mixed.resourceLogs[0].resource.attributes=attributes('synthetic-porthole-1808@example.com')
 mixed.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.push({key:'user.email',value:{stringValue:mixedIdentifier}})
 await value(await intake('logs',mixed))
 const mixedPreview=await value(await send(root,{identifier:mixedIdentifier}))
 assert.equal(mixedPreview.canApply,false)
 const mixedBefore=await sql('SELECT * FROM porthole_ingest_batches ORDER BY id')
 assert.equal((await send(root+'/apply',{identifier:mixedIdentifier,digest:mixedPreview.digest,confirm:'erase-exact-batches'})).status,409,'mixed envelope cannot erase unrelated records')
 assert.deepEqual(await sql('SELECT * FROM porthole_ingest_batches ORDER BY id'),mixedBefore,'mixedSubjectStorageUnchanged')
 const before=await savedExport(origin,cookie,await send(api+'/exports',{}))
 // One D1 read captures every custody table consistently; parallel Wrangler
 // readers contend on the same local SQLite migration connection.
 const snapshotQueries=[]
 for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive','porthole_erased_batches','porthole_archive_jobs','porthole_archive_rows','porthole_archive_chunks']) {
  const columns=await sql(`PRAGMA table_info(${table})`)
  const fields=columns.flatMap(row=>[literal(row.name),'"'+row.name+'"']).join(',')
  snapshotQueries.push(`${literal(table)},(SELECT json_group_array(json_object(${fields})) FROM (SELECT * FROM ${table} ORDER BY rowid))`)
 }
 const storage=()=>sql(`SELECT json_object(${snapshotQueries.join(',')}) AS custody`)
 const preview=await value(await send(root,{identifier}))
 assert.equal(preview.batches.length,4);assert.equal(preview.records,5)
 assert.ok((await sql(`SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE instr(records,${literal(identifier)})>0`))[0].n===4,'preview deletes nothing')
 const unapproved=await storage()
 assert.equal((await send(root+'/apply',{identifier,digest:preview.digest,confirm:'wrong'})).status,409)
 assert.deepEqual(await storage(),unapproved,'noDeletionWithoutExactApproval')
 const session=await value(await get(origin,cookie,'/auth/session'))
 const proofAt=Number((await sql(`SELECT MAX(consumed_at) AS at FROM oa_step_up_challenges WHERE session_id=${literal(session.id)}`))[0].at)
 assert.ok(proofAt>0)
 await withPinnedClock(proofAt+300001,async()=>{
  const refused=await send(root+'/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'})
  assert.equal(refused.status,403);assert.equal((await refused.json()).error,'step_up_required')
  assert.deepEqual(await storage(),unapproved,'proofOlderThanFiveMinutesRefused')
 })
 await withPinnedClock(proofAt+299000,async()=>{
  assert.equal((await send(root,{identifier})).status,200,'proofAtFourMinutesFiftyNineAccepted')
 })
 assert.equal((await fetch(origin+root,{method:'POST',headers:{origin,authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify({identifier})})).status,403)
 assert.equal((await send(root,{identifier},'')).status,401)
 assert.equal((await fetch(origin+root,{method:'POST',headers:{origin:'https://example.invalid',cookie,'content-type':'application/json'},body:JSON.stringify({identifier})})).status,403)
 const late=otlpLogBatch([time+20n]);late.resourceLogs[0].resource.attributes=attributes(identifier)
 await value(await intake('logs',late))
 const changedBefore=await storage()
 assert.equal((await send(root+'/apply',{identifier,digest:preview.digest,confirm:'erase-exact-batches'})).status,409,'a changed inventory requires a new preview')
 assert.deepEqual(await storage(),changedBefore,'changedInventoryDeletesNothing')
 const exact=await value(await send(root,{identifier}))
 assert.equal(exact.batches.length,5);assert.equal(exact.records,6,'pending original wire is part of the reviewed erasure')
 await restartWorker(()=>sql('UPDATE porthole_analytical_configuration SET changed_at=1 WHERE singleton=1'))
 const analyticalBefore=await storage()
 const analyticalRefusal=await send(root+'/apply',{identifier,digest:exact.digest,confirm:'erase-exact-batches'})
 assert.equal(analyticalRefusal.status,409);assert.equal((await analyticalRefusal.json()).error,'analytical_erasure_not_supported')
 assert.deepEqual(await storage(),analyticalBefore,'configuredAnalyticalCustodyDeletesNothing')
 await restartWorker(()=>sql('UPDATE porthole_analytical_configuration SET changed_at=0 WHERE singleton=1'))
 const noTimerBefore=await storage()
 const now=Date.now()
 await withPinnedClock(now+31*86400000,async()=>{assert.equal((await get(origin,cookie,'/health')).status,200);assert.deepEqual(await storage(),noTimerBefore,'noAutomaticExpiryOrDeletion')})
 // Age the real consumed proof so the successful 4:59 fixture does not
 // create future-dated tombstones for the later journal restore.
 const approvalAt=Date.now()
 await restartWorker(()=>sql(`UPDATE oa_step_up_challenges SET consumed_at=${approvalAt-299000} WHERE session_id=${literal(session.id)} AND consumed_at IS NOT NULL`))
 const result=await withPinnedClock(approvalAt,async()=>value(await send(root+'/apply',{identifier,digest:exact.digest,confirm:'erase-exact-batches'})))
 assert.deepEqual(result,{batchIds:exact.batches.map(row=>row.id),erasedBatches:exact.batches.length,erasedRecords:exact.records,digest:exact.digest,limitations:exact.limitations},'receiptContainsNoErasedContent')
 assert.deepEqual(result.batchIds,exact.batches.map(row=>row.id),'receiptHasExactBatchIds')
 assert.equal(result.erasedRecords,6,'proofAtFourMinutesFiftyNineAccepted')
 // Later archive reads require their own still-fresh proof after this boundary.
 cookie=await freshOwner()
 const skeletons=await sql('SELECT wire_base64,records,record_count,identity FROM porthole_ingest_batches WHERE id IN (SELECT id FROM porthole_erased_batches)')
 assert.equal(skeletons.length,5)
 assert.ok(skeletons.every(row=>row.wire_base64===''&&row.records==='[]'&&row.record_count===0&&row.identity.startsWith('erased:')),'opaque skeletons preserve nonreusable sequence watermarks without original data')
 const delivery=await value(await get(origin,cookie,'/api/porthole/v1/ingest/status'))
 const erasedSources=delivery.sources.filter(row=>row.sourceId===source.credential.id&&row.lost>0)
 assert.equal(erasedSources.reduce((n,row)=>n+row.lost,0),6)
 assert.ok(erasedSources.every(row=>row.evaluation==='Unknown'&&row.reasons.some(reason=>reason.reason==='owner_erasure')),'erasure remains explicit missing evidence')
 assert.equal((await get(origin,cookie,api+'/exports/'+before.job.id+'/manifest')).status,404,'a frozen old product export is invalidated')
 for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive','porthole_archive_rows','porthole_archive_chunks']) {
  const column=table==='porthole_ingest_batches'?'records':table==='porthole_archive_chunks'?'packet':'payload'
  assert.equal((await sql(`SELECT COUNT(*) AS n FROM ${table} WHERE instr(${column},${literal(identifier)})>0`))[0].n,0,'no mapped local payload remnants in '+table)
 }
 assert.equal((await intake('logs',logs)).status,409,'the same original wire cannot be reintroduced by retry')
 const journal=await value(await get(origin,cookie,root+'/journal'))
 assert.equal(journal.records.length,5);assert.ok(!JSON.stringify(journal).includes(identifier))
 await restartWorker();cookie=await freshOwner()
 assert.deepEqual(await value(await get(origin,cookie,root+'/journal')),journal)
 for(const signal of scope.signals) {
  const response=await value(await get(origin,cookie,'/api/porthole/v1/ingest/records?'+new URLSearchParams({signal,service:scope.services[0]})))
  assert.equal(response.records.length,signal==='logs'?2:0,'query recomputes from remaining local records')
 }
 const portable=await savedExport(origin,cookie,await send(api+'/exports',{}))
 assert.deepEqual(portable.rows.filter(row=>row.table==='porthole_erased_batches').map(row=>row.row),journal.records)
 await withEmptyDestination(async destination=>{
  const owner=await destination.freshOwner()
  const request=(path,data)=>post(destination.origin,owner,path,data)
  const apply={...journal,confirm:'apply-erasure-journal'}
  const receipt=await value(await request(root+'/journal',apply))
  assert.deepEqual(receipt,{applied:journal.records.length,batchIds:journal.records.map(row=>row.id)},'journalReceiptContainsNoErasedContent')
  await value(await request(root+'/journal',apply))
  const conflict=structuredClone(apply);conflict.records[0].content_digest='0'.repeat(64)
  assert.equal((await request(root+'/journal',conflict)).status,503,'conflicting journal cannot replace a committed content fence')
  assert.deepEqual(await value(await get(destination.origin,owner,root+'/journal')),journal)
  const restored=await value(await request(api+'/restores',{manifest:before.manifest}),201)
  for(const chunk of before.chunks)await value(await request(api+'/restores/'+restored.id+'/chunks',{chunk}))
  await value(await request(api+'/restores/'+restored.id+'/commit',{confirm:before.manifest.rootHash}))
  const selection={scope:{services:scope.services,environments:scope.environments,teams:scope.teams},signals:scope.signals,from:String(time),through:String(time+100n)}
  const exported=await value(await request('/api/porthole/v1/exports',selection),201)
  assert.equal(exported.estimate.totalRecords,1,'old archive plus later real erasure journal cannot export the erased envelopes')
  await value(await request('/api/porthole/v1/exports/'+exported.id+'/approve',{confirm:exported.id}))
  const page=await get(destination.origin,owner,'/api/porthole/v1/exports/'+exported.id+'/pages')
  assert.equal(page.status,200);assert.ok(!(await page.text()).includes(identifier))
  assert.deepEqual(await value(await get(destination.origin,owner,root+'/journal')),journal,'older archive cannot overwrite the later journal')
  assert.equal((await value(await get(destination.origin,owner,retention))).policies[0].active,0,'restored retention selection has no active approval')
  const {browserProof}=await import('./audit.mjs')
  await browserProof({origin:destination.origin,cookie:owner,paths:['/app/explore','/app/explore?'+new URLSearchParams({signal:'traces',service:scope.services[0],environment:scope.environments[0],team:scope.teams[0]})],name:'subject-erasure-restored'})
 })
 console.log('subjectErasureJourney passed: exact four-signal mapping, no-effect preview, stale approval refusal, fresh native owner authorization, pending and retained envelope deletion, retry refusal, private journal, restart and old-archive re-export fence')
}

export async function followUpArchiveJourney({origin,freshOwner,withEmptyDestination}) {
 const cookie=await freshOwner(),source=await savedExport(origin,cookie,await post(origin,cookie,api+'/exports',{}))
 const history=source.rows.filter(row=>row.table==='porthole_archive_health_history'&&['porthole_follow_up','porthole_follow_up_events'].includes(row.row.table_name))
 assert.ok(history.some(row=>row.row.table_name==='porthole_follow_up'))
 assert.ok(history.some(row=>row.row.table_name==='porthole_follow_up_events'&&JSON.parse(row.row.row).kind==='review'))
 assert.ok(history.every(row=>row.row.state==='quarantined'))
 await withEmptyDestination(async destination=>{
  const owner=await destination.freshOwner(),restore=await value(await post(destination.origin,owner,api+'/restores',{manifest:source.manifest}),201)
  for(const chunk of source.chunks)await value(await post(destination.origin,owner,`${api}/restores/${restore.id}/chunks`,{chunk}))
  await value(await post(destination.origin,owner,`${api}/restores/${restore.id}/commit`,{confirm:source.manifest.rootHash}))
  const work=await value(await get(destination.origin,owner,'/api/porthole/v1/follow-up'))
  assert.deepEqual(work,{tasks:[],events:[]},'restored task assignments and reminders remain inactive history')
  const retained=await destination.sql("SELECT row,state FROM porthole_archive_health_history WHERE table_name IN ('porthole_follow_up','porthole_follow_up_events') ORDER BY row")
  assert.deepEqual(retained,history.map(row=>({row:row.row.row,state:row.row.state})).sort((a,b)=>a.row.localeCompare(b.row)))
  const again=await savedExport(destination.origin,owner,await post(destination.origin,owner,api+'/exports',{}))
  const portable=again.rows.filter(row=>row.table==='porthole_archive_health_history'&&['porthole_follow_up','porthole_follow_up_events'].includes(row.row.table_name))
  assert.deepEqual(portable,history,'re-export retains the original inert follow-up stream')
 })
 console.log('Follow-up archive passed: exact task, handover, dissent and reminder history survives an independent inactive restore and re-export without live assignments, reminders, credentials or approval authority.')
}

export async function sloArchiveJourney({origin,freshOwner,withEmptyDestination,sloId}) {
 const cookie=await freshOwner(),packet=await savedExport(origin,cookie,await post(origin,cookie,api+'/exports',{}))
 assert.ok(packet.rows.some(row=>row.table==='porthole_slo_versions'&&row.row.id===sloId))
 await withEmptyDestination(async destination=>{
  const owner=await destination.freshOwner(),restore=await value(await post(destination.origin,owner,api+'/restores',{manifest:packet.manifest}),201)
  for(const chunk of packet.chunks)await value(await post(destination.origin,owner,`${api}/restores/${restore.id}/chunks`,{chunk}))
  await value(await post(destination.origin,owner,`${api}/restores/${restore.id}/commit`,{confirm:packet.manifest.rootHash}))
  const response=await fetch(destination.origin+'/api/porthole/v1/slos',{headers:{cookie:await destination.freshOwner()}})
  assert.equal(response.status,200);assert.deepEqual((await response.json()).versions,[])
  const exported=await savedExport(destination.origin,owner,await post(destination.origin,owner,api+'/exports',{}))
  const restored=exported.rows.filter(row=>row.table==='porthole_slo_versions')
  assert.ok(restored.some(row=>row.row.id===sloId));assert.ok(restored.every(row=>row.row.state==='quarantined'))
 })
}
