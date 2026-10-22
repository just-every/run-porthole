import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {literal} from './fixture.mjs'

const history='/api/porthole/v1/storage/history',archive='/api/porthole/v1/archive'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const get=(origin,cookie,path,method='GET')=>fetch(origin+path,{method,headers:{cookie}})
const post=(origin,cookie,path,data)=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
const upload=(origin,cookie,entry,path=history,extra={})=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':entry.type,'x-porthole-source':entry.source,'x-porthole-history':entry.label,...extra},body:entry.bytes})
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}
async function exportHistory(origin,cookie){
 const job=await value(await post(origin,cookie,archive+'/exports',{}),201),chunks=[]
 for(let index=0;index<job.totalChunks;index++)chunks.push(await value(await get(origin,cookie,`${archive}/exports/${job.id}/chunks/${index}`)))
 const manifest=await value(await get(origin,cookie,`${archive}/exports/${job.id}/manifest`))
 return {chunks,manifest,rows:chunks.flatMap(chunk=>chunk.rows)}
}
async function originalBytes(origin,cookie,reference,bytes){
 const response=await get(origin,cookie,`${history}/${reference.id}/content`)
 assert.equal(response.status,200)
 assert.equal(response.headers.get('x-porthole-sha256'),hash(bytes))
 assert.equal(response.headers.get('x-porthole-source'),reference.source_label)
 assert.equal(response.headers.get('x-porthole-history'),reference.history_label)
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes,'read returns the original open-format bytes, without normalization')
 const head=await get(origin,cookie,`${history}/${reference.id}/content`,'HEAD')
 assert.equal(head.status,200)
 assert.match(head.headers.get('x-porthole-operation')??'',/^[a-f0-9-]{36}$/,'HEAD history reads retain the inherited private-audit boundary')
 assert.equal(Number(head.headers.get('content-length')),bytes.length)
 assert.equal((await head.arrayBuffer()).byteLength,0)
}

/** Public HTTP with actual installation R2/D1 bindings. No object or reference
 * rows are planted. Native sign-in helpers substitute only the mail/grant edge. */
