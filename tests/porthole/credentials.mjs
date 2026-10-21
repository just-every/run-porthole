import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { literal } from './fixture.mjs'

const settings = '/app/settings/credentials', introspection = '/api/porthole/v1/credential'
const scope = { services: ['checkout'], environments: ['production'], teams: ['commerce'], signals: ['logs'], actions: ['telemetry.read'] }
const kindActions = { ingest: ['telemetry.write'], 'change-event': ['change.deploy'], read: ['telemetry.read'], proposal: ['telemetry.read', 'proposal.create'], execution: ['plan.execute'] }
const privateResponse = response => {
 assert.match(response.headers.get('cache-control') ?? '', /no-store/)
 assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
}
/** Harness contract: sql(statement) asynchronously returns SELECT rows from real SQLite;
 * mutate(statement) stops the emitted Worker, runs SQL, and restarts it;
 * freshOwner()/signIn(email) consume actual Base confirmations over HTTP;
 * getLogs() returns captured Worker stdout/stderr without printing it.
 * Synthetic mail-edge fixture setup is shared with membership.mjs. */
export async function credentialJourney({ origin, cookie, sql, mutate, restartWorker, freshOwner, signIn, getLogs, browser = true }) {
 const secrets = []
 let ownerCookie = cookie
 const post = (path, data, actingCookie = ownerCookie, headers = {}) => fetch(origin + path, { method: 'POST', redirect: 'manual', headers: { origin, cookie: actingCookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) })
 const inspect = secret => fetch(origin + introspection, { headers: { authorization: `Bearer ${secret}` } })
 const mint = async (kind, actingCookie = ownerCookie, extra = {}) => {
  const response = await post(settings + '/mint', { name: 'Checkout investigation', class: kind, scope: { ...scope, actions: kindActions[kind] }, ...extra }, actingCookie)
  assert.equal(response.status, 201, `mint ${kind}`); privateResponse(response)
  const value = await response.json()
  assert.ok(/^ph_[A-Za-z0-9_-]{43}$/.test(value.secret), 'secret carries 256 random bits')
  secrets.push(value.secret)
  return value
 }
 for (const path of [settings, introspection]) {
  const response = await fetch(origin + path, { headers: { accept: 'application/json' } })
  assert.equal(response.status, 401); privateResponse(response)
 }
 ownerCookie = await freshOwner()
 // Give a real native admin a bounded scope through the public Members door.
 const invited = await post('/app/settings/members/invite', { email: 'synthetic-porthole-83@example.com', displayName: 'Checkout administrator', role: 'admin', scope: { services: scope.services, environments: scope.environments, teams: [] } })
 assert.equal(invited.status, 202)
 let adminCookie = await signIn('synthetic-porthole-83@example.com')
 for (const kind of ['proposal', 'execution']) assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: kind, scope: { ...scope, actions: kindActions[kind] } }, adminCookie)).status, 403)
 assert.equal((await post(settings+'/mint',{name:'synthetic-porthole-82',class:'read',scope:{...scope,services:['other-service']}},adminCookie)).status,403)
 const read = await mint('read', adminCookie, { requestsPerMinute: 2 })
 const stored = (await sql(`SELECT * FROM porthole_credentials WHERE id=${literal(read.credential.id)}`))[0]
 assert.ok(stored.secret_hash === createHash('sha256').update(read.secret).digest('hex'), 'only the SHA-256 verifier is persisted')
 assert.ok(!JSON.stringify(stored).includes(read.secret), 'plaintext never enters credential storage')
 assert.equal(stored.last_four.length, 4)
 assert.ok(read.secret.endsWith(stored.last_four))
 const listing = await fetch(origin + settings, { headers: { cookie: ownerCookie, accept: 'application/json' } })
 assert.equal(listing.status, 200)
 const listingText = await listing.text()
 assert.ok(!listingText.includes(read.secret) && !listingText.includes(stored.secret_hash), 'listing contains masked metadata only')
 const html = await (await fetch(origin + settings, { headers: { cookie: ownerCookie } })).text()
 assert.ok(!html.includes(read.secret) && !html.includes(stored.secret_hash))
 for (const path of [settings + '/mint', '/app/settings/members/invite', '/auth/invite']) {
  const denied = await post(path, { name: 'Checkout investigation', class: 'read', scope }, '', { authorization: `Bearer ${read.secret}` })
  assert.equal(denied.status, 403)
 }
 assert.equal((await post(introspection, {}, ownerCookie)).status, 403, 'API never mints')
 assert.equal((await fetch(origin + introspection + '?token='+encodeURIComponent(read.secret), { headers: { authorization: `Bearer ${read.secret}` } })).status, 400)
 assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: 'read', scope }, ownerCookie, { origin: 'https://synthetic-porthole.invalid' })).status, 403)
 const checks = await Promise.all(Array.from({ length: 3 }, () => inspect(read.secret)))
 assert.deepEqual(checks.map(response => response.status).sort(), [200, 200, 429])
 const throttled = checks.find(response => response.status === 429)
 assert.ok(Number(throttled.headers.get('retry-after')) > 0)
 const accepted = await checks.find(response => response.status === 200).json()
 assert.deepEqual(accepted.scope.services, scope.services)
 assert.deepEqual(accepted.scope.actions, ['telemetry.read'])
 assert.ok(accepted.lastUsedAt > 0 && accepted.lastUsedDoor === introspection)
 // Expire just the owner's proof; its native session remains live. Revocation
 // must still work while mint, rotate and rescope refuse privileged authority.
 await mutate(`UPDATE oa_step_up_challenges SET consumed_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email='owner@example.com'); UPDATE oa_sessions SET created_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email='owner@example.com'); UPDATE oa_tokens SET consumed_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email='owner@example.com') AND consumed_at IS NOT NULL;`)
 assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: 'read', scope })).status, 403)
 assert.equal((await post(settings + '/rotate', { id: read.credential.id })).status, 403)
 assert.equal((await post(settings + '/rescope', { id: read.credential.id, scope })).status, 403)
 assert.equal((await post(settings + '/revoke', { id: read.credential.id })).status, 200)
 assert.equal((await inspect(read.secret)).status, 401)
 ownerCookie = await freshOwner()
 for (const action of ['membership.change', 'credential.mint', 'approval.create', 'retention.change', 'installation.export', 'connector.secret.read', 'source.retire', 'monitor.weaken']) {
  assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: 'proposal', scope: { ...scope, actions: [action] } })).status, 403)
 }
 assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: 'read', scope, expiresAt: Date.now() + 731 * 86400000 })).status, 400)
 assert.equal((await post(settings + '/mint', { name: 'Checkout investigation', class: 'read', scope, requestsPerMinute: 0 })).status, 400)
 const identities = {}
 for (const kind of Object.keys(kindActions)) identities[kind] = await mint(kind)
 assert.notEqual(identities.proposal.credential.id, identities.execution.credential.id)
 assert.equal((await post(settings + '/rotate', { id: identities.execution.credential.id, overlapSeconds: 1 })).status, 400)
 assert.equal((await post(settings + '/rotate', { id: identities.read.credential.id, overlapSeconds: 604801 })).status, 400)
 const expiring=await mint('read')
 await mutate(`UPDATE porthole_credentials SET expires_at=created_at+1 WHERE id=${literal(expiring.credential.id)}`)
 assert.equal((await inspect(expiring.secret)).status,401)
 const rotatedResponse = await post(settings + '/rotate', { id: identities.read.credential.id, overlapSeconds: 60 })
 assert.equal(rotatedResponse.status, 201)
 const rotated = await rotatedResponse.json(); secrets.push(rotated.secret)
 assert.deepEqual(rotated.credential.scope, identities.read.credential.scope)
 assert.deepEqual(rotated.credential.quotas, identities.read.credential.quotas)
 assert.equal((await inspect(identities.read.secret)).status, 200)
 assert.equal((await inspect(rotated.secret)).status, 200)
 const noOverlapResponse = await post(settings + '/rotate', { id: identities.execution.credential.id, overlapSeconds: 0 })
 assert.equal(noOverlapResponse.status, 201)
 const noOverlap = await noOverlapResponse.json(); secrets.push(noOverlap.secret)
 assert.equal((await inspect(identities.execution.secret)).status, 401)
 assert.equal((await inspect(noOverlap.secret)).status, 200)
 const changed = await post(settings + '/rescope', { id: identities.proposal.credential.id, scope: { ...scope, signals: ['logs'], actions: ['telemetry.read'] } })
 assert.equal(changed.status, 200)
 assert.deepEqual((await (await inspect(identities.proposal.secret)).json()).scope.actions, ['telemetry.read'])
 // Custodian removal and ingest continuity share the real membership batch.
 adminCookie = await signIn('synthetic-porthole-83@example.com')
 const custodialRead = await mint('read', adminCookie)
 const custodialIngest = await mint('ingest', adminCookie)
 const custodialChange = await mint('change-event', adminCookie)
 const adminId = (await sql("SELECT id FROM oa_operators WHERE email='synthetic-porthole-83@example.com'"))[0].id
 const removal = await post('/app/settings/members/remove', { operatorId: adminId })
 assert.equal(removal.status, 200)
 assert.equal((await inspect(custodialRead.secret)).status, 401)
 assert.equal((await inspect(custodialChange.secret)).status, 401)
 const continuous = await inspect(custodialIngest.secret)
 assert.equal(continuous.status, 200)
 assert.notEqual((await continuous.json()).custodianId, adminId)
 const suspended = (await sql(`SELECT status FROM porthole_credentials WHERE id=${literal(custodialRead.credential.id)}`))[0]
 assert.equal(suspended.status, 'suspended')
 // Restart cannot resurrect revoked or custodially suspended credentials.
 await restartWorker()
 assert.equal((await inspect(read.secret)).status, 401)
 assert.equal((await inspect(custodialRead.secret)).status, 401)
 assert.equal((await inspect(custodialIngest.secret)).status, 200)
 if (browser) secrets.push(...await credentialBrowserJourney({ origin, cookie: await freshOwner() }))
 assert.equal(typeof getLogs, 'function', 'the harness supplies captured request logs for the planted-secret search')
 const logs = getLogs()
 for (const secret of secrets) assert.ok(!logs.includes(secret), 'credential secrets never appear in request logs')
 const audit = await fetch(origin + '/api/v1/audit/export', { headers: { cookie: await freshOwner() } })
 assert.equal(audit.status, 200)
 const auditText = await audit.text()
 for (const secret of secrets) assert.ok(!auditText.includes(secret), 'audit excludes credential secrets')
 console.log('Porthole credential journey passed: five classes, native fresh proof, masked storage/reveal, bounded scopes, denied mint delegation, quotas, rotation, revocation, custody handover and private logs')
}

