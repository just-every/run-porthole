import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
// The installed homepage reads the claim state from D1: run the emitted Worker
// on its own migrated store, never the checkout's local data.
const persist = await mkdtemp(join(tmpdir(), 'foundation-runtime-'))
const migrationEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
const migrate=config=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','foundation','--local','--persist-to',persist,'--config',config],{stdio:'pipe',env:migrationEnv})
const sql=command=>JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','foundation','--local','--persist-to',persist,'--config','dist/server/wrangler.json','--json','--command',command],{encoding:'utf8',env:migrationEnv})).flatMap(result=>result.results??[])
// Upgrade a real prior installation: Base first, then existing members, then
// the shipped product migrations through Wrangler's actual migration command.
const oldMigrations=join(persist,'previous-migrations');await mkdir(oldMigrations)
for(const name of (await readdir('migrations/core')).filter(name=>name<'0017')) await copyFile('migrations/core/'+name,join(oldMigrations,name))
const oldConfig=join(persist,'previous.json')
await writeFile(oldConfig,JSON.stringify({name:'justevery-porthole',compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',database_name:'foundation',database_id:'local-foundation-only',migrations_dir:oldMigrations}]}))
migrate(oldConfig)
const origin = `http://127.0.0.1:${port}`
// The emitted Worker's owner-claim setup token: a synthetic test value.
const setupToken = 'synthetic-runtime-setup-token-1234567890123456789'
let worker
let output = ''
let allOutput = ''
function startWorker() {
 worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port), '--var', `AUTH_ORIGIN:${origin}`, '--var', 'AUTH_LOCAL:true', '--var', 'OWNER_EMAIL:owner@example.com', '--var', 'MAIL_FROM:synthetic-porthole-4@example.com', '--var', 'SESSION_SECRET:runtime-session-secret-1234567890123456', '--var', `SETUP_TOKEN:${setupToken}`], { stdio: ['ignore', 'pipe', 'pipe'] })
worker.stdout.on('data', chunk => { output += chunk; allOutput += chunk })
worker.stderr.on('data', chunk => { output += chunk; allOutput += chunk })
}
async function stopWorker() {
 worker.kill('SIGTERM')
 await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
}
async function restartWorker(changeStorage) {
 await stopWorker(); if (changeStorage) changeStorage(); output = ''; startWorker()
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
  // A deployed installation must never accept demo/setup claims without its linked provider.
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
  await restartWorker(()=>{
   sql(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('${randomUUID()}','synthetic-porthole-10@example.com','Existing checkout administrator','admin','active',${Date.now()}),('${randomUUID()}','synthetic-porthole-11@example.com','Existing checkout analyst','member','active',${Date.now()})`)
   migrate('dist/server/wrangler.json')
  })
  assert.equal((await fetch(`${origin}/app`, { redirect: 'manual', headers: { cookie } })).headers.get('location'), '/setup')
  assert.equal((await fetch(`${origin}/setup`, { headers: { cookie } })).status, 200)
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
  const {fixture}=await import('./porthole/fixture.mjs')
  const helpers=fixture({origin,sql,restartWorker,sessionSecret:'runtime-session-secret-1234567890123456'})
  cookie=await helpers.freshOwner()
  const {membershipJourney}=await import('./porthole/membership.mjs')
  const {credentialJourney}=await import('./porthole/credentials.mjs')
  const membership=await membershipJourney({origin,cookie,persist,restartWorker,...helpers,sessionSecret:'runtime-session-secret-1234567890123456'})
  cookie=membership.cookie
  await credentialJourney({origin,cookie,persist,restartWorker,...helpers,getLogs:()=>allOutput})
  cookie=await helpers.freshOwner()
  const { auditJourney, healthJourney } = await import('./porthole/audit.mjs')
  await auditJourney({ origin, cookie, persist, restartWorker })
  await healthJourney({ origin, cookie })
  console.log('APP-HOME passed against emitted local Worker: /app behind sign-in and setup, then the trace view with its stylesheets')
} finally {
  await stopWorker()
  await rm(persist, { recursive: true, force: true })
}
