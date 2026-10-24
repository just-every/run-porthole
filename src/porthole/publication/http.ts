import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {uuid,type PublicationRow} from './model'
import {approve,draft,ownerPublication,revoke,sourceDashboard} from './store'
import {publishForm,reviewPage} from './page'
import {publicHeaders,publicResponse} from './public'

export async function publicationResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,publicMatch=path.match(/^\/published\/([a-f0-9-]{36})\/(tv|embed|widgets\/([a-f0-9-]{36})\.svg)$/),form=path.match(/^\/app\/dashboards\/([a-f0-9-]{36})\/publish$/),owner=path.match(/^\/app\/dashboards\/publications\/([a-f0-9-]{36})$/),action=['/app/dashboards/publications/preview','/app/dashboards/publications/approve','/app/dashboards/publications/revoke'].includes(path)
 if(!publicMatch&&!form&&!owner&&!action)return null
 let returnTo=form||owner?path:'/app/dashboards'
 try {
  if(publicMatch)return await publicResponse(request,env,publicMatch)
  const post=request.method==='POST'
  if(action&&!post||!action&&request.method!=='GET')fail('method_not_allowed',405)
  const data=post?await input(request):{}
  if(path.endsWith('/preview')&&uuid(data.dashboardId)) {
   const filters=new URLSearchParams()
   for(const key of ['team','environment','from','through'])if(typeof data[key]==='string')filters.set(key,data[key])
   returnTo='/app/dashboards/'+data.dashboardId+'/publish'+(filters.size?'?'+filters:'')
  }else if(uuid(data.id))returnTo='/app/dashboards/publications/'+data.id
  const actor=await authority(request,env,{post,stepUp:post&&!path.endsWith('/revoke')})
  if(actor.member.role!=='owner'||actor.session.operator.role!=='owner')fail('publication_owner_required')
  if(form) {
   const source=await sourceDashboard(env,actor,form[1])
   const history=(await env.DB.prepare(`SELECT * FROM porthole_dashboard_publications WHERE dashboard_id=? AND ${actor.fence} ORDER BY created_at DESC,id`).bind(source.id,...actor.args).all<PublicationRow>()).results
   return publishForm(source,url,history)
  }
  if(owner)return reviewPage(await ownerPublication(env,actor,owner[1]))
  if(!path.endsWith('/preview')&&!uuid(data.id))fail('invalid_publication_id',400)
  const row=path.endsWith('/preview')?await draft(request,env,actor,data):path.endsWith('/approve')?await approve(env,actor,data):await revoke(env,actor,String(data.id))
  return new Response(null,{status:303,headers:{...privateHeaders,location:'/app/dashboards/publications/'+row.id,'x-porthole-entity':row.id}})
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_publication':'publication_unavailable'
  if(publicMatch)return new Response(request.method==='HEAD'?null:'Publication unavailable',{status,headers:{...publicHeaders,'content-type':'text/plain; charset=utf-8'}})
  return document('Publication unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p>${code==='step_up_required'?`<form method="post" action="/auth/step-up"><input type="hidden" name="action" value="owner:transfer"><input type="hidden" name="returnTo" value="${escape(returnTo)}"><button>Send confirmation link</button></form>`:''}<p><a href="/app/dashboards">Return to Dashboards</a></p>`,status,{forms:true})
 }
}
