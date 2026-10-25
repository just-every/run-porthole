import { themeFrame } from '../base/theme-frame'
import { fontHead } from '../base/font-head'
import branding from '../branding.json'

export const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
export const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
// These small read-only documents reuse Base's unchanged themed frame. No
// homepage, logo, theme or existing screen design is modified.
export async function document(title: string, body: string, status = 200, options: {forms?: boolean; operational?: boolean} = {}): Promise<Response> {
 const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
 return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · ${escape(branding.name)}</title>${fontHead}${frame.head}${options.operational?'<link rel="stylesheet" href="/porthole/operations.css">':''}</head><body><main>${frame.brand}<nav aria-label="Operations"><a href="/app/traces">Traces</a> · <a href="/app/audit">Audit</a> · <a href="/app/health">Pipeline health</a> · <a href="/app/follow-up">Follow-up</a></nav><h1>${escape(title)}</h1>${body}</main></body></html>`, {
  status, headers: { ...privateHeaders, ...(options.forms ? {'referrer-policy':'strict-origin'} : {}), 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; ${frame.policy}` },
 })
}

export function operationDocument(title:string,body:string,status=200,options:{forms?:boolean}={}) {
 return document(title,body,status,{...options,operational:true})
}
