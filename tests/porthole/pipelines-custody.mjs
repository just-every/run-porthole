import assert from 'node:assert/strict'
import {form,literal} from './fixture.mjs'
export async function pipelineCustody({origin,cookie,sql,restartWorker,withEmptyDestination,planted,source,definition,from,through,post,value}) {
 const hot=await sql(`SELECT payload FROM porthole_telemetry_records WHERE source_id=${literal(source.credential.id)}`)
 const archive=await sql(`SELECT payload FROM porthole_telemetry_archive WHERE source_id=${literal(source.credential.id)}`)
 assert.equal(hot.length,5);assert.equal(archive.length,5)
 const exported=await value(await post('/api/porthole/v1/exports',{scope:{services:[definition.service],environments:[definition.environment],teams:[definition.team]},signals:['logs'],from,through,pageSize:50}),201)
 await value(await post('/api/porthole/v1/exports/'+exported.id+'/approve',{confirm:exported.id}))
 const page=await fetch(origin+'/api/porthole/v1/exports/'+exported.id+'/pages',{headers:{cookie}});assert.equal(page.status,200)
 const signalText=await page.text();assert.equal(signalText.trim().split('\n').length,5)
 const api='/api/porthole/v1/archive',job=await value(await post(api+'/exports',{}),201),chunks=[]
 for(let i=0;i<job.totalChunks;i++)chunks.push(await value(await fetch(origin+api+'/exports/'+job.id+'/chunks/'+i,{headers:{cookie}})))
 const manifest=await value(await fetch(origin+api+'/exports/'+job.id+'/manifest',{headers:{cookie}}))
 const serialized=JSON.stringify({hot,archive,chunks,signalText,audit:await value(await fetch(origin+'/api/v1/audit/export',{headers:{cookie}}))})
 for(const secret of [...planted,Buffer.from(planted[11]).toString('base64')])assert.ok(!serialized.includes(secret),'sanitized hot, archive, product export, signal export and audit custody')
 const rows=chunks.flatMap(c=>c.rows)
 assert.ok(rows.some(r=>r.table==='porthole_pipeline_versions'));assert.ok(rows.some(r=>r.table==='porthole_log_metric_points'))
 assert.ok(!serialized.includes(source.secret),'credential does not enter portable custody')
 await withEmptyDestination(async({origin:destination,cookie:destCookie,sql:destSql})=>{
  const call=(path,data)=>fetch(destination+path,form(destination,destCookie,data))
  const restore=await value(await call(api+'/restores',{manifest}),201)
  for(const chunk of chunks)await value(await call(api+'/restores/'+restore.id+'/chunks',{chunk}))
  await value(await call(api+'/restores/'+restore.id+'/commit',{confirm:manifest.rootHash}))
  const versions=await destSql('SELECT revision,state FROM porthole_pipeline_versions')
  assert.ok(versions.length>=3&&versions.every(v=>v.state==='quarantined'),'restore retains history without activating authority')
  assert.equal((await destSql('SELECT COUNT(*) AS n FROM porthole_log_metric_points'))[0].n,6)
  const state=await value(await fetch(destination+'/api/porthole/v1/pipelines',{headers:{cookie:destCookie}}))
  assert.equal(state.definition,null,'restored active policy requires new exact review')
 })
}
