import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {promisify} from 'node:util'
const execute=promisify(execFile)
if(process.env.PORTHOLE_MAIL_ONLY==='1'){const {recipientMailJourney}=await import('./porthole/health.mjs');await recipientMailJourney();process.exit(0)}
if(process.env.PORTHOLE_ANALYTICAL_ONLY==='1'){const {analyticalConnectionJourney}=await import('./porthole/analytics.mjs');await analyticalConnectionJourney();process.exit(0)}

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const inspectorSocket = createServer()
await new Promise(resolve => inspectorSocket.listen(0, '127.0.0.1', resolve))
const inspectorPort = inspectorSocket.address().port
await new Promise(resolve => inspectorSocket.close(resolve))
async function withPinnedClock(now, run) {
 const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json`)).json()
 // Use Wrangler's own inspector transport with its required local origin.
 const {WebSocket:InspectorWebSocket}=createRequire(import.meta.resolve('wrangler/package.json'))('ws')
 const connection = new InspectorWebSocket(targets[0].webSocketDebuggerUrl,{origin:'http://localhost',handshakeTimeout:10000})
 await new Promise((resolve,reject) => {connection.addEventListener('open',resolve,{once:true});connection.addEventListener('error',reject,{once:true})})
 let next=0
 const command=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++next
  const timer=setTimeout(()=>{connection.removeEventListener('message',receive);reject(Error('Inspector command timed out: '+method))},10000)
  const receive=event=>{const message=JSON.parse(event.data);if(message.id!==id)return;clearTimeout(timer);connection.removeEventListener('message',receive);message.error||message.result?.exceptionDetails?reject(Error(JSON.stringify(message))):resolve(message.result)}
  connection.addEventListener('message',receive);connection.send(JSON.stringify({id,method,params}))
 })
 let contextId,pinned=false
 const context=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{connection.removeEventListener('message',receive);reject(Error('Worker execution context unavailable'))},10000)
  const receive=event=>{const message=JSON.parse(event.data);if(message.method!=='Runtime.executionContextCreated')return;clearTimeout(timer);connection.removeEventListener('message',receive);resolve(message.params.context.id)}
  connection.addEventListener('message',receive)
 })
 const evaluate=expression=>command('Runtime.evaluate',{expression,contextId})
 try {
  await command('Runtime.disable')
  const [,id]=await Promise.all([command('Runtime.enable'),context]);contextId=id
  await evaluate(`globalThis.__journeyDateNow=Date.now;Date.now=()=>${now}`);pinned=true
  return await run()
 } finally {if(pinned)await evaluate('Date.now=globalThis.__journeyDateNow;delete globalThis.__journeyDateNow');connection.close()}
}
// The installed homepage reads the claim state from D1: run the emitted Worker
// on its own migrated store, never the checkout's local data.
let persist = await mkdtemp(join(tmpdir(), 'foundation-runtime-'))
const stores=[persist]
const migrationEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
const migrate=config=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config',config],{stdio:'pipe',env:migrationEnv})
const sql=async command=>JSON.parse((await execute(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json','--json','--command',command],{encoding:'utf8',env:migrationEnv})).stdout).flatMap(result=>result.results??[])
// Upgrade a real prior installation: Base first, then existing members, then
// the shipped product migrations through Wrangler's actual migration command.
const oldMigrations=join(persist,'previous-migrations');await mkdir(oldMigrations)
for(const name of (await readdir('migrations/core')).filter(name=>name<'0017')) await copyFile('migrations/core/'+name,join(oldMigrations,name))
const oldConfig=join(persist,'previous.json')
await writeFile(oldConfig,JSON.stringify({name:'justevery-porthole',compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',database_name:'foundation',database_id:'local-foundation-only',migrations_dir:oldMigrations}]}))
migrate(oldConfig)
// The focused ingest shard first exercises the previous three-signal schema
// through public intake, then upgrades its populated real D1 to profiles.
const preProfilesMigrations=join(persist,'pre-profiles-migrations');await mkdir(preProfilesMigrations)
for(const name of (await readdir('migrations/core')).filter(name=>name<'0029'))await copyFile('migrations/core/'+name,join(preProfilesMigrations,name))
const preProfilesConfig=join(persist,'pre-profiles.json')
await writeFile(preProfilesConfig,JSON.stringify({name:'justevery-porthole',compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',database_name:'foundation',database_id:'local-foundation-only',migrations_dir:preProfilesMigrations}]}))
const origin = `http://127.0.0.1:${port}`
// The emitted Worker's owner-claim setup token: a synthetic test value.
const setupToken = 'synthetic-runtime-setup-token-1234567890123456789'
let worker
let ownerEmail='owner@example.com'
let output = ''
let allOutput = ''
function startWorker() {
 worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', String(inspectorPort), '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port), '--var', `AUTH_ORIGIN:${origin}`, '--var', 'AUTH_LOCAL:true', '--var', `OWNER_EMAIL:${ownerEmail}`, '--var', 'MAIL_FROM:synthetic-porthole-4@example.com', '--var', 'SESSION_SECRET:runtime-session-secret-1234567890123456', '--var', `SETUP_TOKEN:${setupToken}`], { stdio: ['ignore', 'pipe', 'pipe'] })
