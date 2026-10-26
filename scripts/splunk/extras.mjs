import {createHash} from 'node:crypto'
import {ExtractionError, resourceId} from './provider.mjs'
import {assertImportBounds} from './state.mjs'
import {readSplunkHistory, splunkHistoryLimits} from '../../src/porthole/migration/splunk/history.ts'

export async function extractSelected({state, selection, request, save, token}) {
  if (selection.sloIds.length) {
    state.records.slos ??= []
    while (state.records.slos.length < selection.sloIds.length) {
      const id = selection.sloIds[state.records.slos.length]
      const detail = await request(`/v2/slo/${encodeURIComponent(id)}`)
      if (!detail || typeof detail !== 'object' || Array.isArray(detail) || detail.id !== id) throw new ExtractionError('Export incomplete: selected SLO detail identity is missing or changed. Retain the source and review its authorized export.')
      assertImportBounds(state.records, detail, token)
      state.records.slos.push(detail)
      await save()
    }
  }
  if (!selection.history || state.records.history?.length) return
  const history = state.historyProgress ??= {response: null, metadata: {}}
  if (history.response === null) {
    const parameters = new URLSearchParams(Object.entries(selection.history).map(([key, value]) => [key, String(value)]))
    const response = await request(`/v1/timeserieswindow?${parameters}`)
    if (!response || typeof response !== 'object' || Array.isArray(response) || !response.data || typeof response.data !== 'object' || Array.isArray(response.data) || !Array.isArray(response.errors) || response.errors.length || response.code !== undefined && response.code !== 200 || Object.keys(response).some(key => !['code', 'data', 'errors'].includes(key))) throw new ExtractionError('Export incomplete: historical response reports provider errors or unqualified partial data. Review retention, paid entitlement and the exact source query before resuming.')
    const ids = Object.keys(response.data)
    if (ids.length >= 10_000 || ids.some(id => !resourceId(id) || id.length > 200)) throw new ExtractionError('Export incomplete: historical series identity or the 10,000-MTS ceiling prevents qualification. Narrow the authorized query; no history was truncated.')
    history.response = response
    await save()
  }
  for (const id of Object.keys(history.response.data)) {
    if (Object.hasOwn(history.metadata, id)) continue
    const detail = await request(`/v2/metrictimeseries/${encodeURIComponent(id)}`)
    history.metadata = {...history.metadata, [id]: detail}
    await save()
  }
  const record = {
    id: 'timeserieswindow:' + createHash('sha256').update(JSON.stringify(selection.history)).digest('hex'),
    source: 'splunk-timeserieswindow', request: selection.history,
    response: history.response, metadata: history.metadata,
    timestampUnit: 'milliseconds', limitations: splunkHistoryLimits,
  }
  const checked = readSplunkHistory(record)
  if (!checked.ok) throw new ExtractionError('Export incomplete: ' + checked.reason + '. Retain the source; no unavailable history was invented.')
  assertImportBounds(state.records, record, token)
  state.records.history = [record]
  state.historyProgress = null
  await save()
}
