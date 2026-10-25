import type {Bindings} from '../../auth.server'
import {escape} from '../document'
import {fail} from '../security/authority'
import {allowedOrigins,validProjection,type PublicationRow,type Projection} from './model'
import {liveSource} from './store'
import {publicFields} from './page'
import {themeFrame} from '../../base/theme-frame'
import {fontHead} from '../../base/font-head'
import branding from '../../branding.json'

export const publicHeaders={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','content-security-policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox"}
export async function publicResponse(request:Request,env:Bindings,match:RegExpMatchArray):Promise<Response> {
 if(!['GET','HEAD'].includes(request.method))fail('method_not_allowed',405)
 const row=await env.DB.prepare(`SELECT projection,allowed_origins,expires_at FROM porthole_dashboard_publications WHERE id=? AND state='published' AND approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at>? AND ${liveSource}`).bind(match[1],Date.now()).first<Pick<PublicationRow,'projection'|'allowed_origins'|'expires_at'>>()
 if(!row)fail('publication_not_found',404)
 const projection:unknown=JSON.parse(row.projection)
 if(!validProjection(projection))fail('publication_not_found',404)
 const embed=match[2]==='embed',origins=allowedOrigins(row.allowed_origins)
 if(embed) {
  if(!request.headers.has('origin')&&!request.headers.has('referer'))fail('embed_origin_forbidden')
  for(const name of ['origin','referer']) {
   const value=request.headers.get(name)
   if(value!==null) {
    let origin:string;try{origin=new URL(value).origin}catch{return fail('embed_origin_forbidden')}
    if(name==='origin'&&value!==origin||!origins.includes(origin))fail('embed_origin_forbidden')
   }
  }
  if(!origins.length)fail('embed_origin_forbidden')
 }
 const headers=new Headers(publicHeaders)
 if(match[2].startsWith('widgets/')) {
  const panel=(projection as Projection).panels.find(p=>p.id===match[3])
  if(!panel)fail('publication_not_found',404)
  headers.set('content-type','image/svg+xml; charset=utf-8')
  const image=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180" role="img" aria-labelledby="title value"><title id="title">${escape(panel.label)}</title><rect width="640" height="180" fill="white"/><text x="20" y="40" fill="black" font-size="24">${escape(panel.label)}</text><text id="value" x="20" y="95" fill="black" font-size="32">${escape(panel.value===null?'No complete value':panel.value)} ${escape(panel.unit)}</text><text x="20" y="145" fill="black" font-size="24">${escape(panel.state)} · Frozen snapshot</text></svg>`
  return new Response(request.method==='HEAD'?null:image,{headers})
 }
 const frame=await themeFrame({href:'/rer-theme.css',productName:branding.name,accentColor:branding.primaryColor})
 headers.set('content-security-policy',`default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${embed?origins.join(' '):"'none'"}; sandbox allow-same-origin; ${frame.policy}`)
 headers.set('content-type','text/html; charset=utf-8')
 const html=`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(projection.title)}</title>${fontHead}${frame.head}</head><body><main>${frame.brand}${publicFields(projection)}<p>Expires ${escape(new Date(row.expires_at).toISOString())}.</p></main></body></html>`
 return new Response(request.method==='HEAD'?null:html,{headers})
}
