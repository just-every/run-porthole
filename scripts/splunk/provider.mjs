import {assertNoCredentials, reflectedCredentialMatcher} from '../../src/modules/import-kit/src/provenance/credentials.ts'

// Official wire references (opened 2026-10-26):
// https://dev.splunk.com/observability/reference/api/charts/latest
// https://dev.splunk.com/observability/reference/api/dashboards/latest
// https://dev.splunk.com/observability/reference/api/detectors/latest
export const MAX_BYTES = 1024 * 1024
export const PAGE_SIZE = 100
export const ENDPOINTS = ['/v2/chart', '/v2/dashboard', '/v2/detector']
export const KINDS = ['charts', 'dashboards', 'detectors']

export class ExtractionError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode }
}

export function assertPrivateContent(value, token) {
  try {
    assertNoCredentials(value)
    if (reflectedCredentialMatcher([token])(JSON.stringify(value))) throw new Error()
  } catch {
    throw new ExtractionError('Export incomplete: source content contains credentials or an unsafe credential encoding. Obtain a credential-free supported export before restarting; no credential values were saved.')
  }
}

export function resourceId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f]/.test(value)
}

export function retryTime(value, now = Date.now()) {
  if (value && /^\d+$/.test(value.trim())) {
    const seconds = Number(value.trim())
    if (Number.isSafeInteger(seconds) && Number.isSafeInteger(now + seconds * 1000) && now + seconds * 1000 <= 8.64e15) return now + seconds * 1000
  }
  const date = value ? Date.parse(value) : NaN
  return Number.isFinite(date) ? Math.max(now, date) : now + 60_000
}

export async function getDefinitionPage(realm, path, token) {
  let response
  try {
    response = await fetch(`https://api.${realm}.observability.splunkcloud.com${path}`, {
      method: 'GET', headers: {'X-SF-Token': token, accept: 'application/json'},
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new ExtractionError('Export incomplete: provider request failed. Check network access and the realm, then use --resume.')
  }
  if (response.status === 429) {
    const notBefore = retryTime(response.headers.get('retry-after'))
    await response.body?.cancel()
    return {notBefore}
  }
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) throw new ExtractionError('Export incomplete: provider refused access. Check the environment token and read permissions, then use --resume.')
    throw new ExtractionError('Export incomplete: provider returned an unsuccessful HTTP status. Check provider availability and read permissions, then use --resume.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ExtractionError('Export incomplete: provider returned an empty body. Use --resume after checking provider availability.')
  let length = 0
  const chunks = []
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BYTES) {
        await reader.cancel()
        throw new ExtractionError('Export incomplete: a provider response exceeds the 1 MiB import limit. Use a separately scoped supported export; no data was truncated.')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw new ExtractionError('Export incomplete: provider response could not be read. Use --resume.')
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.includes(token)) throw new ExtractionError('Export incomplete: provider content contains the authentication value and cannot be saved. Review the source privately before restarting.')
  let data
  try { data = JSON.parse(text) } catch { throw new ExtractionError('Export incomplete: provider returned invalid JSON. Check provider availability, then use --resume.') }
  assertPrivateContent(data, token)
  return {data}
}
