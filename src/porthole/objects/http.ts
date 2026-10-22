import {operationsPage} from './page'
import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { operationDocument as document,escape,privateHeaders } from '../document'
import { authority,administrative,fail,parseScope,scopeWithin } from '../security/authority'
import { input,text } from '../security/input'
import { validateBody } from './schema'
export interface ObjectRow {id:string;kind:string;name:string;scope:string;body:string;revision:number;state:string;created_at:number;updated_at:number}
const paths=new Set(['/app/operations','/app/operations/save','/app/operations/approve','/api/porthole/v1/objects','/api/porthole/v1/approvals','/api/porthole/v1/objects/activate','/app/operations/activate'])
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function objectsResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(!paths.has(url.pathname))return null
 const page=url.pathname.startsWith('/app/'),form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
 try {
  const actor=await authority(request,env,{post:request.method==='POST'})
  if(actor.member.role==='finance reader')fail('operations_forbidden')
  if(request.method==='GET' && !url.pathname.endsWith('/save') && !url.pathname.endsWith('/approve')) {
   const objects=(await env.DB.prepare(`SELECT * FROM porthole_objects WHERE ${actor.fence} ORDER BY updated_at DESC,id`).bind(...actor.args).all<ObjectRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
   if(!page)return json({objects:objects.map(row=>({...row,scope:JSON.parse(row.scope),body:JSON.parse(row.body)}))})
   return operationsPage(objects,actor.member.role)
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request),now=Date.now()
  if(url.pathname.endsWith('/activate')) {
   if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
   if(data.confirm!=='activate')fail('confirmation_required',400)
   const row=await env.DB.prepare('SELECT * FROM porthole_objects WHERE id=?').bind(text(data.id,36)).first<ObjectRow>()
   if(!row || row.kind!=='monitor' || !scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
   const result=await env.DB.prepare(`UPDATE porthole_objects SET state='active',updated_at=? WHERE id=? AND revision=? AND state='inactive' AND ${actor.fence}`).bind(now,row.id,Number(data.revision),...actor.args).run()
   if(!result.meta.changes)fail('revision_or_authority_changed',409)
   return form?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/operations'}}):json({id:row.id,revision:row.revision,state:'active'})
  }
  if(url.pathname.endsWith('/approve') || url.pathname.endsWith('/approvals')) {
   if(!['owner','admin','maintainer','responder'].includes(actor.member.role))fail('approval_forbidden')
   if(data.confirm!=='approve')fail('confirmation_required',400)
   const row=await env.DB.prepare('SELECT * FROM porthole_objects WHERE id=?').bind(text(data.id,36)).first<ObjectRow>()
   if(!row || row.kind!=='repair')fail('repair_not_found',404)
   if(row.state!=='inactive' || Number(data.revision)!==row.revision || Number(JSON.parse(row.body).expiresAt)<=now)fail('plan_not_approvable',409)
   if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
   const result=await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO porthole_object_approvals(id,object_id,revision,actor_ref,approved_at) SELECT ?,id,revision,?,? FROM porthole_objects WHERE id=? AND revision=? AND state='inactive' AND ${actor.fence}`).bind(crypto.randomUUID(),actor.member.operatorId,now,row.id,row.revision,...actor.args),
    env.DB.prepare(`UPDATE porthole_objects SET state='approved',updated_at=? WHERE id=? AND revision=? AND state='inactive' AND EXISTS(SELECT 1 FROM porthole_object_approvals WHERE object_id=? AND revision=?) AND ${actor.fence}`).bind(now,row.id,row.revision,row.id,row.revision,...actor.args),
   ])
   if(!result[0].meta.changes)fail('authority_changed',409)
   return form?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/operations'}}):json({id:row.id,revision:row.revision,state:'approved'})
  }
  if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
  const kind=text(data.kind),name=text(data.name),body=validateBody(kind,typeof data.body==='string'?JSON.parse(data.body):data.body)
  const scope=parseScope((typeof data.scope==='string'?JSON.parse(data.scope):data.scope) ?? {services:[data.service],environments:[data.environment],teams:[data.team]})
  if(!scope.services.length || !scope.environments.length || !scopeWithin(scope,actor.member.scope))fail('scope_forbidden')
  const id=data.id===undefined?crypto.randomUUID():text(data.id,36),revision=data.id===undefined?1:Number(data.revision)+1
  if(!Number.isSafeInteger(revision)||revision<1)fail('invalid_revision',400)
  if(data.id!==undefined) { const previous=await env.DB.prepare('SELECT scope FROM porthole_objects WHERE id=?').bind(id).first<{scope:string}>();if(!previous || !scopeWithin(JSON.parse(previous.scope),actor.member.scope))fail('scope_forbidden') }
  const statement=data.id===undefined?env.DB.prepare(`INSERT INTO porthole_objects SELECT ?,?,?,?,?,?,'inactive',?,? WHERE ${actor.fence}`).bind(id,kind,name,JSON.stringify(scope),JSON.stringify(body),revision,now,now,...actor.args):env.DB.prepare(`UPDATE porthole_objects SET name=?,scope=?,body=?,revision=?,state='inactive',updated_at=? WHERE id=? AND kind=? AND revision=? AND state!='quarantined' AND ${actor.fence}`).bind(name,JSON.stringify(scope),JSON.stringify(body),revision,now,id,kind,revision-1,...actor.args)
  const result=await statement.run()
  if(!result.meta.changes)fail('revision_or_authority_changed',409)
  return form?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/operations'}}):json({id,revision,state:'inactive'},201)
 }catch(error) {
  const status=error instanceof AuthError?error.status:typeof error==='object' && error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_definition':'operations_unavailable'
  return page?document('Operations unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/operations">Return to Operations</a></p>`,status,{forms:true}):json({error:code},status)
 }
}
