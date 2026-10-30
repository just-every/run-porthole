import assert from 'node:assert/strict'
import {literal} from './fixture.mjs'
export async function pipelineExclusion({post,value,preview,activate,send,d,sql,at,count}) {
 const intake='/api/porthole/v1/ingest',api='/api/porthole/v1/pipelines'
 const excluded=count/5,retained=count-excluded
 const proposed={...d,exclude:{field:'level',equals:'debug'}}
 // Rejection is leaving a preview unapproved: all records keep the original policy.
 await preview(proposed,['{"level":"debug"}'])
 const bodies=Array.from({length:count},(_,i)=>JSON.stringify({level:i<excluded||i===count-1?'debug':'info',message:'Checkout US order '+i,...(i===count-1?{protectedError:true}:{})}))
 async function emit(base,label) {
  const batches=[]
  for(let i=0;i<count;i+=250){
   batches.push((await send(bodies.slice(i,i+250),label+'-'+i,base+BigInt(i))).id)
   await value(await post(intake+'/drain',{}))
  }
  return batches
 }
 const firstFrom=String(at),firstThrough=String(at+BigInt(count)+1n)
 await emit(at,'synthetic-porthole-12010')
 let stats=await value(await post(api+'/accounting',{definition:d,from:firstFrom,through:firstThrough}))
 assert.equal(stats.retained.records,count);assert.equal(stats.excluded.records,0,'unapproved exclusion drops nothing')
 const original=[];let originalCursor,originalSnapshot
 do {
  const page=await value(await post('/api/porthole/v1/query',{signal:'logs',service:d.service,environment:d.environment,team:d.team,from:firstFrom,through:firstThrough,limit:200,...(originalCursor?{cursor:originalCursor,snapshot:originalSnapshot}:{})}))
  original.push(...page.records);originalCursor=page.cursor;originalSnapshot=page.snapshot
 }while(originalCursor)
 assert.equal(original.length,count,'rejecting the proposal keeps every input queryable')
 assert.equal(original[0].payload.record.body.stringValue,bodies[0],'rejected exclusion preserves the actual original body')
 const approved=await activate(await preview(proposed,['{"level":"debug"}','{"level":"error"}']))
 // Reconcile the omitted bytes against the independently retained rejection
 // cohort, whose source bodies are the same. Revision and exclusion metadata
 // are explicit; receipt-clock widths can vary within the named 1% tolerance.
 const excludedReferenceBytes=original.slice(0,excluded).reduce((n,row)=>n+Buffer.byteLength(JSON.stringify({...row.payload,pipeline:{...row.payload.pipeline,revision:approved.revision,excluded:true}})),0)
 const second=at+BigInt(count+100),from=String(second),through=String(second+BigInt(count)+1n)
 const appliedBatches=await emit(second,'synthetic-porthole-12011')
 const queued=(await sql(`SELECT records,wire_base64 FROM porthole_ingest_batches WHERE id=${literal(appliedBatches[0])}`))[0]
 const discarded=JSON.parse(queued.records).filter(r=>r.payload.pipeline.excluded)
 assert.ok(discarded.length>0&&discarded.every(r=>r.payload.record===undefined&&r.payload.pipeline.excludedPayloadBytes>0),'discarded bodies do not survive in the durable queue')
 assert.ok(!Buffer.from(queued.wire_base64,'base64').toString().includes('Checkout US order 0'),'discarded bodies do not survive in decoded durable wire')
 stats=await value(await post(api+'/accounting',{definition:d,from,through}))
 assert.equal(stats.excluded.records,excluded);assert.equal(stats.retained.records,retained)
 const selected=[];let cursor,snapshot
 do {
  const page=await value(await post('/api/porthole/v1/query',{signal:'logs',service:d.service,environment:d.environment,team:d.team,from,through,limit:200,...(cursor?{cursor,snapshot}:{})}))
  selected.push(...page.records);cursor=page.cursor;snapshot=page.snapshot
 }while(cursor)
 assert.equal(selected.length,retained);assert.ok(selected.some(r=>r.payload.pipeline.protected&&r.payload.record.severityNumber===17),'protected errors survive exclusion')
 const expectedBytes=selected.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row.payload)),0)
 assert.equal(stats.retained.indexedBytes,expectedBytes);assert.equal(stats.retained.archiveBytes,expectedBytes);assert.equal(stats.retained.egressBytes,expectedBytes)
 const rates=stats.rateModel.indexed+stats.rateModel.archive+stats.rateModel.egress
 const predicted=expectedBytes/(1024**3)*rates
 assert.ok(Math.abs(stats.retained.usd-predicted)<=Math.max(predicted*0.01,Number.EPSILON),'retained projection reconciles within one percent')
 for(const dimension of ['indexedBytes','archiveBytes','egressBytes']) {
  assert.ok(Math.abs(stats.excluded[dimension]-excludedReferenceBytes)<=excludedReferenceBytes*0.01,'excluded '+dimension+' reconciles to the retained original cohort within one percent')
 }
 const excludedUsd=excludedReferenceBytes/(1024**3)*rates
 assert.ok(Math.abs(stats.excluded.usd-excludedUsd)<=Math.max(excludedUsd*0.01,Number.EPSILON),'excluded projected USD reconciles to the omitted original records within one percent')
 const totals=await value(await post(api+'/metrics',{definition:d,from,through}))
 assert.equal(totals.groups.filter(g=>g.name==='checkout.logs').reduce((sum,g)=>sum+g.count,0),count,'configured pre-exclusion metric retains complete accepted count')
 assert.equal((await sql(`SELECT COUNT(*) AS n FROM porthole_telemetry_archive WHERE service=${literal(d.service)} AND event_time_ns>=${literal(from.padStart(20,'0'))} AND event_time_ns<${literal(through.padStart(20,'0'))}`))[0].n,retained)
 console.log('PORTHOLE_PIPELINE_EXCLUSION '+JSON.stringify({count,excluded,retained,result:'passed',head:process.env.PORTHOLE_CANDIDATE_SHA??null}))
}
