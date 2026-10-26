import {open, lstat, readFile, rename, link, unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {dirname, basename, join} from 'node:path'
import {ENDPOINTS, KINDS, MAX_BYTES, PAGE_SIZE, ExtractionError, resourceId, assertPrivateContent} from './provider.mjs'

export async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

export function encodePrivate(value, token) {
  assertPrivateContent(value, token)
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.includes(Buffer.from(token))) throw new ExtractionError('Export incomplete: authentication content cannot be saved. Review the source privately before restarting.')
  if (bytes.length > MAX_BYTES) throw new ExtractionError('Export incomplete: the private export or checkpoint exceeds the 1 MiB limit. Use a separately scoped supported export; no data was truncated.')
  return bytes
}

export async function atomicWrite(path, bytes, immutable = false) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close(); handle = undefined
    if (immutable) await link(temporary, path)
    else await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    await handle?.close()
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}

export function freshState(realm, output) {
  return {version: 1, realm, output, endpoints: ENDPOINTS, kind: 0, offset: 0, count: null, pending: [], pendingIndex: 0, records: {charts: [], dashboards: [], detectors: []}, notBefore: 0, blocked: false}
}

export async function loadState(path, realm, output, token) {
  const info = await lstat(path)
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > MAX_BYTES) throw new ExtractionError('Export incomplete: resume checkpoint must be a private regular file of at most 1 MiB.')
  let state
  try {
    const bytes = await readFile(path)
    if (bytes.includes(Buffer.from(token))) throw new Error()
    state = JSON.parse(bytes)
  } catch { throw new ExtractionError('Export incomplete: resume checkpoint is invalid. Restart with a new private output path.') }
  assertPrivateContent(state, token)
  const valid = state && state.version === 1 && state.realm === realm && state.output === output && JSON.stringify(state.endpoints) === JSON.stringify(ENDPOINTS)
    && Number.isInteger(state.kind) && state.kind >= 0 && state.kind <= KINDS.length
    && Number.isSafeInteger(state.offset) && state.offset >= 0
    && (state.count === null || Number.isSafeInteger(state.count) && state.count >= state.offset)
    && Number.isSafeInteger(state.notBefore) && state.notBefore >= 0 && typeof state.blocked === 'boolean'
    && Array.isArray(state.pending) && state.pending.length <= PAGE_SIZE && state.pending.every(resourceId) && new Set(state.pending).size === state.pending.length
    && Number.isInteger(state.pendingIndex) && state.pendingIndex >= 0 && state.pendingIndex <= state.pending.length
    && state.records && KINDS.every(kind => Array.isArray(state.records[kind]) && state.records[kind].every(record => record && typeof record === 'object' && !Array.isArray(record) && resourceId(record.id)))
  if (!valid) throw new ExtractionError('Export incomplete: resume checkpoint does not match the realm, endpoints or destination. Restart with a new private output path.')
  for (let i = 0; i < KINDS.length; i++) {
    const records = state.records[KINDS[i]], ids = records.map(record => record.id)
    if (new Set(ids).size !== ids.length || (i > state.kind && records.length !== 0)
      || (i === state.kind && (records.length !== state.offset + state.pendingIndex || state.pending.slice(0, state.pendingIndex).some((id, n) => id !== records[state.offset + n]?.id)))) {
      throw new ExtractionError('Export incomplete: checkpoint progress is inconsistent. Restart with a new private output path.')
    }
  }
  if (state.blocked) throw new ExtractionError('Export incomplete: source changed during pagination. Resume is unsafe; restart with a new private output path after source changes stop.')
  return state
}

export async function acquireLock(path) {
  let lock
  try { lock = await open(path, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let pid
    try { pid = JSON.parse(await readFile(path, 'utf8')).pid } catch {}
    let live = true
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') live = false }
    }
    if (live) throw new ExtractionError('Export incomplete: destination is locked by another extraction. Wait for it to finish; inspect a stale lock privately before removing it.')
    await unlink(path)
    lock = await open(path, 'wx', 0o600)
  }
  await lock.writeFile(JSON.stringify({pid: process.pid}))
  await lock.close()
  return () => unlink(path)
}
