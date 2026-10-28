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
  for(let i=0;i<count;i+=250){
   await send(bodies.slice(i,i+250),label+'-'+i,base+BigInt(i))
   await value(await post(intake+'/drain',{}))
  }
 }
 const firstFrom=String(at),firstThrough=String(at+BigInt(count)+1n)
 await emit(at,'synthetic-porthole-12010')
 let stats=await value(await post(api+'/accounting',{definition:d,from:firstFrom,through:firstThrough}))
 assert.equal(stats.retained.records,count);assert.equal(stats.excluded.records,0,'unapproved exclusion drops nothing')
 await activate(await preview(proposed,['{"level":"debug"}','{"level":"error"}']))
 const second=at+BigInt(count+100),from=String(second),through=String(second+BigInt(count)+1n)
 await emit(second,'synthetic-porthole-12011')
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
 const predicted=expectedBytes/(1024**3)*(stats.rateModel.indexed+stats.rateModel.archive+stats.rateModel.egress)
 assert.ok(Math.abs(stats.retained.usd-predicted)<=Math.max(predicted*0.01,Number.EPSILON),'projection reconciles within one percent')
 const totals=await value(await post(api+'/metrics',{definition:d,from,through}))
 assert.equal(totals.groups.filter(g=>g.name==='checkout.logs').reduce((sum,g)=>sum+g.count,0),count,'configured pre-exclusion metric retains complete accepted count')
 assert.equal((await sql(`SELECT COUNT(*) AS n FROM porthole_telemetry_archive WHERE service=${literal(d.service)} AND event_time_ns>=${literal(from.padStart(20,'0'))} AND event_time_ns<${literal(through.padStart(20,'0'))}`))[0].n,retained)
 console.log('PORTHOLE_PIPELINE_EXCLUSION '+JSON.stringify({count,excluded,retained,result:'passed',head:process.env.PORTHOLE_CANDIDATE_SHA??null}))
}
