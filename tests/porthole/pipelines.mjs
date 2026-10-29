import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {form,literal} from './fixture.mjs'
import {otlpLogBatch} from './ingest.mjs'
import {pipelineBrowser} from './pipelines-browser.mjs'
import {pipelineCustody} from './pipelines-custody.mjs'
const api='/api/porthole/v1/pipelines',intake='/api/porthole/v1/ingest'
export async function pipelineJourney({origin,freshOwner,sql,restartWorker,withEmptyDestination,signIn}) {
 let cookie=await freshOwner()
 const post=(path,data,who=cookie)=>fetch(origin+path,form(origin,who,data))
 const value=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json()}
 const get=async path=>value(await fetch(origin+path,{headers:{cookie}}))
 const catalog=await get(api+'/catalog')
 const d={service:'synthetic-porthole-12000',environment:'production',team:'payments',processors:[catalog.processors.find(p=>p.type==='json').example,{type:'status',source:'level'}],metrics:[{name:'checkout.logs'},{name:'checkout.errors',field:'status',equals:'error'}],redaction:[{pattern:'private-[0-9]{4}',exceptions:['private-0000']}]}
 const scope={services:[d.service],environments:[d.environment],teams:[d.team]}
 const source=await value(await post('/app/settings/credentials/mint',{name:'synthetic-porthole-12001',class:'ingest',scope:{...scope,signals:['logs'],actions:['telemetry.write']}}),201)
 const preview=async(definition=d,samples=[],revision)=>value(await post(api+'/preview',{definition,samples,revision:revision??(await get(api)).revision}),201)
 const activate=async p=>value(await post(api+'/activate',{previewId:p.id,digest:p.digest,confirm:'activate-pipeline'}),201)
 const at=BigInt(Date.now())*1000000n-5000000000n
 const planted=['123'+'-45-'+'6789','4111'+'1111'+'1111'+'1111','+1 (415) 555'+'-0123',['synthetic-porthole-12002','example.invalid'].join(String.fromCharCode(64)),'192'+'.0.2.6','private-1234','synthetic-porthole-12006',Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from('{"private":"synthetic-porthole-12007"}').toString('base64url')+'.synthetic-porthole-12008','2001'+':db8:abcd:12::7','987'+'654'+'321','synthetic-porthole-12009','synthetic-porthole-12010','synthetic-porthole-12011','synthetic-porthole-12012']
 const ruleText=planted.slice(0,6).concat(planted.slice(7,10),['Bearer '+planted[10],'Basic '+Buffer.from(planted[11]).toString('base64'),'api_key='+planted[12]]).join(' ')
 const bodies=[JSON.stringify({message:'Checkout accepted',level:'info',sensitive:ruleText,client_secret:planted[13],api_key:planted[12],exception:'private-0000',authorization:planted[6],jwt:planted[7]}),'{\n"message":"Payment failed",\n"level":"error", "value":'+JSON.stringify(planted[0])+'\n}','{ malformed '+ruleText+' client_secret='+planted[13]+' authorization='+planted[6]+' '+planted[7]+' }']
 const send=async(bodies,id,time=at)=>{
  const packet=otlpLogBatch(bodies.map((_,i)=>time+BigInt(i)))
  const resource=packet.resourceLogs[0];resource.resource.attributes=[{key:'service.name',value:{stringValue:d.service}},{key:'team.name',value:{stringValue:d.team}},{key:'deployment.environment.name',value:{stringValue:d.environment}},{key:'nested-private',value:{stringValue:planted[0]}}]
  resource.scopeLogs[0].logRecords.forEach((row,i)=>{row.body.stringValue=bodies[i];if(bodies[i].includes('protectedError'))row.severityNumber=17})
  const wire=JSON.stringify(packet),response=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':id},body:wire})
  assert.equal(response.status,200,await response.clone().text());return {id:response.headers.get('x-porthole-batch'),wire}
 }
 const person=['synthetic-porthole-12020','example.invalid'].join(String.fromCharCode(64))
 await value(await post('/app/settings/members/invite',{email:person,displayName:'Checkout maintainer',role:'maintainer',scope}),202)
 const memberCookie=await signIn(person)
 const nonOwnerBefore=(await get(api)).revision
 assert.equal((await post(api+'/preview',{definition:d,revision:nonOwnerBefore},memberCookie)).status,403,'current maintainer cannot change masking or exclusions')
 assert.equal((await get(api)).revision,nonOwnerBefore)
 assert.equal((await post(api+'/preview',{definition:d,revision:0},'')).status,401)
 assert.equal((await fetch(origin+api,{headers:{authorization:'Bearer '+source.secret}})).status,403)
 assert.equal((await post(api+'/preview',{definition:{...d,processors:[{type:'grok',pattern:'(a+)+'}]},revision:0})).status,400)
 const stateBeforeInvalid=await sql('SELECT COUNT(*) AS n FROM porthole_pipeline_previews')
 for(const pattern of ['(a+)+','[A-Z]{1,64}','a|b','a*','[0-9]{99}']) {
  assert.equal((await post(api+'/preview',{definition:{...d,redaction:[{pattern,exceptions:[]}]},revision:0})).status,400)
 }
 assert.deepEqual(await sql('SELECT COUNT(*) AS n FROM porthole_pipeline_previews'),stateBeforeInvalid,'invalid and expensive rules persist no preview or mutation')
 assert.equal((await get(api)).revision,nonOwnerBefore)
 const grok=await preview({...d,processors:[catalog.processors.find(p=>p.type==='grok').example,{type:'status',source:'level'}]},['info Checkout order 1042'])
 assert.equal(grok.results[0].attributes.message,'Checkout order 1042');assert.equal(grok.results[0].attributes.status,'info')
 const multiline=JSON.stringify({level:'info',message:'Checkout unchanged'},null,2)
 assert.equal((await preview(d,[multiline])).results[0].body.stringValue,multiline,'harmless multiline JSON keeps its source formatting')
 await pipelineBrowser({origin,cookie,definition:d,planted,empty:true})
 const p=await preview(d,bodies)
 assert.equal(p.results.length,3);assert.equal(p.results[0].attributes.status,'info');assert.equal(p.results[1].attributes.status,'error');assert.equal(p.results[2].status,'error');assert.ok(p.results[2].errors.some(e=>e.code==='json_parse_failed'))
 for(const secret of [...planted,Buffer.from(planted[11]).toString('base64')])assert.ok(!JSON.stringify(p).includes(secret),'preview masks '+planted.indexOf(secret))
 assert.ok(JSON.stringify(p).includes('private-0000'),'exact custom exception survives')
 assert.equal((await post(api+'/activate',{previewId:p.id,digest:'0'.repeat(64),confirm:'activate-pipeline'})).status,409)
 assert.equal((await activate(p)).revision,1)
 await value(await post(intake+'/control',{paused:true}))
 const first=await send(bodies,'synthetic-porthole-12003')
 const queued=(await sql(`SELECT * FROM porthole_ingest_batches WHERE id=${literal(first.id)}`))[0]
 const wire=JSON.parse(Buffer.from(queued.wire_base64,'base64').toString())
 assert.equal(wire.format,'porthole.sanitized-log-envelope.v1');assert.deepEqual(wire.records,JSON.parse(queued.records));assert.notEqual(Buffer.from(queued.wire_base64,'base64').toString(),first.wire)
 assert.equal(queued.digest,createHash('sha256').update(JSON.stringify({environment:null,service:null,team:null,tenant:null,wire:Buffer.from(first.wire).toString('base64')})).digest('hex'),'source identity remains bound to original bytes')
 for(const secret of [...planted,Buffer.from(planted[11]).toString('base64')])assert.ok(!JSON.stringify(wire).includes(secret),'no prohibited value in pending custody')
 const stale=await preview(d),kv={...d,processors:[{type:'kv'},{type:'status',source:'level'}]}
 assert.equal((await activate(await preview(kv,['level=info message="Checkout kv"']))).revision,2)
 assert.equal((await post(api+'/activate',{previewId:stale.id,digest:stale.digest,confirm:'activate-pipeline'})).status,409)
 assert.equal((await send(bodies,'synthetic-porthole-12003')).id,first.id,'revision change cannot reinterpret a replay')
 await send(['level=info message="Checkout kv"'],'synthetic-porthole-12004',at+10n)
 assert.equal((await activate(await preview(d,bodies))).revision,3)
 await restartWorker();cookie=await freshOwner()
 assert.equal((await get(api)).revision,3,'rollback persists across restart')
 await send([bodies[0]],'synthetic-porthole-12005',at+20n)
 await value(await post(intake+'/control',{paused:false}));await value(await post(intake+'/drain',{}))
 const query={signal:'logs',service:d.service,environment:d.environment,team:d.team,from:String(at-1n),through:String(at+100000n)}
 const records=(await value(await post('/api/porthole/v1/query',query))).records
 assert.equal(records.length,5);assert.deepEqual(records.map(r=>r.payload.pipeline.revision).sort(),[1,1,1,2,3]);assert.equal(records.filter(r=>r.payload.pipeline.status==='error').length,1)
 const totals=await value(await post(api+'/metrics',{definition:d,from:query.from,through:query.through}))
 assert.equal(totals.groups.filter(g=>g.name==='checkout.logs').reduce((sum,g)=>sum+g.count,0),5)
 assert.equal(totals.groups.filter(g=>g.name==='checkout.errors').reduce((sum,g)=>sum+g.count,0),1)
 const before=(await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'))[0].n
 assert.equal((await post(api+'/preview',{definition:d,revision:1})).status,409)
 assert.equal((await sql('SELECT COUNT(*) AS n FROM porthole_telemetry_records'))[0].n,before,'invalid stale changes delete nothing')
 await pipelineBrowser({origin,cookie,definition:d,planted})
 const {pipelineSpanPrivacy}=await import('./pipelines-spans.mjs')
 await pipelineSpanPrivacy({origin,cookie,sql,definition:d,post,value,planted,at})
 await pipelineCustody({origin,cookie,sql,restartWorker,withEmptyDestination,planted,source,definition:d,from:query.from,through:query.through,post,value})
 const {pipelineExclusion}=await import('./pipelines-exclusion.mjs')
 await pipelineExclusion({post,value,get,preview,activate,send,d,sql,at:at+1000000n,count:process.env.PORTHOLE_PIPELINE_SCALE==='1'?10000:10})
 // Existing exact-subject erasure also removes counted projections; a raw
 // retry after restart must not recreate either the payload or its count.
 const identifier='synthetic-porthole-12060',eraseId='synthetic-porthole-12061'
 const eraseInput=await send([JSON.stringify({message:identifier,level:'info'})],eraseId,at+2000000n)
 await value(await post(intake+'/drain',{}))
 const metricQuery={definition:d,from:String(at-1n),through:String(at+3000000n)}
 const countLogs=async()=>{const result=await value(await post(api+'/metrics',metricQuery));return result.groups.filter(g=>g.name==='checkout.logs').reduce((sum,g)=>sum+g.count,0)}
 const countedBefore=await countLogs(),erasure='/api/porthole/v1/subject-erasure'
 const erasurePreview=await value(await post(erasure,{identifier}))
 assert.equal(erasurePreview.records,1);assert.equal(erasurePreview.canApply,true)
 const erased=await value(await post(erasure+'/apply',{identifier,digest:erasurePreview.digest,confirm:'erase-exact-batches'}))
 assert.equal(erased.erasedRecords,1);assert.equal(await countLogs(),countedBefore-1,'erased counted log cannot survive in derived totals')
 await restartWorker();cookie=await freshOwner()
 assert.equal((await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json','x-porthole-batch-id':eraseId},body:eraseInput.wire})).status,409,'original capture cannot resurrect an erased person after restart')
 assert.equal(await countLogs(),countedBefore-1)
 const {pipelineProcessors}=await import('./pipelines-processors.mjs')
 await pipelineProcessors({post,value,preview,activate,send,get,d,at:at+4000000n})
 await value(await post('/app/settings/credentials/revoke',{id:source.credential.id,revision:source.credential.revision}))
 const denied=await fetch(origin+'/v1/logs',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:'{}'})
 assert.equal(denied.status,401,'revoked source cannot resurrect accepted data')
 console.log('pipelineJourney passed: native preview, activation, bounded refusal, original-wire identity, sanitized custody, counted metrics, restart rollback and exclusion')
}
