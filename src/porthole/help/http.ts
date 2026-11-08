import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,proofFence} from '../security/authority'
import {input} from '../security/input'
import {privateHeaders} from '../document'
import {products,definition} from '../handoffs/model'
import {handoffs} from '../handoffs/store'
import {handoffPage} from '../handoffs/page'
const root='/api/porthole/v1/handoffs',settings='/app/settings/integrations/handoffs'
export async function helpResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,base=[root,settings].find(r=>path===r||path.startsWith(r+'/'))
 if(!base&&!['/app/help','/app/integrations'].includes(path))return null
 const html=base!==root,config=base===settings
 try {
  if(url.search)fail('invalid_handoff_query',400)
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
  const rows=await handoffs(env,actor)
  if((config||request.method==='POST')&&(actor.member.role!=='owner'||actor.session.kind!=='native'))fail('handoff_owner_required')
  const id=base&&path!==base?path.slice(base.length+1):undefined
  if(id&&!products.some(p=>p.id===id))fail('handoff_not_found',404)
  if(request.method==='GET') {
   if(id)fail('handoff_not_found',404)
   return html?handoffPage(rows,config):Response.json({handoffs:rows.filter(r=>r.state==='active').map(row=>({...row,...products.find(p=>p.id===row.product)}))},{headers:privateHeaders})
  }
  if(!id||!base)fail('handoff_not_found',404)
  const data=await input(request)
  if(Object.keys(data).some(k=>!['revision','destination','template','confirm'].includes(k)))fail('invalid_handoff',400)
  if(data.confirm!=='save-handoff')fail('confirmation_required',400)
  const revision=Number(data.revision),current=rows.find(r=>r.product===id)?.revision??0
  if(!Number.isSafeInteger(revision)||revision!==current)fail('handoff_revision_changed',409)
  const value=definition(data),proof=proofFence(actor)
  const result=await env.DB.prepare(`INSERT INTO porthole_handoff_versions SELECT ?,?,?,?,?,?,? WHERE ${actor.fence} AND ${proof.sql} AND COALESCE((SELECT MAX(revision) FROM porthole_handoff_versions WHERE product=?),0)=?`).bind(id,revision+1,value.destination,value.template,actor.member.operatorId,Date.now(),'active',...actor.args,...proof.args,id,revision).run()
  if(!result.meta.changes)fail('handoff_revision_or_authority_changed',409)
  return html?new Response(null,{status:303,headers:{...privateHeaders,location:settings}}):Response.json({product:id,revision:revision+1,...value},{status:201,headers:privateHeaders})
 }catch(error){const known=error instanceof AuthError,status=known?error.status:503,code=known?error.code:'handoffs_unavailable';return html?handoffPage([],false,code,status):Response.json({error:code},{status,headers:privateHeaders})}
}