export async function bucketHistoryJourney({origin,freshOwner,restartWorker,withEmptyDestination,sql,signIn}){
 let cookie=await freshOwner()
 const corpus=[
  {type:'application/json',source:'synthetic-porthole-900',label:'synthetic-porthole-901',bytes:Buffer.from('{ "history": [{ "signal": "logs", "message": "synthetic-porthole-902" }] }\n')},
  {type:'application/x-ndjson',source:'synthetic-porthole-903',label:'synthetic-porthole-904',bytes:Buffer.from('{"signal":"metrics","value":4}\n{"signal":"traces","value":7}\n')},
  {type:'text/csv',source:'synthetic-porthole-905',label:'synthetic-porthole-906',bytes:Buffer.from('signal,value\r\nlogs,"synthetic-porthole-907"\r\n')},
 ]
 assert.equal((await get(origin,'',history)).status,401)
 assert.equal((await fetch(origin+history,{headers:{authorization:'Bearer synthetic-porthole-908'}})).status,403)
 const forged=await upload(origin,cookie,corpus[0],history,{origin:'https://synthetic-porthole.invalid'})
 assert.equal(forged.status,403)
 // Use an existing real product member and its normal native confirmation.
 const member=(await sql("SELECT o.email FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND m.role!='owner' LIMIT 1"))[0]
 assert.ok(member,'runtime membership journey supplies a current non-owner')
 const memberCookie=await signIn(member.email)
 assert.equal((await get(origin,memberCookie,history)).status,403)
 assert.equal((await upload(origin,memberCookie,corpus[0])).status,403)
 const references=[]
 for(const entry of corpus){
  const reference=await value(await upload(origin,cookie,entry),201)
  assert.equal(reference.sha256,hash(entry.bytes));assert.equal(reference.byte_count,entry.bytes.length)
  assert.equal(reference.source_label,entry.source);assert.equal(reference.history_label,entry.label)
  assert.equal(reference.source_binding,'ARCHIVE_BUCKET')
  references.push(reference)
  await originalBytes(origin,cookie,reference,entry.bytes)
  assert.equal((await get(origin,memberCookie,`${history}/${reference.id}/content`)).status,403)
  assert.equal((await upload(origin,cookie,{...entry,bytes:Buffer.from('synthetic-porthole-909')},`${history}/${reference.id}`)).status,405,'historical objects have no overwrite door')
 }
 await restartWorker();cookie=await freshOwner()
 const listing=await value(await get(origin,cookie,history))
 for(const reference of references)assert.deepEqual(listing.references.find(row=>row.id===reference.id),reference)
 const snapshot=await exportHistory(origin,cookie)
 assert.deepEqual(snapshot.rows.filter(row=>row.table==='porthole_bucket_history').map(row=>row.row).sort((a,b)=>a.id.localeCompare(b.id)),references.slice().sort((a,b)=>a.id.localeCompare(b.id)))
 for(let index=0;index<references.length;index++)await originalBytes(origin,cookie,references[index],corpus[index].bytes)
 assert.equal(typeof withEmptyDestination,'function','requires a separately migrated D1 and R2 destination')
 await withEmptyDestination(async destination=>{
  let targetCookie=await destination.freshOwner()
  const target=destination.origin,job=await value(await post(target,targetCookie,archive+'/restores',{manifest:snapshot.manifest}),201)
  const first=snapshot.chunks[0]
  await value(await post(target,targetCookie,`${archive}/restores/${job.id}/chunks`,{chunk:first}))
  await destination.restartWorker();targetCookie=await destination.freshOwner()
  await value(await post(target,targetCookie,`${archive}/restores/${job.id}/chunks`,{chunk:first}))
  for(const chunk of snapshot.chunks.slice(1))await value(await post(target,targetCookie,`${archive}/restores/${job.id}/chunks`,{chunk}))
  await value(await post(target,targetCookie,`${archive}/restores/${job.id}/commit`,{confirm:snapshot.manifest.rootHash}))
  const restored=await value(await get(target,targetCookie,history))
  assert.deepEqual(restored.references,references.map(row=>({...row,state:'quarantined'})).sort((a,b)=>a.id.localeCompare(b.id)))
  for(const reference of references){
   assert.equal((await get(target,targetCookie,`${history}/${reference.id}/content`)).status,409)
   assert.equal((await get(target,targetCookie,`${history}/${reference.id}/content`,'HEAD')).status,409)
  }
  const firstRef=references[0]
  const missing=await post(target,targetCookie,`${history}/${firstRef.id}/reauthorize`,{confirm:'reauthorize-history',sha256:firstRef.sha256})
  assert.equal(missing.status,409,'archived reference cannot silently reuse source bucket access')
  const owner=(await destination.sql("SELECT id,email FROM oa_operators WHERE role='owner' AND status='active'"))[0]
  await destination.mutate(`UPDATE oa_sessions SET created_at=1 WHERE operator_id=${literal(owner.id)}; UPDATE oa_step_up_challenges SET consumed_at=1 WHERE operator_id=${literal(owner.id)};`)
  const stale=await upload(target,targetCookie,corpus[0],`${history}/${firstRef.id}/reauthorize`,{'x-porthole-confirm':'reauthorize-history'})
  assert.equal(stale.status,403,'a current native session without fresh proof cannot authorize restored reads')
  assert.equal((await stale.json()).error,'step_up_required')
  targetCookie=await destination.signIn(owner.email)
  const corrupt={...corpus[0],bytes:Buffer.from(corpus[0].bytes)};corrupt.bytes[0]^=1
  const rejected=await upload(target,targetCookie,corrupt,`${history}/${firstRef.id}/reauthorize`,{'x-porthole-confirm':'reauthorize-history'})
  assert.equal(rejected.status,422,'destination reattachment must match the original bytes')
  assert.equal((await get(target,targetCookie,`${history}/${firstRef.id}/content`)).status,409)
  for(let index=0;index<references.length;index++){
   const reference=references[index]
   const authorized=await value(await upload(target,targetCookie,corpus[index],`${history}/${reference.id}/reauthorize`,{'x-porthole-confirm':'reauthorize-history'}))
   assert.deepEqual(authorized,{...reference,state:'active'})
   await originalBytes(target,targetCookie,authorized,corpus[index].bytes)
  }
  await destination.restartWorker()
  for(let index=0;index<references.length;index++)await originalBytes(target,targetCookie,references[index],corpus[index].bytes)
  const exported=await exportHistory(target,targetCookie)
  assert.deepEqual(exported.rows.filter(row=>row.table==='porthole_bucket_history').map(row=>row.row),snapshot.rows.filter(row=>row.table==='porthole_bucket_history').map(row=>row.row))
 })
 return {references,corpus}
}
