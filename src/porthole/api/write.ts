import type { Bindings } from '../../auth.server'
import type { ObjectRow } from '../objects/http'
import { validateBody } from '../objects/schema'
import { authority, fail, parseScope, scopeWithin } from '../security/authority'
import { input, text } from '../security/input'
import { canonical, collections, revision, representation, type Collection } from './model'

interface Receipt {fingerprint:string;response:string;status:number}
export async function writeDefinition(request:Request,env:Bindings,kind:Collection,id?:string) {
 // Native unsafe methods always require a same-origin intent header, including
 // PUT and DELETE, which are outside the existing POST form helper.
 const actor=await authority(request,env)
 if(request.headers.get('origin')!==env.AUTH_ORIGIN)fail('invalid_origin')
 if(!['owner','admin','maintainer'].includes(actor.member.role))fail('definition_change_forbidden')
 const key=request.headers.get('idempotency-key')
 if(!key || !/^[A-Za-z0-9._:-]{8,120}$/.test(key))fail('idempotency_key_required',400)
 const method=request.method,previousRevision=id?revision(request):null
 const data=await input(request)
 if(Object.keys(data).some(value=>!['name','scope','body'].includes(value)))fail('invalid_definition',400)
 const fingerprint=canonical({method,kind,id:id??null,revision:previousRevision,data})
 const lookup=()=>env.DB.prepare(`SELECT fingerprint,response,status FROM porthole_api_idempotency WHERE actor_ref=? AND request_key=? AND ${actor.fence}`).bind(actor.member.operatorId,key,...actor.args).first<Receipt>()
 const replay=async(receipt:Receipt)=> {
  if(receipt.fingerprint!==fingerprint)fail('idempotency_conflict',409)
  const value=JSON.parse(receipt.response) as ReturnType<typeof representation>
  if(!scopeWithin(value.scope,actor.member.scope))fail('scope_forbidden')
  const current=await env.DB.prepare('SELECT scope FROM porthole_objects WHERE id=?').bind(value.id).first<{scope:string}>()
  if(current && !scopeWithin(JSON.parse(current.scope),actor.member.scope))fail('scope_forbidden')
  return {value,status:receipt.status,replayed:true,actor}
 }
 const receipt=await lookup()
 if(receipt)return replay(receipt)
 const previous=id?await env.DB.prepare('SELECT * FROM porthole_objects WHERE id=? AND kind=?').bind(id,collections[kind]).first<ObjectRow>():null
 if(id && (!previous || previous.revision!==previousRevision)) {const late=await lookup();if(late)return replay(late)}
 if(id && (!previous || !scopeWithin(JSON.parse(previous.scope),actor.member.scope)))fail('configuration_not_found',404)
 if(previous && previous.revision!==previousRevision)fail('revision_conflict',412)
 if(previous?.state==='quarantined')fail('configuration_quarantined',409)
 const now=Date.now(),objectId=id??crypto.randomUUID(),nextRevision=(previousRevision??0)+1
 const scope=parseScope(data.scope)
 if(!scope.services.length || !scope.environments.length || !scopeWithin(scope,actor.member.scope))fail('scope_forbidden')
 const row:ObjectRow={id:objectId,kind:collections[kind],name:text(data.name),scope:JSON.stringify(scope),body:JSON.stringify(validateBody(collections[kind],data.body)),revision:nextRevision,state:'inactive',created_at:previous?.created_at??now,updated_at:now}
 const value=representation(row),status=method==='POST'?201:200
 const absent='NOT EXISTS(SELECT 1 FROM porthole_api_idempotency WHERE actor_ref=? AND request_key=?)'
 const guard=`${actor.fence} AND ${absent}`,guardArgs=[...actor.args,actor.member.operatorId,key]
 const mutation=method==='POST'?env.DB.prepare(`INSERT INTO porthole_objects SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(row.id,row.kind,row.name,row.scope,row.body,row.revision,row.state,row.created_at,row.updated_at,...guardArgs)
  :env.DB.prepare(`UPDATE porthole_objects SET name=?,scope=?,body=?,revision=?,state='inactive',updated_at=? WHERE id=? AND kind=? AND revision=? AND state!='quarantined' AND ${guard}`).bind(row.name,row.scope,row.body,row.revision,now,objectId,collections[kind],previousRevision,...guardArgs)
 const results=await env.DB.batch([
  mutation,
  env.DB.prepare(`INSERT OR IGNORE INTO porthole_api_idempotency SELECT ?,?,?,?,?,? WHERE changes()=1 AND ${actor.fence}`).bind(actor.member.operatorId,key,fingerprint,JSON.stringify(value),status,now,...actor.args),
 ])
 const committed=await lookup()
 if(!committed)fail(results[0].meta.changes?'authority_changed':'revision_conflict',412)
 if(committed.fingerprint!==fingerprint)fail('idempotency_conflict',409)
 return {value:JSON.parse(committed.response) as typeof value,status:committed.status,replayed:!results[0].meta.changes,actor}
}
