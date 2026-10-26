import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const api='/api/porthole/v1/archive',migration='/api/porthole/v1/migration/records'
const hash=value=>createHash('sha256').update(value).digest('hex')
const post=(origin,cookie,path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json',...extra},body:JSON.stringify(body)})
const get=(origin,cookie,path)=>fetch(origin+path,{headers:{cookie}})
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
const retained=archive=>archive.rows.filter(row=>row.table==='porthole_migration_custody').map(row=>row.row)
const records=archive=>archive.rows.filter(row=>row.table==='porthole_migration_records').map(row=>row.row)
async function download(origin,cookie){
 const job=await json(await post(origin,cookie,api+'/exports',{}),201),chunks=[]
 for(let index=0;index<job.totalChunks;index++)chunks.push(await json(await get(origin,cookie,`${api}/exports/${job.id}/chunks/${index}`)))
 const manifest=await json(await get(origin,cookie,`${api}/exports/${job.id}/manifest`))
 return {job,chunks,manifest,rows:chunks.flatMap(chunk=>chunk.rows)}
}
/** Called inside migrationJourney, using its real source plans, reviewed native
 * decisions and independently migrated destination. No direct fixture writes. */
export async function migrationCustodyJourney({origin,cookie,sql,restartWorker,freshOwner,withEmptyDestination,capture}){
 cookie=await freshOwner()
 const before=(await json(await get(origin,cookie,migration))).records
 assert.ok(before.some(row=>Object.keys(row.value.humanResolutions??{}).length),'migration fixture supplies later native review edits')
 // Exact uploaded bytes containing credentials must never enter an export.
 const bytes=Buffer.from(JSON.stringify({charts:[{id:'synthetic-porthole-9540',name:'Credential exclusion',apiKey:'synthetic-porthole-9541'}]}))
 const headers={'x-import-source':'splunk'}
 const upload=await json(await post(origin,cookie,'/api/operator/import/uploads',{name:'synthetic-porthole-9540.json',bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash(bytes),base64:bytes.toString('base64')},headers))
 const refused=await post(origin,cookie,api+'/exports',{})
 assert.equal(refused.status,422);assert.equal((await refused.json()).error,'migration_custody_holds_credentials')
 // The ordinary reader removes credential-bearing source bytes, including on
 // a pending-plan refusal; it retains no copied source credential.
 const screened=await post(origin,cookie,'/api/operator/import/plan',{uploadId:upload.uploadId},headers)
 assert.ok([200,409].includes(screened.status),await screened.clone().text())
 cookie=await freshOwner()
 const job=await json(await post(origin,cookie,api+'/exports',{}),201),chunks=[]
 assert.ok(job.totalChunks>1)
 chunks.push(await json(await get(origin,cookie,`${api}/exports/${job.id}/chunks/0`)))
 await restartWorker();cookie=await freshOwner()
 assert.deepEqual(await json(await get(origin,cookie,`${api}/exports/${job.id}/chunks/0`)),chunks[0],'frozen source custody survives export restart and exact replay')
 for(let index=1;index<job.totalChunks;index++)chunks.push(await json(await get(origin,cookie,`${api}/exports/${job.id}/chunks/${index}`)))
 const manifest=await json(await get(origin,cookie,`${api}/exports/${job.id}/manifest`)),source={job,chunks,manifest,rows:chunks.flatMap(chunk=>chunk.rows)},custody=retained(source)
 const sourcePlans=custody.filter(row=>row.source_table==='ik_door_plans').map(row=>JSON.parse(row.body))
 assert.ok(sourcePlans.length>1,'complete prior plan history is retained')
 assert.equal(custody.filter(row=>row.source_table==='ik_jobs').length,(await sql('SELECT COUNT(*) AS n FROM ik_jobs'))[0].n)
 assert.equal(records(source).length,before.length)
 for(const row of records(source))assert.deepEqual({targetKind:row.kind,targetId:row.id,value:JSON.parse(row.body),revision:row.revision},before.find(value=>value.targetKind===row.kind&&value.targetId===row.id))
 assert.ok(custody.some(row=>row.source_table==='ik_d1_reversal_reports'),'preserved Undo dispositions are private archive evidence')
 assert.ok(custody.some(row=>row.source_table==='ik_d1_original_chunks'),'retained exact original source snapshots are present')
 assert.ok(!JSON.stringify(source).includes('synthetic-porthole-9541'))
 for(const row of custody){
  assert.equal(row.state,'inactive')
  const body=JSON.parse(row.body)
  if(row.source_table==='ik_jobs')assert.ok(!Object.hasOwn(body,'lease_token')&&!Object.hasOwn(body,'lease_expires'))
  if(row.source_table==='ik_door_approval_history')assert.ok(!Object.hasOwn(body,'owner')&&!Object.hasOwn(body,'approval_id')&&!Object.hasOwn(body,'reviewer'))
 }
 assert.ok(!custody.some(row=>['ik_door_grants','ik_door_approvals','ik_door_settings'].includes(row.source_table)))
 assert.equal((await post(origin,cookie,api+'/restores',{manifest})).status,409,'source installation is not an empty restore target')
 await withEmptyDestination(async destination=>{
  const target=destination.origin;let owner=await destination.freshOwner()
  const originalOwner=(await destination.sql("SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0].id
  // A valid chain digest cannot grant an unimplemented custody domain.
  const bad=await json(await post(target,owner,api+'/restores',{manifest}),201)
  const badIndex=chunks.findIndex(chunk=>chunk.rows.some(row=>row.table==='porthole_migration_custody'))
  for(let index=0;index<badIndex;index++)await json(await post(target,owner,`${api}/restores/${bad.id}/chunks`,{chunk:chunks[index]}))
  const changed=structuredClone(chunks[badIndex]),unsupported=changed.rows.find(row=>row.table==='porthole_migration_custody');unsupported.row.source_table='ik_unqualified_domain'
  const {digest:_digest,...base}=changed;changed.digest=hash(JSON.stringify(base))
  assert.equal((await post(target,owner,`${api}/restores/${bad.id}/chunks`,{chunk:changed})).status,422)
  assert.equal((await json(await get(target,owner,migration))).records.length,0,'invalid custody publishes no native records')
  const restore=await json(await post(target,owner,api+'/restores',{manifest}),201)
  await json(await post(target,owner,`${api}/restores/${restore.id}/chunks`,{chunk:chunks[0]}))
  await destination.restartWorker();owner=await destination.freshOwner()
  await json(await post(target,owner,`${api}/restores/${restore.id}/chunks`,{chunk:chunks[0]}))
  for(let index=1;index<chunks.length;index++)await json(await post(target,owner,`${api}/restores/${restore.id}/chunks`,{chunk:chunks[index]}))
  assert.equal((await json(await get(target,owner,migration))).records.length,0,'staging remains invisible')
  assert.equal((await post(target,owner,`${api}/restores/${restore.id}/commit`,{confirm:'synthetic-porthole-9542'})).status,400)
  const committed=await json(await post(target,owner,`${api}/restores/${restore.id}/commit`,{confirm:manifest.rootHash}));assert.equal(committed.state,'committed')
  await destination.restartWorker();owner=await destination.freshOwner()
  const restored=await json(await get(target,owner,migration))
  assert.deepEqual(restored.records,before,'independent restore preserves exact immutable definitions and later native review revisions')
  assert.equal(restored.restoredHistory.length,sourcePlans.length)
  for(const entry of restored.restoredHistory){assert.equal(entry.state,'inactive');assert.equal(entry.destinationConsentRequired,true);assert.equal(entry.fingerprint,sourcePlans.find(plan=>plan.id===entry.planId).fingerprint)}
  for(const table of ['ik_jobs','ik_door_plans','ik_door_approvals','ik_door_grants','porthole_credentials'])assert.equal((await destination.sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n,0,'restore creates no live authority in '+table)
  assert.equal((await destination.sql("SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0].id,originalOwner)
  assert.equal((await destination.sql('SELECT paused FROM porthole_ingest_control WHERE singleton=1'))[0].paused,1)
  for(const action of ['apply','undo']){
   const plan=sourcePlans.find(plan=>plan.job_id)
   const response=await post(target,owner,'/api/operator/import/'+action,{planId:plan.id,...action==='apply'?{reviewedFingerprint:plan.fingerprint}:{}},{'x-import-source':plan.namespace})
   assert.equal(response.status,409);assert.equal((await response.json()).error,'restored_import_requires_fresh_preview')
  }
  assert.deepEqual((await json(await get(target,owner,migration))).records,before,'source approval cannot overwrite or undo restored native edits')
  await capture('move-in-restored-custody','/app/import',async page=>{assert.ok(await page.getByRole('heading',{name:'Restored import history',exact:true}).isVisible());assert.match(await page.locator('body').innerText(),/Source approval authority never transfers/);await page.getByRole('heading',{name:'Restored import history',exact:true}).scrollIntoViewIfNeeded()},owner,target)
  const again=await download(target,owner)
  assert.deepEqual(records(again),records(source))
  assert.deepEqual(retained(again),custody,'re-export preserves every custody row without acquiring destination authority')
 })
 console.log('Imported-source custody: credential exclusion, frozen complete history, cold streaming resume, independently owned inactive restore, exact native review edits and no restored approval authority passed')
}
