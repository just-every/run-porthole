import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { document,escape,privateHeaders } from '../document'
import { authority, fail, type Scope } from '../security/authority'
import { input,text } from '../security/input'
import { changeMember,inviteMember,listMembers,removeMember } from './store'
import { membersPage,settingsNav } from './page'
const paths=new Set(['/app/settings','/app/settings/members','/app/settings/members/invite','/app/settings/members/change','/app/settings/members/remove'])
export async function membershipResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(!paths.has(url.pathname)) return null
 const form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
 try {
  const actor=await authority(request,env,{manage:true,post:request.method==='POST'})
  if(url.searchParams.size) fail('invalid_input',400)
  if(request.method==='GET' && ['/app/settings','/app/settings/members'].includes(url.pathname)) {
   const rows=await listMembers(env,actor),migration=(await env.DB.prepare('SELECT * FROM porthole_membership_migration ORDER BY operator_id').all<Record<string,unknown>>()).results
   return document('Members',membersPage(actor,rows,migration))
  }
  if(request.method!=='POST') fail('method_not_allowed',405)
  const data=await input(request)
  if(form) {
   const scope:Scope={services:[],environments:[],teams:[]}
   for(const key of ['services','environments','teams'] as const) scope[key]=typeof data[key]==='string' ? (data[key] as string).split(',').map(value=>value.trim()).filter(Boolean):[]
   if (!(data.role==='owner' || data.role==='admin') || Object.values(scope).some(values=>values.length)) data.scope=scope
  }
  let result:unknown,status=200
  if(url.pathname.endsWith('/invite')) {result=await inviteMember(request,env,data);status=202}
  else if(url.pathname.endsWith('/change')) result=await changeMember(request,env,text(data.operatorId),data)
  else if(url.pathname.endsWith('/remove')) {if(form && data.confirm!=='remove') fail('confirmation_required',400);result=await removeMember(request,env,text(data.operatorId))}
  else fail('not_found',404)
  return form?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/settings/members'}}):Response.json(result,{status,headers:privateHeaders})
 } catch(error) {
  const code=error instanceof AuthError?error.code:'membership_unavailable',status=error instanceof AuthError?error.status:503
  return form || request.method==='GET'?document('Members unavailable',`${settingsNav}<p role="alert">${escape(code.replaceAll('_',' '))}.</p>${code==='step_up_required'?'<p>Send and confirm a new sign-in proof, then retry the change.</p><form method="post" action="/auth/step-up"><input type="hidden" name="action" value="owner:transfer"><input type="hidden" name="returnTo" value="/app/settings/members"><button>Send confirmation link</button></form>':''}<p><a href="/app/settings/members">Return to Members</a></p>`,status):Response.json({error:code},{status,headers:privateHeaders})
 }
}
