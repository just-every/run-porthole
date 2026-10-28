import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail} from '../security/authority'
import {input} from '../security/input'
import {privateHeaders} from '../document'
import {publicHeaders} from '../publication/public'
import {themeFrame} from '../../base/theme-frame'
import {fontHead} from '../../base/font-head'
import branding from '../../branding.json'
import {current} from './store'
import {publicNotebook,type NotebookPublication} from './publication-model'
import {liveNotebookPublication,previewNotebook,publicationFor,approveNotebook,revokeNotebook} from './publication-store'
import {publicationRoot,publicationSettings,notebookPublicationReview,publicNotebookFields} from './publication-page'
import {unavailablePage} from './page'

export async function notebookPublicationResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),publicMatch=url.pathname.match(/^\/shared\/notebooks\/([a-f0-9-]{36})$/),match=url.pathname.match(/^\/(api\/porthole\/v1|app\/settings)\/notebooks\/([a-f0-9-]{36})\/publications(?:\/([a-f0-9-]{36})(?:\/(approve|revoke))?)?$/)
 if(!publicMatch&&!match)return null
 const page=match?.[1]==='app/settings',json=(v:unknown,status=200)=>Response.json(v,{status,headers:privateHeaders})
 try {
  if(url.search)fail('invalid_notebook_publication_query',400)
  if(publicMatch) {
   if(!['GET','HEAD'].includes(request.method))fail('method_not_allowed',405)
   const row=await env.DB.prepare(`SELECT projection,expires_at FROM porthole_notebook_publications WHERE id=? AND state='published' AND approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at>? AND ${liveNotebookPublication}`).bind(publicMatch[1],Date.now()).first<{projection:string;expires_at:number}>()
   if(!row)fail('notebook_publication_not_found',404)
   const p=publicNotebook(JSON.parse(row.projection)),frame=await themeFrame({href:'/rer-theme.css',productName:branding.name,accentColor:branding.primaryColor})
   const html=`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fontHead}${frame.head}</head><body><main>${frame.brand}${publicNotebookFields(p)}<p>Expires ${new Date(row.expires_at).toISOString()}.</p></main></body></html>`
   return new Response(request.method==='HEAD'?null:html,{headers:{...publicHeaders,'content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin; ${frame.policy}`}})
  }
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  const [, ,notebookId,id,action]=match!,post=request.method==='POST'
  const actor=await authority(request,env,{post,stepUp:post&&action!=='revoke'})
  if(actor.member.role!=='owner'||actor.session.kind!=='native'||actor.session.operator.role!=='owner')fail('native_notebook_owner_required')
  const source=await current(env,actor,notebookId)
  if(!post) {
   if(action)fail('method_not_allowed',405)
   if(id) {const row=await publicationFor(env,actor,notebookId,id);return page?notebookPublicationReview(row):json(row)}
   const history=(await env.DB.prepare(`SELECT * FROM porthole_notebook_publications WHERE notebook_id=? AND ${actor.fence} ORDER BY created_at DESC,id`).bind(notebookId,...actor.args).all<NotebookPublication>()).results
   return page?publicationSettings(source,history):json({publications:history})
  }
  const data=await input(request)
  if(source.state!=='active')fail('notebook_restore_inactive',409)
  let row:NotebookPublication
  if(!id)row=await previewNotebook(request,env,actor,notebookId,data)
  else {
   row=await publicationFor(env,actor,notebookId,id)
   if(action==='approve')row=await approveNotebook(env,actor,row,data)
   else if(action==='revoke')row=await revokeNotebook(env,actor,row)
   else fail('method_not_allowed',405)
  }
  return page?new Response(null,{status:303,headers:{...privateHeaders,location:publicationRoot(notebookId)+'/'+row.id,'x-porthole-entity':row.id}}):json(row,id?200:201)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_notebook_publication':'notebook_publication_unavailable'
  if(publicMatch)return new Response(request.method==='HEAD'?null:'Snapshot unavailable',{status,headers:{...publicHeaders,'content-type':'text/plain; charset=utf-8'}})
  return page?unavailablePage(code,status):json({error:code},status)
 }
}
