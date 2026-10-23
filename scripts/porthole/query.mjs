import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Fixed read-only route. Credentials never enter arguments, JSON, output,
 * redirects or exception text. The server alone grants query authority. */
export async function runQuery({ origin, credential, query }) {
 let url
 try { url = new URL(origin) } catch { throw Error('Use the installation origin') }
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
  !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Use an HTTPS installation origin (HTTP is allowed on loopback only)')
 if (typeof credential !== 'string' || !/^ph_[A-Za-z0-9_-]{43}$/.test(credential)) throw Error('Set PORTHOLE_CREDENTIAL to a scoped read credential')
 if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('Supply a query JSON object on stdin')
 const body = JSON.stringify(query)
 if (Buffer.byteLength(body) > 8192) throw Error('Query exceeds 8192 bytes')
 let response
 try {
  response = await fetch(new URL('/api/porthole/v1/query', url), { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(30000) })
 } catch { throw Error('Query endpoint unavailable') }
 if (!response.ok) {
  let code = 'query_refused'
  try { const value = await response.json(); if (typeof value.error === 'string' && /^[a-z_]+$/.test(value.error)) code = value.error } catch {}
  throw Error(`Query refused (${response.status} ${code})`)
 }
 return response.json()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const [origin, ...extra] = process.argv.slice(2)
  if (!origin || extra.length) throw Error('Usage: node scripts/porthole/query.mjs ORIGIN < query.json')
  let text = ''
  for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 8192) throw Error('Query exceeds 8192 bytes') }
  let query
  try { query = JSON.parse(text) } catch { throw Error('Supply a query JSON object on stdin') }
  const result = await runQuery({ origin, credential: process.env.PORTHOLE_CREDENTIAL, query })
  process.stdout.write(JSON.stringify(result) + '\n')
 } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
