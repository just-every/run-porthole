// Network-edge fixture for the public CLI, based on official v2 list and detail schemas:
// https://dev.splunk.com/observability/reference/api/charts/latest
// https://dev.splunk.com/observability/reference/api/dashboards/latest
// https://dev.splunk.com/observability/reference/api/detectors/latest
// Lists are {count, results}; chart lists intentionally omit programText and tags.
import {readFile, writeFile} from 'node:fs/promises'

export function sourceDefinitions() {
  return {
    charts: Array.from({length: 101}, (_, n) => ({id: `synthetic-porthole-${n}`, name: `Chart ${n}`, programText: "data('requests').sum().publish()", tags: ['team:checkout'], options: {type: 'TimeSeriesChart'}, description: 'Original source definition'})),
    dashboards: [{id: 'synthetic-porthole-dashboard', name: 'Checkout', filters: {variables: [{property: 'environment', value: ['production']}]}, charts: [{chartId: 'synthetic-porthole-0', column: 0, row: 0, width: 6, height: 1}]}],
    detectors: [{id: 'synthetic-porthole-detector', name: 'Checkout errors', programText: "A = data('errors').sum(); detect(when(A > 10)).publish('high')", tags: ['team:checkout'], rules: [{detectLabel: 'high', severity: 'Critical', notifications: [{type: 'Email', email: 'synthetic-porthole-43@example.com'}]}]}],
  }
}

if (process.env.PORTHOLE_SPLUNK_EDGE) {
  const config = JSON.parse(await readFile(process.env.PORTHOLE_SPLUNK_EDGE, 'utf8'))
  if (config.now !== undefined) Date.now = () => config.now
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    const history = JSON.parse(await readFile(config.history, 'utf8'))
    const path = url.pathname + url.search
    const prior = history.filter(item => item.path === path).length
    const event = {path, method: options?.method, host: url.host, authorized: new Headers(options?.headers).get('X-SF-Token') === process.env.SPLUNK_ACCESS_TOKEN, noRedirect: options?.redirect === 'error'}
    history.push(event)
    await writeFile(config.history, JSON.stringify(history))
    if (!event.authorized || event.method !== 'GET' || !event.noRedirect || url.host !== 'api.us0.observability.splunkcloud.com') throw new Error('Invalid edge request')
    if (config.scenario === 'network') throw new Error(process.env.SPLUNK_ACCESS_TOKEN)
    if (config.scenario === 'auth') return new Response(process.env.SPLUNK_ACCESS_TOKEN, {status: 403})
    if (config.scenario === 'server') return new Response(process.env.SPLUNK_ACCESS_TOKEN, {status: 503})
    if (config.scenario === 'invalid') return new Response(process.env.SPLUNK_ACCESS_TOKEN + ' invalid json')
    if (config.scenario === 'oversize') return new Response(' '.repeat(1024 * 1024 + 1))
    if (config.scenario === 'rate' && prior === 0) {
      if (url.pathname === '/v2/chart/synthetic-porthole-1') return new Response(process.env.SPLUNK_ACCESS_TOKEN, {status: 429, headers: {'Retry-After': '30'}})
      if (url.searchParams.get('offset') === '100') return new Response(process.env.SPLUNK_ACCESS_TOKEN, {status: 429, headers: {'Retry-After': new Date(Date.now() + 60_000).toUTCString()}})
    }
    const match = /^\/v2\/(chart|dashboard|detector)(?:\/(.+))?$/.exec(url.pathname)
    if (!match) throw new Error('Unexpected endpoint')
    const values = sourceDefinitions()[{chart: 'charts', dashboard: 'dashboards', detector: 'detectors'}[match[1]]]
    let body
    if (match[2]) {
      body = values.find(value => value.id === decodeURIComponent(match[2]))
      if (config.scenario === 'detail-secret') body = {...body, notifications: [{type: 'Webhook', headers: {Authorization: 'synthetic-porthole-source-secret'}}]}
      if (config.scenario === 'reflected') body = {...body, description: encodeURIComponent(process.env.SPLUNK_ACCESS_TOKEN)}
      if (config.scenario === 'size-total') body = {...body, description: 'x'.repeat(20_000)}
    } else {
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
      let results = values.slice(offset, offset + limit).map(value => ({id: value.id, name: value.name}))
      let count = values.length
      if (config.scenario === 'duplicate' && offset === 100) results = [{id: values[0].id, name: values[0].name}]
      if (config.scenario === 'drift' && offset === 100) count++
      if (config.scenario === 'cap') count = 10_001
      body = {count, results}
    }
    return Response.json(body)
  }
}
