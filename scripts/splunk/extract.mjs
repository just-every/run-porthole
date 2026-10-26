import {resolve} from 'node:path'
import {ENDPOINTS, KINDS, PAGE_SIZE, ExtractionError, getDefinitionPage, resourceId} from './provider.mjs'
import {exists, encodePrivate, atomicWrite, freshState, loadState, acquireLock} from './state.mjs'
import {assertImportBounds} from './state.mjs'
import {exportSelection} from './selection.mjs'
import {extractSelected} from './extras.mjs'

export async function extractSplunk({realm, output, resume, ...selected}) {
  // A realm can supply only a bounded single DNS label; host and API paths are fixed.
  if (typeof realm !== 'string' || !/^[a-z]{2}[0-9]$/.test(realm)) throw new ExtractionError('Provide a Splunk realm such as us0 with --realm; custom hosts and URLs are not accepted.')
  if (typeof output !== 'string' || !output) throw new ExtractionError('Provide a private JSON destination with --output. Use --help for usage.')
  const token = process.env.SPLUNK_ACCESS_TOKEN
  if (!token || /[\r\n]/.test(token)) throw new ExtractionError('Set SPLUNK_ACCESS_TOKEN in the environment to an authorized read token; never pass credentials as arguments.')
  const selection = exportSelection(selected)
  encodePrivate(selection, token)
  output = resolve(output)
  if (output.includes(token)) throw new ExtractionError('Choose a private destination whose name does not contain authentication content.')
  const checkpoint = output + '.checkpoint.json'
  const unlock = await acquireLock(checkpoint + '.lock')
  try {
    if (await exists(output)) throw new ExtractionError('Completed output already exists and cannot be overwritten. Choose a new private output path.')
    const hasCheckpoint = await exists(checkpoint)
    if (hasCheckpoint && !resume) throw new ExtractionError('Incomplete checkpoint already exists. Use --resume with the same realm and output, or choose a new private output path.')
    if (!hasCheckpoint && resume) throw new ExtractionError('No resume checkpoint exists. Omit --resume to start a new extraction.')
    const state = resume ? await loadState(checkpoint, realm, output, token, selection) : freshState(realm, output, selection)
    const save = () => atomicWrite(checkpoint, encodePrivate(state, token))
    const waitError = () => new ExtractionError(`Export incomplete: provider rate limit. Resume with --resume at or after ${new Date(state.notBefore).toISOString()}. No automatic retries were made.`, 75)
    if (Date.now() < state.notBefore) throw waitError()
    await save()
    const request = async path => {
      const result = await getDefinitionPage(realm, path, token)
      if (result.notBefore !== undefined) { state.notBefore = result.notBefore; await save(); throw waitError() }
      state.notBefore = 0
      return result.data
    }
    const unstable = async () => {
      state.blocked = true; await save()
      throw new ExtractionError('Export incomplete: duplicate identifiers or changing source counts make pagination unsafe. Restart with a new private output path after source changes stop.')
    }
    while (state.kind < KINDS.length) {
      const endpoint = ENDPOINTS[state.kind], records = state.records[KINDS[state.kind]]
      if (state.pending.length === 0) {
        const page = await request(`${endpoint}?offset=${state.offset}&limit=${PAGE_SIZE}`)
        if (!page || !Number.isSafeInteger(page.count) || page.count < 0 || !Array.isArray(page.results) || page.results.length > PAGE_SIZE || page.results.some(record => !record || !resourceId(record.id))) {
          throw new ExtractionError('Export incomplete: provider list schema is invalid. Check the supported API schema before using --resume.')
        }
        if (state.kind < 2 && page.count > 10_000) throw new ExtractionError('Export incomplete: provider listing exceeds its 10,000-object result cap. Use a supported scoped export; no data was truncated.')
        if (state.count !== null && state.count !== page.count || state.offset + page.results.length > page.count || page.results.length === 0 && state.offset < page.count) await unstable()
        state.count = page.count
        const ids = new Set(records.map(record => record.id))
        for (const record of page.results) { if (ids.has(record.id)) await unstable(); ids.add(record.id) }
        state.pending = page.results.map(record => record.id); state.pendingIndex = 0
        await save()
      }
      while (state.pendingIndex < state.pending.length) {
        const id = state.pending[state.pendingIndex]
        // Lists omit important source fields (notably chart programText and tags).
        const detail = await request(`${endpoint}/${encodeURIComponent(id)}`)
        if (!detail || typeof detail !== 'object' || Array.isArray(detail) || detail.id !== id) throw new ExtractionError('Export incomplete: provider detail identity is missing or changed. Review source consistency before using --resume.')
        assertImportBounds(state.records, detail, token)
        records.push(detail); state.pendingIndex++
        encodePrivate(state.records, token)
        await save()
      }
      state.offset += state.pending.length; state.pending = []; state.pendingIndex = 0
      if (state.offset === state.count) { state.kind++; state.offset = 0; state.count = null }
      await save()
    }
    await extractSelected({state, selection, request, save, token})
    await atomicWrite(output, encodePrivate(state.records, token), true)
  } finally { await unlock() }
}
