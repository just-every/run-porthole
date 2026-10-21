import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fontHead } from '../base/font-head'
import { iconHead } from '../base/icon-head'
import { selectStyle } from '../base/select-style'
import branding from '../branding.json'
import { AppBar, type BarProps } from './bar'
import { AppHome } from './home'
import type { Viewer } from './viewer'

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
// Base's one dropdown rule (select-style.ts) rides in every app document, allowed by its hash.
const selectHash = digest(selectStyle)
const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }

/** A signed-in app document rendered once on the server: the theme and the look, Base's select rule, no script. */
export async function appDocument(title: string, body: ReactElement): Promise<Response> {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escape(title)}</title>${iconHead}<link rel="stylesheet" href="/rer-theme.css">${fontHead}<style>${selectStyle}</style></head>`
    + `<body class="app">${renderToStaticMarkup(body)}</body></html>`
  return new Response(html, { headers: { ...privateHeaders, 'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'self' 'sha256-${await selectHash}'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` } })
}

/** /app: the signed-in person's trace view. `site` is the run site, where what is built is listed. */
export const homeDocument = (viewer: Viewer, site: string) => appDocument(`Traces · ${branding.name}`, <AppHome viewer={viewer} site={site} />)

/** One of Base's server-rendered documents (sign-in, its confirmation, /setup, sign-in settings, the local hand-off)
 *  under the app's bar: Base keeps its markup, styles and headers; the bar leads its body. */
export async function withBar(response: Response, bar: BarProps = {}): Promise<Response> {
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/html')) return response
  const html = await response.text()
  if (html.includes('class="topbar"')) return new Response(html, response)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(html.replace(/<body([^>]*)>/i, (open: string) => open + renderToStaticMarkup(<AppBar {...bar} />)), { status: response.status, statusText: response.statusText, headers })
}