export async function credentialBrowserJourney({ origin, cookie }) {
 const { chromium } = await import('@playwright/test')
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 const secrets = []
 try {
  for (const width of [1440, 390]) {
   const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } })
   await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
   const page = await context.newPage(), errors = []
   page.on('pageerror', error => errors.push(error.message))
   await page.goto(origin + settings)
   await page.getByRole('heading', { name: 'Credentials', exact: true }).waitFor()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'settings reflows')
   await page.keyboard.press('Tab')
   assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A')
   assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none')
   if (process.env.PORTHOLE_EVIDENCE_DIR) {
    await mkdir(process.env.PORTHOLE_EVIDENCE_DIR, { recursive: true })
    await page.screenshot({ path: join(process.env.PORTHOLE_EVIDENCE_DIR, `credentials-${width}.png`), fullPage: false })
   }
   if(process.env.PORTHOLE_EVIDENCE_DIR) {
    for(const status of ['active','revoked','suspended','expired']) {
     const row=page.locator('li').filter({has:page.locator('dd').filter({hasText:new RegExp('^'+status+'$')})}).first()
     await row.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`credential-${status}-${width}.png`)})
    }
    await page.locator('form[action="/app/settings/credentials/mint"]').screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`credential-mint-${width}.png`)})
   }
   await page.getByLabel('Name', { exact: true }).fill('Checkout investigation')
   await page.getByRole('button', { name: 'Mint credential', exact: true }).click()
   await page.getByRole('heading', { name: 'Save your credential', exact: true }).waitFor()
   const secret = await page.getByRole('textbox').inputValue()
   assert.ok(/^ph_[A-Za-z0-9_-]{43}$/.test(secret)); secrets.push(secret)
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'one-time reveal reflows')
   if(process.env.PORTHOLE_EVIDENCE_DIR) await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`credential-reveal-${width}.png`),fullPage:true,mask:[page.getByRole('textbox')]})
   // Never photograph the revealed secret into the evidence artifacts.
   await page.getByRole('link', { name: 'Return to Credentials', exact: true }).click()
   assert.ok(!(await page.content()).includes(secret), 'secret cannot be recovered from the list')
   await context.clearCookies()
   const denied = await page.goto(origin + settings)
   assert.equal(denied.status(), 401)
   await page.getByRole('alert').waitFor()
   if(process.env.PORTHOLE_EVIDENCE_DIR) await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`credentials-signed-out-${width}.png`),fullPage:true})
   assert.deepEqual(errors, [])
   await context.close()
  }
 } finally { await browser.close() }
 return secrets
}
