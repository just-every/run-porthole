import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { hashToken } from '../../src/modules/operator-auth/crypto.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyAudit } from '../../scripts/porthole/verify-audit.mjs'

const privateResponse = response => {
 assert.equal(response.headers.get('cache-control'), 'no-store')
 assert.match(response.headers.get('x-robots-tag'), /noindex/)
}
export const form = (origin, cookie, body) => ({ method: 'POST', redirect: 'manual', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
export const packet = async (origin, cookie) => {
 const response = await fetch(`${origin}/api/v1/audit/export`, { headers: { cookie } })
 assert.equal(response.status, 200); privateResponse(response)
 return response.json()
}
export async function auditJourney({ origin, cookie, persist, restartWorker }) {
 // Public-door journey: native auth mutations + versioned audit + offline reader.
 for (const path of ['/api/v1/audit', '/api/v1/audit/export', '/app/audit']) {
  const response = await fetch(origin + path)
  assert.equal(response.status, 401); privateResponse(response)
  assert.doesNotMatch(await response.text(), /records|actorRef|checkpoint/)
 }
 const base = await packet(origin, cookie)
 const planted = ['synthetic-porthole-1@example.com', 'synthetic-porthole-2', 'synthetic-porthole-3 restricted query literal']
 const invited = await fetch(`${origin}/auth/invite`, form(origin, cookie, { email: planted[0], displayName: planted[2], role: 'member', token: planted[1] }))
 assert.equal(invited.status, 202)
 const operation = invited.headers.get('x-porthole-operation')
 assert.match(operation, /^[a-f0-9-]{36}$/)
 const operators = await (await fetch(`${origin}/auth/operators`, { headers: { cookie } })).json()
 const target = operators.find(row => row.email === planted[0])
 assert.ok(target)
 const invalid = await fetch(`${origin}/auth/operator/role`, form(origin, cookie, { operatorId: target.id, role: planted[2] }))
 assert.equal(invalid.status, 400)
 // A forged mutation does not get authority merely because it has an owner cookie.
 const forged = await fetch(`${origin}/auth/operator/role`, { ...form(origin, cookie, { operatorId: target.id, role: 'admin' }), headers: { cookie, origin: 'https://synthetic-porthole.invalid', 'content-type': 'application/json' } })
 assert.equal(forged.status, 403)
 const changed = await fetch(`${origin}/auth/operator/role`, form(origin, cookie, { operatorId: target.id, role: 'admin' }))
 assert.equal(changed.status, 200)
 const changedOperator = await changed.json()
 const invalidRead = await fetch(`${origin}/api/v1/audit?query=${encodeURIComponent(planted[2])}&token=${planted[1]}`, { headers: { cookie } })
 assert.equal(invalidRead.status, 400)
 for (const query of ['after=-1', 'limit=0', 'limit=101', 'limit=1&limit=2', 'through=9999999999999999999999']) {
  assert.equal((await fetch(`${origin}/api/v1/audit?${query}`, { headers: { cookie } })).status, 400)
 }
 const crossSite = await fetch(`${origin}/api/v1/audit`, { headers: { cookie, 'sec-fetch-site': 'cross-site' } })
 assert.equal(crossSite.status, 403)
 const exported = await packet(origin, cookie)
 assert.ok(exported.checkpoint.sequence > base.checkpoint.sequence)
 assert.equal(verifyAudit(exported, exported.checkpoint.hash), exported.records.length)
 const rows = exported.records.map(row => row.entry)
 const pair = rows.filter(row => row.operationRef === operation)
 assert.deepEqual(pair.filter(row=>row.phase!=='committed').map(row => row.phase), ['attempted', 'succeeded'])
 assert.equal(pair.at(-1).status, 202)
 assert.ok(pair.some(row=>row.phase==='committed' && row.entityRef===target.id))
 assert.equal(pair[0].action, 'membership.invite')
 assert.ok(rows.some(row => row.action === 'membership.role' && row.phase === 'denied' && row.status === 403))
 assert.ok(rows.some(row => row.action === 'membership.role' && row.phase === 'succeeded' && row.status === 200 && row.entityRef === target.id && row.revision === changedOperator.version && Number.isSafeInteger(row.actorRevision)))
 for (const row of rows) {
  assert.ok(Number.isSafeInteger(row.occurredAt) && row.recordedAt >= row.occurredAt)
  assert.ok(row.actorRef === null || /^[a-f0-9-]{36}$/.test(row.actorRef))
 }
 for (const value of [...planted, ...cookie.split('; ').map(value => value.split('=')[1])]) assert.ok(!JSON.stringify(exported).includes(value), 'private contents never enter export')
 // A pinned query remains reproducible while audit of its reads keeps growing.
 const getPage = async after => {
  const response = await fetch(`${origin}/api/v1/audit?after=${after}&through=${exported.checkpoint.sequence}&limit=3`, { headers: { cookie } })
  assert.equal(response.status, 200); return response.json()
 }
 let after = 0, collected = []
 do { const value = await getPage(after); collected.push(...value.records); after = value.next } while (after !== null)
 assert.deepEqual(collected, exported.records)
 // Concurrent actions must produce one contiguous chain, never fork or lose rows.
 const concurrent = await Promise.all(Array.from({ length: 6 }, () => fetch(`${origin}/auth/operator/role`, form(origin, cookie, { operatorId: target.id, role: 'admin' }))))
 assert.ok(concurrent.every(response => response.status === 200))
 const concurrentExport = await packet(origin, cookie)
 assert.equal(verifyAudit(concurrentExport, concurrentExport.checkpoint.hash), concurrentExport.records.length)
 console.log('Audit actions, privacy, pinned reads and concurrent chain passed')
 for (const response of concurrent) {
  assert.equal(concurrentExport.records.filter(row => row.entry.operationRef === response.headers.get('x-porthole-operation') && row.entry.phase!=='committed').length, 2)
 }
 // The independent reader catches content modification, deletion, reordering,
 // a truncated suffix, and a substituted checkpoint against a retained anchor.
 for (const corrupt of [
  value => { value.records[0].entry.action = 'changed' },
  value => { value.records.splice(1, 1) },
  value => { [value.records[0], value.records[1]] = [value.records[1], value.records[0]] },
  value => { value.records.pop() },
  value => { value.checkpoint.hash = '0'.repeat(64) },
 ]) { const value = structuredClone(exported); corrupt(value); assert.throws(() => verifyAudit(value, exported.checkpoint.hash)) }
 const scratch = await mkdtemp(join(tmpdir(), 'porthole-audit-'))
 try {
  const file = join(scratch, 'audit.json'); await writeFile(file, JSON.stringify(exported))
  assert.match(execFileSync(process.execPath, ['scripts/porthole/verify-audit.mjs', file, exported.checkpoint.hash], { encoding: 'utf8' }), /Verified/)
 } finally { await rm(scratch, { recursive: true, force: true }) }
 await restartWorker()
 console.log('Audit restart completed')
 const restored = await packet(origin, cookie)
 assert.deepEqual(restored.records.slice(0, concurrentExport.records.length), concurrentExport.records)
 assert.equal(verifyAudit(restored, restored.checkpoint.hash), restored.records.length)
 // Attempt to bypass append-only guards with the owner's real D1 CLI. This is
 // a storage attack, not an application mock; public export must remain exact.
 const sql = command => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } })
 for (const command of ['UPDATE porthole_audit_entries SET hash=hash WHERE sequence=1', 'DELETE FROM porthole_audit_entries WHERE sequence=1']) assert.throws(() => sql(command), /audit_append_only/)
 // An unavailable audit ledger must gate the mutation while the separate
 // health door still reports missing pipeline coverage truthfully.
 await restartWorker(() => sql('ALTER TABLE porthole_audit_entries RENAME TO porthole_audit_unavailable'))
 try {
  const refusal = await fetch(`${origin}/auth/operator/role`, form(origin, cookie, { operatorId: target.id, role: 'member' }))
  assert.equal(refusal.status, 503)
  assert.equal((await refusal.json()).error, 'audit_unavailable')
  const current = await (await fetch(`${origin}/auth/operators`, { headers: { cookie } })).json()
  assert.equal(current.find(row => row.id === target.id).role, 'admin')
  const health = await fetch(`${origin}/api/v1/health`, { headers: { cookie } })
  assert.equal(health.status, 200); assert.equal((await health.json()).status, 'Unknown')
  await browserProof({ origin, cookie, paths: ['/app/audit'], name: 'audit-unavailable' })
 } finally { await restartWorker(() => sql('ALTER TABLE porthole_audit_unavailable RENAME TO porthole_audit_entries')) }
 // Provision a synthetic native member/session as authorization setup in the
 // real D1 store. This is not sign-in evidence: the public probes below exercise
 // the production session verifier and native revocation without a mock server.
 const memberId = randomUUID(), sessionId = randomUUID(), sessionToken = randomBytes(32).toString('base64url')
 const sessionHash = await hashToken('runtime-session-secret-1234567890123456', 'session', sessionToken)
 const now = Date.now()
 await restartWorker(() => sql(`INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES('${memberId}','synthetic-porthole-5@example.com','synthetic-porthole-6','member','active',1,${now}); INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES('${sessionId}','${sessionHash}','${memberId}',1,'native',${now},${now + 3600000})`))
 const memberCookie = `${cookie.split('=')[0]}=${sessionToken}`
 const memberSession = await fetch(`${origin}/auth/session`, { headers: { cookie: memberCookie } })
 assert.equal(memberSession.status, 200); assert.equal((await memberSession.json()).operator.role, 'member')
 for (const path of ['/api/v1/audit', '/api/v1/audit/export', '/api/v1/health', '/app/audit', '/app/health']) {
  const restricted = await fetch(origin + path, { headers: { cookie: memberCookie } })
  assert.equal(restricted.status, 403); privateResponse(restricted)
  assert.doesNotMatch(await restricted.text(), /records|actorRef|checkpoint/)
 }
 const deniedMutation = await fetch(`${origin}/auth/operator/role`, form(origin, memberCookie, { operatorId: memberId, role: 'admin' }))
 assert.equal(deniedMutation.status, 403)
 await browserProof({ origin, cookie: memberCookie, paths: ['/app/audit', '/app/health'], name: 'restricted' })
 const revoked = await fetch(`${origin}/auth/session/revoke`, form(origin, cookie, { sessionId }))
 assert.equal(revoked.status, 204)
 for (const path of ['/api/v1/audit', '/api/v1/audit/export', '/api/v1/health']) assert.equal((await fetch(origin + path, { headers: { cookie: memberCookie } })).status, 401)
 const refusedHistory = await packet(origin, cookie)
 assert.ok(refusedHistory.records.some(row => row.entry.actorRef === memberId && row.entry.phase === 'denied' && row.entry.action === 'membership.role'))
 assert.ok(!JSON.stringify(refusedHistory).includes(sessionToken))
 assert.ok(!JSON.stringify(refusedHistory).includes('synthetic-porthole-5@example.com'))
 console.log('Audit immutable guards, unavailable-store refusal, native non-owner refusal and immediate revocation passed')
 const unchanged = await packet(origin, cookie)
 assert.deepEqual(unchanged.records.slice(0, restored.records.length), restored.records)
 await browserProof({ origin, cookie, paths: ['/app/audit?limit=2', '/app/audit?after=0&through=0', '/app/audit?limit=0'], name: 'audit' })
 console.log('Porthole audit journey passed: real auth actions/refusals, private opaque records, concurrency, reproducible pagination, offline tamper detection, restart, immutable storage and browser states at 1440/390')
}
export async function healthJourney({ origin, cookie }) {
 for (const path of ['/api/v1/health', '/app/health']) {
  const response = await fetch(origin + path)
  assert.equal(response.status, 401); privateResponse(response)
 }
 const response = await fetch(`${origin}/api/v1/health`, { headers: { cookie } })
 assert.equal(response.status, 200); privateResponse(response)
 const state = await response.json()
 assert.equal(state.status, 'Unknown')
 assert.deepEqual(state.components.map(row => row.component), ['control-plane', 'collector', 'ingest', 'queue', 'storage', 'query', 'monitor-evaluation', 'delivery'])
 assert.equal(state.components[0].status, 'Healthy')
 assert.ok(state.components.slice(1).every(row => row.status === 'Unknown' && row.lastAcceptedAt === null && row.lastQueryableAt === null))
 assert.equal(state.lastAcceptedAt, null); assert.equal(state.lastQueryableAt, null)
 assert.ok(Number.isFinite(Date.parse(state.checkedAt)))
 // Public deployment liveness cannot overwrite product coverage.
 assert.equal((await (await fetch(`${origin}/health`)).json()).ok, true)
 assert.equal((await (await fetch(`${origin}/api/v1/health`, { headers: { cookie } })).json()).status, 'Unknown')
 await browserProof({ origin, cookie, paths: ['/app/health'], name: 'health' })
 console.log('Porthole independent health journey passed: native-session refusal, eight distinct components, live control-plane probe, unconfigured coverage Unknown with no invented timestamps, browser proof at 1440/390')
}
export async function browserProof({ origin, cookie, paths, name }) {
 const { chromium } = await import('@playwright/test')
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try {
  for (const width of [1440, 390]) {
   const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } })
   // This is the synthetic journey's newly issued session, never a copied real profile.
   await context.addCookies(cookie.split('; ').map(value => ({ name: value.slice(0, value.indexOf('=')), value: value.slice(value.indexOf('=') + 1), url: origin })))
   const page = await context.newPage()
   const errors = []
   page.on('pageerror', error => errors.push(error.message))
   for (const [index, path] of paths.entries()) {
    await page.goto(origin + path)
    await page.getByRole('heading', { level: 1 }).waitFor()
    assert.equal(await page.locator('main').count(), 1)
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A')
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none')
    if (process.env.PORTHOLE_EVIDENCE_DIR) {
     await mkdir(process.env.PORTHOLE_EVIDENCE_DIR, { recursive: true })
     await page.screenshot({ path: join(process.env.PORTHOLE_EVIDENCE_DIR, `${name}-${width}-${index}.png`), fullPage: true })
    }
   }
   // Direct document transport must refuse without a session at both widths.
   await context.clearCookies()
   const denied = await page.goto(origin + paths[0])
   assert.equal(denied.status(), 401)
   await page.getByRole('alert').waitFor()
   assert.deepEqual(errors, [])
   await context.close()
  }
 } finally { await browser.close() }
}
