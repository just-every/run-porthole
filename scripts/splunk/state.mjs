import {open, lstat, readFile, rename, link, unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {dirname, basename, join} from 'node:path'
import {ENDPOINTS, KINDS, MAX_BYTES, PAGE_SIZE, ExtractionError, resourceId, assertPrivateContent} from './provider.mjs'
import {readSplunkHistory} from '../../src/porthole/migration/splunk/history.ts'

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

export function assertImportBounds(records, detail, token) {
  if (encodePrivate(detail, token).length > 65536) throw new ExtractionError('Export incomplete: a source object exceeds the 64 KiB import limit. Obtain a bounded supported export; no fields were truncated.')
  if (Object.values(records).reduce((total, rows) => total + rows.length, 0) >= 200) throw new ExtractionError('Export incomplete: definitions exceed the 200-object import limit. Obtain a separately scoped supported export; no data was truncated.')
}

export function freshState(realm, output, selection={sloIds: [], history: null}) {
  return {version: 2, realm, output, endpoints: ENDPOINTS, selection, kind: 0, offset: 0, count: null, pending: [], pendingIndex: 0, records: {charts: [], dashboards: [], detectors: []}, historyProgress: null, notBefore: 0, blocked: false}
}

export async function loadState(path, realm, output, token, selection={sloIds: [], history: null}) {
  const info = await lstat(path)
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > MAX_BYTES) throw new ExtractionError('Export incomplete: resume checkpoint must be a private regular file of at most 1 MiB.')
  let state
  try {
    const bytes = await readFile(path)
    if (bytes.includes(Buffer.from(token))) throw new Error()
    state = JSON.parse(bytes)
  } catch { throw new ExtractionError('Export incomplete: resume checkpoint is invalid. Restart with a new private output path.') }
  assertPrivateContent(state, token)
  // Original definition-only checkpoints remain resumable with their exact scope.
  if (state?.version === 1 && !selection.sloIds.length && !selection.history) { state.version = 2; state.selection = selection; state.historyProgress = null }
  const valid = state && state.version === 2 && state.realm === realm && state.output === output && JSON.stringify(state.endpoints) === JSON.stringify(ENDPOINTS) && JSON.stringify(state.selection) === JSON.stringify(selection)
    && Number.isInteger(state.kind) && state.kind >= 0 && state.kind <= KINDS.length
    && Number.isSafeInteger(state.offset) && state.offset >= 0
    && (state.count === null || Number.isSafeInteger(state.count) && state.count >= state.offset)
    && Number.isSafeInteger(state.notBefore) && state.notBefore >= 0 && typeof state.blocked === 'boolean'
    && Array.isArray(state.pending) && state.pending.length <= PAGE_SIZE && state.pending.every(resourceId) && new Set(state.pending).size === state.pending.length
    && Number.isInteger(state.pendingIndex) && state.pendingIndex >= 0 && state.pendingIndex <= state.pending.length
    && state.records && KINDS.every(kind => Array.isArray(state.records[kind]) && state.records[kind].every(record => record && typeof record === 'object' && !Array.isArray(record) && resourceId(record.id)))
  if (!valid) throw new ExtractionError('Export incomplete: resume checkpoint does not match the realm, endpoints or destination. Restart with a new private output path.')
  const selectedValid = validSelectedState(state, selection)
  if (!selectedValid) throw new ExtractionError('Export incomplete: selected resource checkpoint is inconsistent. Restart with a new private output path.')
  const allRecords = Object.values(state.records).flat()
  if (allRecords.length > 200 || allRecords.some(record => encodePrivate(record, token).length > 65536)) throw new ExtractionError('Export incomplete: checkpoint exceeds the supported source-object bounds. Restart with a bounded authorized export.')
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

function validSelectedState(state, selection) {
  if (Object.keys(state.records).some(kind => ![...KINDS, 'slos', 'history'].includes(kind))) return false
  const slos = state.records.slos
  if (slos !== undefined && (!Array.isArray(slos) || slos.length > selection.sloIds.length || slos.some((record, i) => !record || record.id !== selection.sloIds[i]))) return false
  const histories = state.records.history
  if (histories !== undefined && (!selection.history || !Array.isArray(histories) || histories.length > 1 || histories.some(record => !readSplunkHistory(record).ok || JSON.stringify(record.request) !== JSON.stringify(selection.history)))) return false
  const progress = state.historyProgress
  if (progress === null) return true
  if (!selection.history || !progress || typeof progress !== 'object' || !progress.metadata || typeof progress.metadata !== 'object' || Array.isArray(progress.metadata)) return false
  const response = progress.response
  if (response === null) return Object.keys(progress.metadata).length === 0
  if (!response || typeof response !== 'object' || !response.data || typeof response.data !== 'object' || Array.isArray(response.data) || !Array.isArray(response.errors) || response.errors.length) return false
  return Object.keys(progress.metadata).every(id => Object.hasOwn(response.data, id))
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
