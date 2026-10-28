import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {publicSite,browsePublicDocs} from './public-docs-site.mjs'

/** Signed-out built site, then its actual copyable commands against the real Worker. */
export async function publicDocsJourney({origin,cookie,freshOwner}) {
 cookie=await freshOwner()
 const site=await publicSite()
 const native=(path,body)=>fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)})
 const scope={services:['synthetic-porthole-1'],environments:['synthetic-porthole-2'],teams:['synthetic-porthole-3'],signals:['logs']}
 const mint=async(kind,actions)=>{
  const response=await native('/app/settings/credentials/mint',{name:'synthetic-porthole-6',class:kind,scope:{...scope,actions}})
  assert.equal(response.status,201)
  return response.json()
 }
 const source=await mint('ingest',['telemetry.write']),reader=await mint('read',['telemetry.read','definitions.read'])
 const request=(path,body,secret=reader.secret)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 try {
  const privateValues=[source.secret,reader.secret,cookie]
  const snippets=await browsePublicDocs(site.origin,privateValues)
  const schemaResponse=await fetch(site.origin+'/openapi/porthole-v1.json')
  assert.equal(schemaResponse.status,200)
  const schemaText=await schemaResponse.text(),schema=JSON.parse(schemaText)
  for(const value of privateValues)assert.ok(!schemaText.includes(value))
  assert.ok(schema.paths['/api/porthole/v1/query'].post.requestBody)
  for(const signal of ['logs','metrics','traces','profiles'])assert.ok(schema.paths['/v1/'+signal].post)
  const visit=value=>{if(!value||typeof value!=='object')return;if(value.$ref){assert.ok(value.$ref.startsWith('#/'));let target=schema;for(const part of value.$ref.slice(2).split('/'))target=target?.[part.replaceAll('~1','/').replaceAll('~0','~')];assert.ok(target,'schema reference resolves: '+value.$ref)};for(const child of Object.values(value))visit(child)}
  visit(schema)
  assert.equal((await fetch(origin+'/api/porthole/v1/openapi.json')).status,401,'public artifact does not unlock live schema')
  assert.equal((await request('/api/porthole/v1/openapi.json')).status,403,'read key does not unlock native schema')
  const live=await fetch(origin+'/api/porthole/v1/openapi.json',{headers:{cookie}})
  assert.equal(live.status,200);assert.deepEqual(await live.json(),schema)
  const payload=await (await fetch(site.origin+'/docs/examples/otlp-logs-v1.json')).json()
  const query=await (await fetch(site.origin+'/docs/examples/query-logs-v1.json')).json()
  assert.deepEqual(payload,JSON.parse(await readFile('public/docs/examples/otlp-logs-v1.json','utf8')))
  assert.deepEqual(query,JSON.parse(await readFile('public/docs/examples/query-logs-v1.json','utf8')))
  const commands=snippets['/docs/v1/otlp']
  const intake=commands.find(text=>text.includes('curl ')&&text.includes('@public/docs/examples/otlp-logs-v1.json'))
  const queryCommand=commands.find(text=>text.includes('curl ')&&text.includes('@public/docs/examples/query-logs-v1.json'))
  assert.ok(intake&&queryCommand,'walkthrough offers executable request commands')
  const accepted=await shell(intake,source.secret,origin)
  assert.equal(accepted.code,0,accepted.stderr)
  assert.match(accepted.stdout,/HTTP\/1.1 200/)
  assert.match(accepted.stdout,/x-porthole-accepted: 1/i)
  assert.match(accepted.stdout,/x-porthole-duplicate: false/i)
  const batch=/x-porthole-batch: ([^\r\n]+)/i.exec(accepted.stdout)[1]
  const retry=await shell(intake,source.secret,origin)
  assert.equal(retry.code,0);assert.match(retry.stdout,/x-porthole-duplicate: true/i)
  assert.ok(retry.stdout.includes(batch),'identical command returns same durable receipt')
  assert.equal((await native('/api/porthole/v1/ingest/drain',{})).status,200)
  const queried=await shell(queryCommand,reader.secret,origin)
  assert.equal(queried.code,0,queried.stderr)
  const result=JSON.parse(queried.stdout)
  assert.equal(result.records.length,1,'one documented log after identical retry')
  const record=result.records[0]
  assert.deepEqual([record.id,record.service,record.environment,record.team,BigInt(record.event_time_ns).toString(),record.payload.record.body.stringValue],[batch+':0','synthetic-porthole-1','synthetic-porthole-2','synthetic-porthole-3','1793232000000000000','synthetic-porthole-4'])
  const replay=await request(result.replay)
  assert.equal(replay.status,200);assert.deepEqual((await replay.json()).records,result.records)
  const monitor={name:'synthetic-porthole-7',scope:{services:scope.services,environments:scope.environments,teams:scope.teams},body:{signal:'logs',operator:'above',threshold:1,windowSeconds:60}}
  const created=await fetch(origin+'/api/porthole/v1/configuration/monitors',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(monitor)})
  assert.equal(created.status,201);const definition=await created.json()
  const cliCommand=snippets['/docs/v1/programmatic-access'].find(text=>text.includes('list monitors --all'))
  assert.ok(cliCommand)
  const cli=await shell(cliCommand,reader.secret,origin)
  assert.equal(cli.code,0,cli.stderr)
  const pages=cli.stdout.trim().split('\n').map(line=>JSON.parse(line))
  assert.deepEqual(pages[0].objects.map(row=>row.id),[definition.id])
  assert.deepEqual(pages[1].records,result.records)
  const errorsPage=await (await fetch(site.origin+'/docs/v1/api-errors')).text()
  const deniedRead=await shell(queryCommand,source.secret,origin)
  assert.notEqual(deniedRead.code,0,'ingest authority cannot read')
  assert.match(deniedRead.stderr,/403/)
  assert.ok(errorsPage.includes(JSON.parse(deniedRead.stdout).error),'actual permission refusal has linked recovery guidance')
  const deniedWrite=await shell(intake,reader.secret,origin)
  assert.notEqual(deniedWrite.code,0);assert.match(deniedWrite.stderr,/403/)
  const invalid=await request('/api/porthole/v1/query',{...query,dialect:'sql',expression:'DROP TABLE logs'})
  assert.equal(invalid.status,400);const error=await invalid.json();assert.ok(error.field&&error.hint,'invalid documented query has actionable diagnostics')
  assert.equal((await request('/api/porthole/v1/query',{...query,team:'synthetic-porthole-8'})).status,403)
  assert.equal((await native('/app/settings/credentials/revoke',{id:reader.credential.id})).status,200)
  assert.equal((await request(result.replay)).status,401,'saved reference cannot revive revoked authority')
  assert.equal((await shell(queryCommand,reader.secret,origin)).code,22)
  assert.equal((await native('/app/settings/credentials/revoke',{id:source.credential.id})).status,200)
  assert.equal((await shell(intake,source.secret,origin)).code,22,'captured intake refuses revoked source')
  const remaining=await fetch(origin+'/api/porthole/v1/query',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(query)})
  assert.equal(remaining.status,200);assert.deepEqual((await remaining.json()).records,result.records,'refusals neither add nor remove records')
  console.log('Public documentation journey passed: signed-out versioned guides and schema, exact rendered intake, query and CLI examples, permission guidance, scoped refusals and revoked replay; 1440 and 390 navigation')
 } finally {await site.close()}
}

function shell(command,secret,origin) {
 return new Promise((resolve,reject)=>{
  const child=spawn('/bin/bash',['-euo','pipefail','-c',command],{env:{...process.env,PORTHOLE_ORIGIN:origin,PORTHOLE_CREDENTIAL:secret,PORTHOLE_SESSION:''},stdio:['ignore','pipe','pipe']})
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data)
  child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}))
 })
}
