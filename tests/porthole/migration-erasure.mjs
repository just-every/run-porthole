import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const root='/api/porthole/v1/migration/erasure',archive='/api/porthole/v1/archive',records='/api/porthole/v1/migration/records'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const post=(origin,cookie,path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json',...extra},body:JSON.stringify(body)})
const get=(origin,cookie,path)=>fetch(origin+path,{headers:{cookie}})
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
async function download(origin,cookie){
 const job=await json(await post(origin,cookie,archive+'/exports',{}),201),chunks=[]
 for(let i=0;i<job.totalChunks;i++)chunks.push(await json(await get(origin,cookie,`${archive}/exports/${job.id}/chunks/${i}`)))
 return {chunks,manifest:await json(await get(origin,cookie,`${archive}/exports/${job.id}/manifest`))}
}
async function restore(origin,cookie,snapshot){
 const started=await post(origin,cookie,archive+'/restores',{manifest:snapshot.manifest})
 if(started.status!==201)return started
 const job=await json(started,201)
 for(const chunk of snapshot.chunks)await json(await post(origin,cookie,`${archive}/restores/${job.id}/chunks`,{chunk}))
 return post(origin,cookie,`${archive}/restores/${job.id}/commit`,{confirm:snapshot.manifest.rootHash})
}
const select=row=>({kind:row.targetKind,id:row.targetId,revision:row.revision})
const approve=preview=>({...preview.target,digest:preview.digest,confirm:'erase-exact-import-target'})
function withUnreviewedUpload(snapshot,bytes){
 const rows=structuredClone(snapshot.chunks.flatMap(chunk=>chunk.rows)),stream=rows.find(row=>row.table==='porthole_migration_custody').row.stream
 const id='synthetic-porthole-9561',header={id,installation_id:'porthole-migration-v1',namespace:'splunk',name:'synthetic-porthole-9561.json',bundle_sha256:hash(bytes),total_bytes:bytes.length,total_chunks:1}
 const chunk={upload_id:id,ordinal:0,sha256:hash(bytes),size:bytes.length,base64:bytes.toString('base64')}
 for(const [table,key,body]of [['ik_door_uploads',[id],header],['ik_door_chunks',[id,0],chunk]])rows.push({table:'porthole_migration_custody',row:{stream,source_table:table,source_key:JSON.stringify(key),body:JSON.stringify(body),state:'inactive'}})
 const chunks=[],size=snapshot.chunks[0].rows.length;let previousHash=snapshot.chunks[0].previousHash
 for(let offset=0;offset<rows.length;offset+=size){const base={version:1,index:chunks.length,previousHash,rows:rows.slice(offset,offset+size)};previousHash=hash(JSON.stringify(base));chunks.push({...base,digest:previousHash})}
 const manifest={...snapshot.manifest,rowCount:rows.length,chunks:chunks.length,rootHash:previousHash,tables:{...snapshot.manifest.tables,porthole_migration_custody:snapshot.manifest.tables.porthole_migration_custody+2}}
 return {manifest,chunks}
}

/** Entire fixture enters through public native import, membership and review
 * doors. SQL below only inspects custody invariants; it plants no app data. */
export async function migrationErasureJourney({withEmptyDestination,withPinnedClock,capture}) {
 await withEmptyDestination(async source=>{
  const origin=source.origin;let cookie=await source.freshOwner()
  const send=(path,body,session=cookie,extra={})=>post(origin,session,path,body,extra)
  const native=async()=> (await json(await get(origin,cookie,records))).records
  const definitions=[9550,9551,9558,9559].map(n=>({id:`synthetic-porthole-${n}`,name:`synthetic-porthole-${n}`,programText:"data('requests').sum().publish(label='A')",options:{type:'TimeSeriesChart'},tags:['team:ops']}))
  const bundle={charts:definitions},bytes=Buffer.from(JSON.stringify(bundle))
  const stage=async()=>{
   const uploaded=await json(await send('/api/operator/import/uploads',{name:'synthetic-porthole-9550.json',bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks:1,index:0,chunkSha256:hash(bytes),base64:bytes.toString('base64')},cookie,{'x-import-source':'splunk'}))
   return uploaded.uploadId
  }
  const upload=async(catchup=false)=>{
   return send('/api/operator/import/plan',{uploadId:await stage(),...catchup?{catchup:true}:{}},cookie,{'x-import-source':'splunk'})
  }
  const finish=async plan=>{
   for(let n=0;n<10;n++){
    const result=await json(await send('/api/operator/import/apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},cookie,{'x-import-source':'splunk'}))
    if(result.job.state==='completed')return
    assert.ok(['queued','applying'].includes(result.job.state))
   }
   assert.fail('synthetic import did not complete')
  }
  const plan=await json(await upload());await finish(plan)
  let peer=(await native()).find(row=>row.targetId.endsWith('9551'))
  const reviewPeer=async()=>{
   const result=await json(await send('/api/porthole/v1/migration/resolutions',{...select(peer),item:'expression-0',decision:'keep-source',confirm:'reviewed'}));peer=result.record
  }
  await reviewPeer()
  const catchup=await json(await upload(true));await finish(catchup)
  const before=await native(),target=before.find(row=>row.targetId.endsWith('9550'))
  assert.deepEqual(before.find(row=>row.targetId===peer.targetId),peer)
  const older=await download(origin,cookie)
  // An independently restored stream is opaque custody, never a revived kit
  // job. Withdrawal removes the complete unit and preserves its native peers.
  await withEmptyDestination(async destination=>{
   let owner=await destination.freshOwner()
   await json(await restore(destination.origin,owner,older))
   const restored=(await json(await get(destination.origin,owner,records))).records
   const chosen=restored.find(row=>row.targetId===target.targetId)
   const preview=await json(await post(destination.origin,owner,root,select(chosen)))
   assert.ok(preview.withdrawnInactiveUnits.length)
   await json(await post(destination.origin,owner,root+'/apply',approve(preview)))
   await destination.restartWorker();owner=await destination.freshOwner()
   const after=await json(await get(destination.origin,owner,records))
   assert.deepEqual(after.records,restored.filter(row=>row.targetId!==target.targetId))
   assert.deepEqual(after.restoredHistory,[])
   assert.equal((await destination.sql('SELECT COUNT(*) AS n FROM porthole_migration_custody'))[0].n,0)
  })
  cookie=await source.freshOwner()
  const preview=await json(await send(root,select(target)))
  assert.ok(preview.custodyReviewed.some(row=>row.store==='ik_door_plan_chunks'&&row.rows>0))
  assert.equal((await send(root,select(target),'')).status,401)
  assert.equal((await send(root,select(target),cookie,{origin:'https://synthetic-porthole.invalid'})).status,403)
  assert.equal((await send(root,select(target),cookie,{authorization:'Bearer synthetic-porthole-9553'})).status,403)
  await json(await send('/app/settings/members/invite',{email:'synthetic-porthole-9552@example.com',displayName:'Synthetic reader',role:'read-only analyst',scope:{services:['checkout'],environments:['test'],teams:['ops']}}),202)
  const member=await source.signIn('synthetic-porthole-9552@example.com')
  cookie=await source.freshOwner()
  assert.equal((await send(root,select(target),member)).status,403)
  if(withPinnedClock)await withPinnedClock(Date.now()+301000,async()=>{
   assert.equal((await send(root,select(target))).status,403,'expired identity proof deletes nothing')
   assert.equal((await send(root+'/apply',approve(preview))).status,403,'expired proof cannot approve native deletion')
  })
  assert.equal((await send(root+'/apply',{...approve(preview),confirm:'synthetic-porthole-9554'})).status,400)
  assert.equal((await send(root+'/apply',{...approve(preview),revision:'synthetic-porthole-9555'})).status,409)
  assert.equal((await send(root+'/apply',{...approve(preview),digest:hash('synthetic-porthole-9556')})).status,409)
  await reviewPeer()
  assert.equal((await send(root+'/apply',approve(preview))).status,409,'changed inventory requires another review')
  assert.deepEqual((await native()).find(row=>row.targetId===target.targetId),target)
  const current=await json(await send(root,select(target))),expected=(await native()).filter(row=>row.targetId!==target.targetId)
  const reviewInBrowser=async(page,row)=>{
   await page.getByText('Erase imported evidence',{exact:true}).click()
   await page.locator('form[action="/app/import/erasure"] select[name=targetRef]').selectOption(JSON.stringify([row.targetKind,row.targetId,row.revision]))
   await page.getByRole('button',{name:'Review import erasure',exact:true}).click()
   await page.getByRole('heading',{name:'Review import erasure',exact:true}).waitFor()
  }
  if(capture){
   await capture('move-in-erasure-preview','/app/import',async page=>{
    await reviewInBrowser(page,target)
    await page.locator('form[action="/app/import/erasure/apply"] input[name=confirm]').check()
    await page.getByRole('button',{name:'Erase reviewed import',exact:true}).focus()
   },cookie,origin)
   await capture('move-in-erasure-refused','/app/import',async page=>{
    await reviewInBrowser(page,target)
    await page.locator('input[name=digest]').evaluate(el=>{el.value='0'.repeat(64)})
    await page.locator('form[action="/app/import/erasure/apply"] input[name=confirm]').check()
    await page.getByRole('button',{name:'Erase reviewed import',exact:true}).click()
    await page.getByRole('alert').waitFor()
   },cookie,origin)
  }
  const receipt=await json(await send(root+'/apply',approve(current)))
  assert.equal(receipt.inventoryDigest,current.digest)
  assert.ok((await (await get(origin,cookie,'/api/v1/audit/export')).text()).includes(receipt.receiptId),'the committed checkpoint has a durable opaque audit fact')
  const replay=await json(await send(root+'/apply',approve(current)))
  assert.equal(replay.receiptId,receipt.receiptId);assert.equal(replay.replayed,true)
  await source.restartWorker();cookie=await source.freshOwner()
  assert.deepEqual(await native(),expected,'all unrelated native review edits survive erasure and restart')
  const earlierJournalArchive=await download(origin,cookie)
  // Each viewport confirms a different real target through the native form.
  // The preserved peer's native decision must survive both publications.
  if(capture)await capture('move-in-erasure-completed','/app/import',async page=>{
   const row=(await native()).find(row=>['9558','9559'].some(id=>row.targetId.endsWith(id)))
   assert.ok(row);await reviewInBrowser(page,row)
   await page.locator('form[action="/app/import/erasure/apply"] input[name=confirm]').check()
   await page.getByRole('button',{name:'Erase reviewed import',exact:true}).click()
   await page.getByRole('heading',{name:'Import erasure completed',exact:true}).waitFor()
   assert.ok(!(await native()).some(item=>item.targetId===row.targetId))
  },cookie,origin)
  assert.deepEqual((await native()).find(row=>row.targetId===peer.targetId),peer)
  const journal=await json(await get(origin,cookie,root+'/journal'))
  assert.equal(journal.records.length,capture?3:1)
  assert.ok(journal.records.every(row=>Object.keys(row).sort().join(',')==='erased_at,inventory_digest,receipt_id'))
  assert.ok(!JSON.stringify(journal).includes(target.targetId))
  const opaque=await source.sql('SELECT (SELECT COUNT(*) FROM ik_door_plan_chunks)+(SELECT COUNT(*) FROM ik_door_chunks)+(SELECT COUNT(*) FROM ik_door_archive_chunks)+(SELECT COUNT(*) FROM porthole_archive_rows)+(SELECT COUNT(*) FROM porthole_archive_chunks) AS n')
  assert.equal(opaque[0].n,0,'opaque source and frozen product snapshot bodies were withdrawn')
  const raw=await source.sql('SELECT bytes FROM ik_d1_original_chunks UNION ALL SELECT body AS bytes FROM ik_d1_plan_chunks UNION ALL SELECT record_json AS bytes FROM ik_provenance UNION ALL SELECT record_json AS bytes FROM ik_d1_history UNION ALL SELECT record_json AS bytes FROM ik_d1_reversal_reports')
  assert.ok(!JSON.stringify(raw).includes(definitions[0].id),'retained plan, provenance, history and reversal bodies contain no selected source record')
  const pending=await stage(),unreviewed=await send(archive+'/exports',{})
  assert.equal(unreviewed.status,409,'unplanned reupload bytes cannot enter a post-erasure archive')
  assert.equal((await unreviewed.json()).error,'migration_custody_unreviewed_after_erasure')
  const reimport=await send('/api/operator/import/plan',{uploadId:pending},cookie,{'x-import-source':'splunk'});assert.equal(reimport.status,409);assert.equal((await reimport.json()).error,'source_erased')
  assert.equal((await source.sql('SELECT COUNT(*) AS n FROM ik_door_chunks'))[0].n,0,'a refused reimport retains no newly uploaded erased bytes')
  const compatible=await download(origin,cookie),survivors=await native()
  await withEmptyDestination(async destination=>{
   const owner=await destination.freshOwner(),apply={...journal,confirm:'apply-import-erasure-journal'}
   assert.equal((await post(destination.origin,owner,root+'/journal',{...apply,confirm:'synthetic-porthole-9557'})).status,400)
   await json(await post(destination.origin,owner,root+'/journal',apply))
   await json(await post(destination.origin,owner,root+'/journal',apply))
   const refused=await restore(destination.origin,owner,older)
   assert.equal(refused.status,409,'the later journal refuses an older source archive whole')
   assert.deepEqual((await json(await get(destination.origin,owner,records))).records,[])
   assert.deepEqual(await json(await get(destination.origin,owner,root+'/journal')),journal)
   if(capture){
    const staged=await restore(destination.origin,owner,earlierJournalArchive)
    assert.equal(staged.status,409,'an archive with some earlier receipts still refuses at final commit when later checkpoints are absent')
    assert.deepEqual((await json(await get(destination.origin,owner,records))).records,[])
    assert.equal((await destination.sql('SELECT (SELECT COUNT(*) FROM porthole_archive_rows)+(SELECT COUNT(*) FROM porthole_archive_chunks) AS n'))[0].n,0,'refused old source bytes are withdrawn from restore staging')
   }
   const unreviewedRestore=await restore(destination.origin,owner,withUnreviewedUpload(compatible,bytes))
   assert.equal(unreviewedRestore.status,409,'valid archive digests cannot grant portable custody to an unreviewed post-erasure upload')
   assert.equal((await unreviewedRestore.json()).error,'migration_custody_unreviewed_after_erasure')
   assert.equal((await destination.sql('SELECT (SELECT COUNT(*) FROM porthole_archive_rows)+(SELECT COUNT(*) FROM porthole_archive_chunks) AS n'))[0].n,0)
   await json(await restore(destination.origin,owner,compatible))
   await destination.restartWorker()
   const currentOwner=await destination.freshOwner()
   assert.deepEqual((await json(await get(destination.origin,currentOwner,records))).records,survivors,'compatible post-erasure archives preserve native peers without reviving erased source records')
   assert.deepEqual(await json(await get(destination.origin,currentOwner,root+'/journal')),journal)
  })
 })
 console.log('Imported-target erasure: exact consent, changed-inventory refusal, full live, opaque and inactive custody withdrawal, preserved native review edits, source retry refusal and later-journal old-archive refusal passed')
}
