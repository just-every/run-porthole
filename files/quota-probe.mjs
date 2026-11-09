// Focused diagnostic through the emitted Worker's real mint and OTLP doors.
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
const load=path=>import(pathToFileURL(process.cwd()+'/'+path).href)
const {recipientMailJourney}=await load('tests/porthole/health.mjs')
const {otlpLogBatch,ingestScope}=await load('tests/porthole/ingest.mjs')
const receipt={probe:'duplicate OTLP intake consumes credential request quota',cases:[]}
await recipientMailJourney({run:async({call,post,getDb,cookie})=>{
 const mint=async extra=>{
  const response=await post('/app/settings/credentials/mint',{name:'synthetic-porthole-replay-quota',class:'ingest',scope:ingestScope,...extra},201)
  return response.json()
 }
 const packet=JSON.stringify(otlpLogBatch([BigInt(Date.now()-1000)*1000000n]))
 const send=source=>call('/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':'synthetic-porthole-replay-quota'},body:packet})
 const ordinary=await mint({})
 const burst=await mint({requestsPerMinute:10000,acceptedBytesPerMinute:64*1024*1024})
 // Seed the same already-spent minute reached after earlier collector windows.
 // HTTP admission, duplicate recognition and refusals remain the real product.
 const db=getDb()
 const minute=Math.floor(Date.now()/60000)
 for(const [name,source,expected] of [['ordinary',ordinary,[200,429]],['fixture-burst',burst,[200,200]]]){
  await db.prepare('UPDATE porthole_credentials SET minute=?,minute_requests=599 WHERE id=?').bind(minute,source.credential.id).run()
  const responses=[]
  for(const status of expected){
   const response=await send(source)
   assert.equal(response.status,status,await response.clone().text())
   if(status===429){assert.deepEqual(await response.json(),{code:8,message:'credential_quota_exceeded'});assert.ok(Number(response.headers.get('retry-after'))>0)}
   responses.push(status)
  }
  const usage=await db.prepare('SELECT minute_requests,minute_bytes FROM porthole_credentials WHERE id=?').bind(source.credential.id).first()
  const batches=await db.prepare('SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE source_id=?').bind(source.credential.id).first()
  assert.equal(batches.n,1,'both replays retain exactly one source batch')
  assert.equal(usage.minute_requests,name==='ordinary'?600:601)
  receipt.cases.push({name,responses,usage,batches:batches.n,configuredQuota:source.credential.quotas})
 }
 await post('/api/porthole/v1/ingest/drain',{})
}})
receipt.result='passed'
await writeFile(new URL('quota-receipt.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n')
console.log('PASS replay quota: ordinary already-spent minute returns 200 then 429; finite fixture quota returns 200 twice; duplicate custody remains one batch.')
