import {ExtractionError, resourceId} from './provider.mjs'

export function exportSelection({sloIds=[], metricQuery, startMs, endMs, resolution}={}) {
  if (!Array.isArray(sloIds) || sloIds.length > 200 || sloIds.some(id => !resourceId(id) || id.length > 200) || new Set(sloIds).size !== sloIds.length) throw new ExtractionError('Provide distinct bounded --slo-id values from an authorized source export. SLO discovery requires a separate source search export.')
  const requested = [metricQuery, startMs, endMs, resolution].some(value => value !== undefined)
  let history = null
  if (requested) {
    const decimal = value => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if (typeof metricQuery !== 'string' || !metricQuery.trim() || metricQuery.length > 4096 || !decimal(startMs) || !decimal(endMs) || Number(endMs) <= Number(startMs) || !decimal(resolution) || ![1000, 60000, 300000, 3600000].includes(Number(resolution))) throw new ExtractionError('Historical extraction requires --metric-query, --start-ms, --end-ms and --resolution. Use exact nonnegative milliseconds and resolution 1000, 60000, 300000 or 3600000.')
    history = {query: metricQuery, startMs: Number(startMs), endMS: Number(endMs), resolution: Number(resolution)}
  }
  return {sloIds, history}
}
