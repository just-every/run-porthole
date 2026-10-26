import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, writeFile, stat, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {sourceDefinitions} from './splunk-extraction-edge.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const preload = fileURLToPath(new URL('./splunk-extraction-edge.mjs', import.meta.url))
const syntheticToken = 'synthetic-porthole-auth-43'

export async function splunkExtractionJourney() {
  const directory = await mkdtemp(join(tmpdir(), 'porthole-splunk-'))
  const edge = join(directory, 'edge.json'), historyPath = join(directory, 'requests.json')
  const output = join(directory, 'export.json'), checkpoint = output + '.checkpoint.json'
  let config = {scenario: 'rate', now: 1_800_000_000_000, history: historyPath}
  const configure = async changes => { config = {...config, ...changes}; await writeFile(edge, JSON.stringify(config), {mode: 0o600}) }
  const requests = async () => JSON.parse(await readFile(historyPath, 'utf8'))
  const run = (extra = [], env = {}) => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', preload, 'scripts/splunk-export.mjs', '--realm', 'us0', '--output', output, ...extra], {
      cwd: root, env: {...process.env, SPLUNK_ACCESS_TOKEN: syntheticToken, PORTHOLE_SPLUNK_EDGE: edge, ...env}, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', bytes => { stdout += bytes })
    child.stderr.on('data', bytes => { stderr += bytes })
    child.on('error', reject)
    child.on('close', code => {
      assert.ok(!stdout.includes(syntheticToken) && !stderr.includes(syntheticToken), 'CLI logs never contain the authentication value')
      resolveResult({code, stdout, stderr})
    })
  })
  const absent = async path => assert.rejects(stat(path), {code: 'ENOENT'})
  const privateState = async () => {
    assert.equal((await stat(checkpoint)).mode & 0o777, 0o600)
    assert.ok(!(await readFile(checkpoint, 'utf8')).includes(syntheticToken))
  }
  try {
    await writeFile(historyPath, '[]', {mode: 0o600}); await configure({})
    let result = await run()
    assert.equal(result.code, 75); await absent(output); await privateState()
    let state = JSON.parse(await readFile(checkpoint, 'utf8'))
    assert.equal(state.records.charts.length, 1); assert.equal(state.pendingIndex, 1)
    const initialRequests = (await requests()).length
    result = await run(['--resume']); assert.equal(result.code, 75)
    assert.equal((await requests()).length, initialRequests, 'persisted Retry-After seconds prevent early requests')
    await configure({now: config.now + 31_000})
    result = await run(['--resume']); assert.equal(result.code, 75); await absent(output); await privateState()
    state = JSON.parse(await readFile(checkpoint, 'utf8')); assert.equal(state.records.charts.length, 100)
    const secondRequests = (await requests()).length
    result = await run(['--resume']); assert.equal(result.code, 75)
    assert.equal((await requests()).length, secondRequests, 'persisted Retry-After date prevents early requests')
    await configure({now: config.now + 61_000})
    result = await run(['--resume']); assert.equal(result.code, 0, result.stderr)
    const original = await readFile(output)
    assert.deepEqual(JSON.parse(original), sourceDefinitions(), 'detail resources retain every original source field')
    assert.equal((await stat(output)).mode & 0o777, 0o600); await privateState()
    const history = await requests()
    for (const event of history) { assert.equal(event.method, 'GET'); assert.equal(event.authorized, true); assert.equal(event.noRedirect, true) }
    const frequencies = new Map()
    for (const event of history) frequencies.set(event.path, (frequencies.get(event.path) ?? 0) + 1)
    for (const [path, count] of frequencies) assert.equal(count, path === '/v2/chart/synthetic-porthole-1' || path === '/v2/chart?offset=100&limit=100' ? 2 : 1, 'resume does not repeat completed discovery or detail fetches')
    assert.ok(history.some(event => event.path === '/v2/chart?offset=100&limit=100'))
    result = await run(['--resume']); assert.notEqual(result.code, 0)
    assert.deepEqual(await readFile(output), original, 'completed output is immutable')
    assert.equal((await requests()).length, history.length)
    await rm(output); await rm(checkpoint)
    for (const scenario of ['auth', 'server', 'network', 'invalid', 'oversize', 'detail-secret', 'reflected', 'size-total', 'duplicate', 'drift', 'cap']) {
      await writeFile(historyPath, '[]'); await configure({scenario})
      result = await run(); assert.notEqual(result.code, 0, scenario); await absent(output); await privateState()
      assert.ok(!result.stderr.includes('synthetic-porthole-source-secret'))
      assert.ok(!(await readFile(checkpoint, 'utf8')).includes('synthetic-porthole-source-secret'))
      if (scenario === 'duplicate' || scenario === 'drift') {
        const count = (await requests()).length
        result = await run(['--resume']); assert.notEqual(result.code, 0)
        assert.equal((await requests()).length, count, 'unstable pagination cannot be resumed as complete')
      }
      await rm(checkpoint)
    }
    await writeFile(historyPath, '[]'); await configure({scenario: 'good'})
    result = await run([], {SPLUNK_ACCESS_TOKEN: ''}); assert.notEqual(result.code, 0)
    result = await run(['--token', 'synthetic-porthole-rejected']); assert.notEqual(result.code, 0)
    result = await run(['--realm', 'us0.evil.invalid']); assert.notEqual(result.code, 0)
    assert.equal((await requests()).length, 0)
    assert.ok((await readdir(directory)).every(name => !name.endsWith('.lock') && !name.endsWith('.tmp')))
    return {definitions: JSON.parse(original), requestCount: history.length}
  } finally { await rm(directory, {recursive: true, force: true}) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await splunkExtractionJourney()
  console.log('Splunk extraction public-command journey passed.')
}