worker.stdout.on('data', chunk => { output += chunk; allOutput += chunk })
worker.stderr.on('data', chunk => { output += chunk; allOutput += chunk })
}
async function stopWorker() {
 worker.kill('SIGTERM')
 await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
}
async function restartWorker(changeStorage) {
 await stopWorker(); if (changeStorage) await changeStorage(); output = ''; startWorker()
 for (let attempt = 0; attempt < 120; attempt++) {
  if (worker.exitCode !== null) throw Error(output)
  try { if ((await fetch(`${origin}/health`)).ok) return } catch {}
  await new Promise(resolve => setTimeout(resolve, 250))
 }
 throw Error('Worker did not restart')
}
startWorker()
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error(output)
    try { ready = (await fetch(`${origin}/health`)).ok } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, output)
  const health = await (await fetch(`${origin}/health`)).json()
  assert.equal(health.status, 'ok')
  assert.equal(health.ok, true)
  assert.deepEqual(Object.keys(health.deployment ?? {}).sort(), ['fingerprint', 'sourceSha', 'versionId'])
  const document = await fetch(origin)
  assert.equal(document.status, 200)
  const branding = JSON.parse(await readFile(new URL('../src/branding.json', import.meta.url)))
  assert.ok((await document.text()).includes(branding.name))
  for (const path of ['/missing', '/health/extra', '/api', '/api/missing']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
  }
  // A deployed installation must never accept demo or setup claims without its linked provider.
  for (const body of [{}, { token: 'wrong-setup-token' }]) {
    const claim = await fetch(`${origin}/auth/owner-claim`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-rer-demo': '1' },
      body: JSON.stringify(body), redirect: 'manual',
    })
    assert.equal(claim.status, 403)
    assert.deepEqual(await claim.json(), { error: 'provider_unlinked' })
    assert.equal(claim.headers.has('set-cookie'), false)
  }
  console.log('Installed owner claim rejects missing/wrong setup tokens and request demo flags')
  console.log('HTTP-001 passed against emitted local Worker: health, the installed homepage, HTTP and document 404s')
  // APP-HOME: the owner's first run on the emitted Worker. /app sits behind sign-in and setup, then serves the
  // trace view with every stylesheet it links.
  const form = (body, cookie) => ({ method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body) })
  assert.equal((await fetch(`${origin}/app`, { redirect: 'manual' })).headers.get('location'), '/signin')
  const owner = await fetch(`${origin}/auth/bootstrap`, form({ token: setupToken, displayName: 'Runtime Owner', returnTo: '/setup' }))
  assert.equal(owner.status, 303)
  let cookie = owner.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await restartWorker(async()=>{
   await sql(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('${randomUUID()}','synthetic-porthole-10@example.com','Existing checkout administrator','admin','active',${Date.now()}),('${randomUUID()}','synthetic-porthole-11@example.com','Existing checkout analyst','member','active',${Date.now()})`)
   migrate(process.env.PORTHOLE_INGEST_ONLY==='1'?preProfilesConfig:'dist/server/wrangler.json')
  })
  assert.equal((await fetch(`${origin}/app`, { redirect: 'manual', headers: { cookie } })).headers.get('location'), '/setup')
  const setupPage=await fetch(`${origin}/setup`, { headers: { cookie } })
  assert.equal(setupPage.status,200)
  assert.match(await setupPage.text(),/Independent notices off — incomplete coverage/)
  if(!process.env.PORTHOLE_METRIC_RULES_ONLY && !process.env.PORTHOLE_SLO_ONLY && !process.env.PORTHOLE_ERASURE_ONLY && !process.env.PORTHOLE_API_ONLY && !process.env.PORTHOLE_DASHBOARD_ONLY && !process.env.PORTHOLE_EXPORT_ONLY && !process.env.PORTHOLE_MIGRATION_ONLY && !process.env.PORTHOLE_PROTOCOL_ONLY && !process.env.PORTHOLE_INGEST_ONLY && !process.env.PORTHOLE_ACCESS_ONLY && !process.env.PORTHOLE_TRACE_ONLY && (process.env.PORTHOLE_HEALTH_ONLY==='1' || !process.env.PORTHOLE_AUDIT_ONLY && !process.env.PORTHOLE_STOCK_ONLY)) {
   const {healthBrowser}=await import('./porthole/health.mjs')
   await healthBrowser({origin,cookie,name:'setup-notices-off',path:'/setup',contains:'Independent notices off — incomplete coverage'})
  }
  assert.equal((await fetch(`${origin}/setup`, form({ confirm: 'yes' }, cookie))).headers.get('location'), '/app')
  const home = await fetch(`${origin}/app`, { headers: { cookie } })
  assert.equal(home.status, 200)
  assert.match(home.headers.get('content-type'), /^text\/html/)
  const linked = [...(await home.text()).matchAll(/<link rel="stylesheet" href="(\/[^"]+)"/g)].map(match => match[1])
  assert.ok(linked.length >= 2, 'the home links the theme and the look')
  for (const href of linked) {
    const sheet = await fetch(`${origin}${href}`)
    assert.equal(sheet.status, 200, href)
    for (const [, imported] of (await sheet.text()).matchAll(/@import url\('(\/[^']+)'\)/g)) assert.equal((await fetch(`${origin}${imported}`)).status, 200, imported)
  }
  // Obtain a valid native session from a second, independently bootstrapped
  // installation. Even with the same fixture secret, its account and session rows
  // belong only to its own store and cannot authenticate in the first one.
  const originalStore=persist
  const foreignStore=await mkdtemp(join(tmpdir(),'porthole-other-installation-'));stores.push(foreignStore)
  await restartWorker(async()=>{persist=foreignStore;migrate('dist/server/wrangler.json')})
  const foreignOwner=await fetch(origin+'/auth/bootstrap',form({token:setupToken,displayName:'Other installation owner'}))
  assert.equal(foreignOwner.status,303)
  const foreignCookie=foreignOwner.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  assert.equal((await fetch(origin+'/auth/session',{headers:{cookie:foreignCookie}})).status,200)
  await restartWorker(()=>{persist=originalStore})
  assert.equal((await fetch(origin+'/auth/session',{headers:{cookie:foreignCookie}})).status,401)
  const {fixture}=await import('./porthole/fixture.mjs')
  const helpers=fixture({origin,sql,restartWorker,sessionSecret:'runtime-session-secret-1234567890123456'})
  cookie=await helpers.freshOwner()
  async function withEmptyDestination(run) {
   const savedStore=persist,savedOwner=ownerEmail
   const destination=await mkdtemp(join(tmpdir(),'porthole-archive-destination-'));stores.push(destination)
   try {
    await restartWorker(()=>{persist=destination;ownerEmail='synthetic-porthole-400@example.com';migrate('dist/server/wrangler.json')})
    const boot=await fetch(origin+'/auth/bootstrap',form({token:setupToken,displayName:'Destination owner'}))
    assert.equal(boot.status,303)
    let destinationCookie=boot.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    await fetch(origin+'/setup',form({confirm:'yes'},destinationCookie))
    const destinationHelpers=fixture({origin,sql,restartWorker,sessionSecret:'runtime-session-secret-1234567890123456',ownerEmail})
    destinationCookie=await destinationHelpers.freshOwner()
    return await run({origin,cookie:destinationCookie,persist,...destinationHelpers,restartWorker})
   } finally {await restartWorker(()=>{persist=savedStore;ownerEmail=savedOwner})}
  }
  if(process.env.PORTHOLE_METRIC_RULES_ONLY==='1') {
   const {spanMetricJourney}=await import('./porthole/ingest.mjs')
   await spanMetricJourney({origin,restartWorker,withEmptyDestination,withPinnedClock,...helpers})
   const {agentStatsJourney}=await import('./porthole/agent-stats.mjs')
   await agentStatsJourney({origin,restartWorker,...helpers})
  } else if(process.env.PORTHOLE_SPLUNK_COLLECTOR_ONLY==='1') {
   const {splunkCollectorJourney}=await import('./porthole/migration-collector.mjs')
   const result=await splunkCollectorJourney({origin,cookie,restartWorker,...helpers})
   cookie=result.cookie
   const {cookie:privateSession,...qualification}=result
   console.log('Splunk collector qualification passed: '+JSON.stringify(qualification))
  } else if(process.env.PORTHOLE_SLO_ONLY==='1') {
   const {sloJourney}=await import('./porthole/health.mjs')
   await sloJourney({origin,withEmptyDestination,restartWorker,...helpers})
  } else if(process.env.PORTHOLE_FOLLOW_UP_ONLY==='1') {
   const {followUpJourney}=await import('./porthole/health.mjs')
   await followUpJourney({origin,cookie,restartWorker,withPinnedClock,withEmptyDestination,...helpers})
  } else if(process.env.PORTHOLE_ERASURE_ONLY==='1') {
   const {subjectErasureJourney}=await import('./porthole/archive.mjs')
   await subjectErasureJourney({origin,cookie,restartWorker,withEmptyDestination,withPinnedClock,...helpers})
  } else if(process.env.PORTHOLE_DASHBOARD_ONLY==='1') {
   const {dashboardJourney}=await import('./porthole/dashboards.mjs')
   await dashboardJourney({origin,cookie,restartWorker,withEmptyDestination,...helpers})
  } else if(process.env.PORTHOLE_API_ONLY==='1') {
   const {apiJourney}=await import('./porthole/api.mjs')
   await apiJourney({origin,cookie,restartWorker,...helpers})
   const {dashboardApiJourney}=await import('./porthole/dashboard-api.mjs')
   await dashboardApiJourney({origin,cookie,...helpers})
   const {terraformJourney}=await import('./porthole/terraform.mjs')
   await terraformJourney({origin,cookie,...helpers})
  } else if(process.env.PORTHOLE_MIGRATION_ONLY==='1') {
   const {migrationJourney}=await import('./porthole/migration.mjs')
   await migrationJourney({origin,cookie,foreignCookie,restartWorker,withEmptyDestination,withPinnedClock,...helpers})
  } else if(process.env.PORTHOLE_EXPORT_ONLY==='1') {
   const {signalExportJourney}=await import('./porthole/archive.mjs')
   await signalExportJourney({origin,cookie,restartWorker,withEmptyDestination,...helpers})
   const {browserProof}=await import('./porthole/audit.mjs')
   await browserProof({origin,cookie:await helpers.freshOwner(),paths:['/app/explore'],name:'signal-export-explore'})
  } else if(process.env.PORTHOLE_PROTOCOL_ONLY==='1') {
   const {otlpProtocolJourney,ingestBrowserJourney}=await import('./porthole/ingest.mjs')
   const protocol=await otlpProtocolJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
   await ingestBrowserJourney({origin,cookie:await helpers.freshOwner(),profile:protocol})
  } else if(process.env.PORTHOLE_INGEST_ONLY==='1') {
   const {ingestJourney,otlpProtocolJourney,ingestBrowserJourney}=await import('./porthole/ingest.mjs')
   await ingestJourney({origin,cookie,persist,restartWorker,...helpers})
   const beforeUpgrade={}
   for(const table of ['porthole_ingest_batches','porthole_telemetry_records','porthole_telemetry_archive'])beforeUpgrade[table]=await sql(`SELECT * FROM ${table} ORDER BY id`)
   await restartWorker(()=>migrate('dist/server/wrangler.json'))
   for(const [table,rows]of Object.entries(beforeUpgrade))assert.deepEqual(await sql(`SELECT * FROM ${table} ORDER BY id`),rows,'additive profile migration preserves existing '+table)
   assert.deepEqual(await sql('PRAGMA foreign_key_check'),[])
   console.log('Populated three-signal D1 upgrade passed: original envelopes, retained/archive rows, sequence watermarks and foreign keys preserved')
   const protocol=await otlpProtocolJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
   await ingestBrowserJourney({origin,cookie:await helpers.freshOwner(),profile:protocol})
  } else if(process.env.PORTHOLE_TRACE_ONLY==='1') {
   const {traceJourney}=await import('./porthole/traces.mjs')
   await traceJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
  } else if(process.env.PORTHOLE_HEALTH_ONLY==='1') {
   const {recoveryJourney,recipientMailJourney}=await import('./porthole/health.mjs')
   await recoveryJourney({origin,cookie,persist,restartWorker,...helpers})
   await recipientMailJourney()
  } else if(process.env.PORTHOLE_STOCK_ONLY==='1') {
   const {stockIngestJourney}=await import('./porthole/stock-ingest.mjs')
   await stockIngestJourney({origin,cookie,persist,restartWorker,...helpers})
  } else if(process.env.PORTHOLE_AUDIT_ONLY==='1') {
   const {auditJourney}=await import('./porthole/audit.mjs')
   await auditJourney({origin,cookie,persist,restartWorker})
   const {actionJourney}=await import('./porthole/actions.mjs')
   const actions=await actionJourney({origin,cookie,persist,restartWorker,...helpers});cookie=actions.cookie
   const {archiveJourney}=await import('./porthole/archive.mjs')
   await archiveJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
  } else {
  const {membershipJourney}=await import('./porthole/membership.mjs')
  const {credentialJourney}=await import('./porthole/credentials.mjs')
  const membership=await membershipJourney({origin,cookie,foreignCookie,persist,restartWorker,...helpers,sessionSecret:'runtime-session-secret-1234567890123456'})
  cookie=membership.cookie
  await credentialJourney({origin,cookie,persist,restartWorker,...helpers,getLogs:()=>allOutput})
  const {credentialQueryJourney}=await import('./porthole/credentials.mjs')
  if(process.env.PORTHOLE_ACCESS_ONLY==='1') {
   await credentialQueryJourney({origin,sql,freshOwner:helpers.freshOwner,restartWorker,getLogs:()=>allOutput})
   const {browserProof}=await import('./porthole/audit.mjs')
   await browserProof({origin,cookie:await helpers.freshOwner(),paths:['/app/explore'],name:'credential-query'})
  }
  else {
  cookie=await helpers.freshOwner()
  const {healthJourney,browserProof}=await import('./porthole/audit.mjs')
  await healthJourney({origin,cookie})
  await credentialQueryJourney({origin,sql,freshOwner:helpers.freshOwner,restartWorker,getLogs:()=>allOutput})
  if(process.env.PORTHOLE_CORE_ONLY!=='1') {
  const { ingestJourney }=await import('./porthole/ingest.mjs')
  await ingestJourney({origin,cookie,persist,restartWorker,...helpers})
  if(process.env.PORTHOLE_STOCK_QUALIFICATION==='1') {const {stockIngestJourney}=await import('./porthole/stock-ingest.mjs');await stockIngestJourney({origin,cookie,persist,restartWorker,...helpers})}
  const {ingestBrowserJourney,otlpProtocolJourney}=await import('./porthole/ingest.mjs')
  const protocol=await otlpProtocolJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
  await ingestBrowserJourney({origin,cookie:await helpers.freshOwner(),profile:protocol})
  }
  cookie=await helpers.freshOwner()
  const { auditJourney } = await import('./porthole/audit.mjs')
  await auditJourney({ origin, cookie, persist, restartWorker })
  const {actionJourney}=await import('./porthole/actions.mjs')
  const actions=await actionJourney({origin,cookie,persist,restartWorker,...helpers});cookie=actions.cookie
  const { recoveryJourney,recipientMailJourney }=await import('./porthole/health.mjs')
  await recoveryJourney({origin,cookie,persist,restartWorker,...helpers})
   await recipientMailJourney()
  cookie=await helpers.freshOwner()
  await browserProof({origin,cookie,paths:['/app/health'],name:'health-recovered'})
  cookie=await helpers.freshOwner()
  const {bucketHistoryJourney}=await import('./porthole/bucket-history.mjs')
  await bucketHistoryJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
  const { archiveJourney }=await import('./porthole/archive.mjs')
  await archiveJourney({origin,cookie,persist,restartWorker,withEmptyDestination,...helpers})
  cookie=await helpers.freshOwner()
  await browserProof({origin,cookie,paths:['/app/settings/archive'],name:'archive'})
  }
  }
  console.log('APP-HOME passed against emitted local Worker: /app behind sign-in and setup, then the trace view with its stylesheets')
} catch(error) {
  console.error(allOutput.split('\n').filter(line=>/ERROR|Error|\[wrangler:info\]/.test(line)).slice(-50).join('\n').replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]'))
  throw error
} finally {
  await stopWorker()
  for(const store of stores) await rm(store, { recursive: true, force: true })
  // wrangler dev keeps its scratch (.wrangler/tmp) beside the config it runs, which here is the emitted Worker; the artifact producer refuses that folder in dist/server, so leave the build output as rer build wrote it.
  await rm('dist/server/.wrangler', { recursive: true, force: true })
}
