import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {form} from '/workspace/run-porthole/tests/porthole/fixture.mjs'
const root='/home/agent/rer-consolidation/work/sx-porthole-c-f466-pc1/packet/'
const wire=await readFile(root+'stock-no-value-otlp.json','utf8'),input=JSON.parse(wire)
const allPoints=d=>d.resourceMetrics.flatMap(r=>r.scopeMetrics.flatMap(s=>s.metrics.flatMap(m=>Object.values(m).filter(v=>v?.dataPoints).flatMap(v=>v.dataPoints))))
const times=allPoints(input).map(p=>BigInt(p.timeUnixNano)),from=String(times.reduce((a,b)=>a<b?a:b)-1n),through=String(times.reduce((a,b)=>a>b?a:b)+1n),query='?'+new URLSearchParams({from,through})
async function prove({origin,freshOwner,call=(path,options)=>fetch(origin+path,options),withEmptyDestination},name) {
 let cookie=await freshOwner()
 const post=async(path,data,status=200)=>{const r=await call(path,form(origin,cookie,data));assert.equal(r.status,status,await r.clone().text());return r.json()}
 const read=async path=>{const r=await call(path,{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const source=await post('/app/settings/credentials/mint',{name:'Captured stock withdrawal proof',class:'ingest',scope:{services:['checkout-kafka'],environments:['production'],teams:['commerce'],signals:['metrics'],actions:['telemetry.write']}},201)
 const intake=body=>call('/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)})
 const accepted=await intake(wire);assert.equal(accepted.status,200,await accepted.clone().text())
 for(let i=0;i<100;i++)if(!(await post('/api/porthole/v1/ingest/drain',{})).pendingBatches)break
 const path='/api/porthole/v1/ingest/records'+query+'&signal=metrics&service=checkout-kafka&limit=200',records=(await read(path)).records
 assert.equal(records.length,allPoints(input).length)
 const missing=records.filter(r=>(Number(r.payload.record.flags??0)&1)!==0)
 assert.equal(missing.length,2)
 for(const row of missing){assert.equal(Object.hasOwn(row.payload.record,'asDouble'),false);assert.equal(Object.hasOwn(row.payload.record,'asInt'),false)}
 const replay=await intake(wire);assert.equal(replay.status,200,await replay.clone().text());await post('/api/porthole/v1/ingest/drain',{})
 assert.deepEqual((await read(path)).records,records,'replayed stock withdrawal does not duplicate or fill values')
 for(const kind of ['unmarked','both-values']){
  const invalid=structuredClone(input),point=allPoints(invalid).find(p=>p.flags===1&&!Object.hasOwn(p,'asDouble')&&!Object.hasOwn(p,'asInt'))
  if(kind==='unmarked')delete point.flags;else{point.asDouble=0;point.asInt='0'}
  const refused=await intake(invalid);assert.equal(refused.status,400);assert.equal((await refused.json()).message,'missing_metric_value')
  assert.deepEqual((await read(path)).records,records,'invalid '+kind+' packet cannot persist its earlier valid points')
 }
 const evidence=await read('/api/porthole/v1/network-messaging'+query)
 assert.deepEqual(evidence.network,[],'real retained metric input alone cannot create a detached network aggregate')
 if(withEmptyDestination){const {networkArchiveJourney}=await import('/workspace/run-porthole/tests/porthole/archive.mjs');await networkArchiveJourney({origin,freshOwner,withEmptyDestination,query:query+'&snapshot='+evidence.snapshot,expected:evidence})}
 const result={name,records:records.length,missing:missing.map(r=>({name:r.payload.metric.name,flags:r.payload.record.flags,hasAsDouble:Object.hasOwn(r.payload.record,'asDouble'),hasAsInt:Object.hasOwn(r.payload.record,'asInt')})),snapshot:evidence.snapshot,accepted:accepted.status,replay:replay.status,invalidRefusals:['unmarked','both-values'],inactiveArchive:!!withEmptyDestination,recordIds:records.map(r=>r.id)}
 cookie=await freshOwner();await post('/app/settings/credentials/revoke',{id:source.credential.id});assert.equal((await intake(wire)).status,401)
 return {result,records,path,query,read}
}
export async function noValueProof(context) {
 const local=await prove(context,'local')
 const {analyticalEstate}=await import('/workspace/run-porthole/tests/porthole/analytics.mjs'),{recipientMailJourney}=await import('/workspace/run-porthole/tests/porthole/health.mjs'),{fixture}=await import('/workspace/run-porthole/tests/porthole/fixture.mjs')
 const estate=await analyticalEstate();let primary,standby
 try {await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async ctx=>{
  const sql=async statement=>(await ctx.getDb().prepare(statement).all()).results,restartWorker=async change=>{await change?.();await ctx.restart()}
  const helpers=fixture({origin:ctx.origin,sql,restartWorker,sessionSecret:ctx.sessionSecret,ownerEmail:ctx.ownerEmail,call:ctx.call})
  let cookie=await helpers.freshOwner()
  const get=async path=>{const r=await ctx.call(path,{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()}
  const configure=async role=>{cookie=await helpers.freshOwner();const c=await get('/api/porthole/v1/analytics/configuration');const r=await ctx.call('/api/porthole/v1/analytics/configuration',form(ctx.origin,cookie,{revision:c.revision,role,enabled:true,confirm:'connect-analytical-workers'}));assert.equal(r.status,200,await r.clone().text())}
  await configure('primary');const p=await prove({origin:ctx.origin,call:ctx.call,...helpers},'primary');primary=p.result
  await configure('standby');const rows=(await get(p.path)).records;assert.deepEqual(rows,p.records,'both real analytical workers preserve the missing-value markers exactly');standby={name:'standby',records:rows.length,missing:rows.filter(r=>(Number(r.payload.record.flags??0)&1)!==0).length}
 }})}finally{await estate.dispose()}
 await writeFile(root+'no-value-fix-receipt.json',JSON.stringify({executionBaseHead:process.env.PORTHOLE_PROBE_HEAD,normalizerSha256:createHash('sha256').update(await readFile('/workspace/run-porthole/src/porthole/ingest/normalize.ts')).digest('hex'),wireSha256:createHash('sha256').update(wire).digest('hex'),local:local.result,primary,standby,source:'captured unchanged from the pinned stock receiver before repair'},null,2)+'\n')
 console.log('PROBE PORT-060 stock withdrawal: original NO_RECORDED_VALUE packet -> 200 and replay 200; two absent numerical values retained, never zero; unmarked and dual-value input refused without partial persistence; native inactive archive and both real analytical copies preserve the markers; revoked source returns 401')
}
