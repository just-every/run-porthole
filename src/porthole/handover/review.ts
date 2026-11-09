import type {Bindings} from '../../auth.server'
import {authority,baseRole,fail,memberFor,proofFence,scopeWithin,type Authority,type Scope} from '../security/authority'
import {digest} from '../audit/store'
import {canonical} from '../ingest/model'
import {inventory,type Item} from './inventory'
interface Binding {target:string;version:number;memberRevision:number;actor:string;actorRevision:number;session:string;epoch:number;digest:string;expires:number}
export interface Choice {key:string;successor:string|null}
const encode=(value:string)=>btoa(value).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
const decode=(value:string)=>atob(value.replaceAll('-','+').replaceAll('_','/'))
async function signature(env:Bindings,value:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('handover\0'+value)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function targetFor(env:Bindings,actor:Authority,id:string) {
 const member=await memberFor(env.DB,id),row=await env.DB.prepare('SELECT version,status FROM oa_operators WHERE id=?').bind(id).first<{version:number;status:string}>()
 if(!member||!row)fail('operator_not_found',404)
 if(actor.member.role!=='owner'&&['owner','admin'].includes(member.role))fail('owner_required')
 if(row.status==='inactive')fail('member_already_removed',409)
 return {member,row}
}
export async function preview(request:Request,env:Bindings,id:string) {
 const actor=await authority(request,env,{manage:true,post:true,stepUp:true})
 const target=await targetFor(env,actor,id)
 const before=await epoch(env),items=await inventory(env,id,actor),after=await epoch(env)
 if(before!==after)fail('handover_inventory_changed',409)
 if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
 const binding:Binding={target:id,version:target.row.version,memberRevision:target.member.revision,actor:actor.member.operatorId,actorRevision:actor.member.revision,session:actor.session.id,epoch:before,digest:await digest(canonical(items)),expires:Date.now()+300000}
 const payload=encode(JSON.stringify(binding)),token=payload+'.'+await signature(env,payload)
 const members=(await env.DB.prepare(`SELECT o.id,o.display_name name,m.role,m.scope FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND o.id!=? AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors e WHERE e.actor_ref=o.id) AND ${actor.fence}`).bind(id,...actor.args).all<{id:string;name:string;role:string;scope:string}>()).results
 if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence} AND (SELECT revision FROM porthole_handover_epoch WHERE singleton=1)=?`).bind(...actor.args,before).first())fail('handover_inventory_or_authority_changed',409)
 return {operatorId:id,token,digest:binding.digest,expiresAt:binding.expires,items:items.map(item=>({...item,successors:members.filter(m=>eligible(item,m.role,JSON.parse(m.scope))).map(({id,name})=>({id,name}))}))}
}
async function epoch(env:Bindings) {return (await env.DB.prepare('SELECT revision FROM porthole_handover_epoch WHERE singleton=1').first<{revision:number}>())!.revision}
export function eligible(item:Item,role:string,scope:Scope) {
 if(!scopeWithin(item.scope,scope))return false
 if(item.mode==='custody')return ['owner','admin'].includes(role)
 if(item.mode!=='move')return false
 if(item.kind==='notebook')return role==='owner'
 if(item.kind==='follow-up')return ['owner','admin','maintainer','responder'].includes(role)
 return role!=='finance reader'
}
export async function reviewedRemoval(request:Request,env:Bindings,id:string,data:Record<string,unknown>,actor:Authority) {
 const target=await targetFor(env,actor,id)
 const observedEpoch=await epoch(env),items=await inventory(env,id,actor)
 if(observedEpoch!==await epoch(env))fail('handover_inventory_changed',409)
 // Cancelling an unused invitation confers no active ownership authority.
 if(!data.token&&(target.row.status!=='invited'||items.length))fail('handover_review_required',409)
 let binding:Binding|undefined
 if(data.token) {
  try {
   const [payload,mac,...extra]=String(data.token).split('.')
   if(extra.length||mac!==await signature(env,payload))fail('invalid_handover_review',400)
   binding=JSON.parse(decode(payload))
  }catch{fail('invalid_handover_review',400)}
  if(!binding||binding.target!==id||binding.actor!==actor.member.operatorId||binding.actorRevision!==actor.member.revision||binding.session!==actor.session.id||binding.expires<Date.now())fail('handover_review_expired',409)
  if(binding.version!==target.row.version||binding.memberRevision!==target.member.revision||binding.epoch!==await epoch(env)||binding.digest!==await digest(canonical(items)))fail('handover_inventory_changed',409)
 }
 let choices:unknown
 try{choices=typeof data.choices==='string'?JSON.parse(data.choices):data.choices??[]}catch{fail('handover_choices_required',400)}
 if(!Array.isArray(choices)||choices.length!==items.length||choices.some(c=>!c||typeof c!=='object'||typeof c.key!=='string'||!items.some(i=>i.key===c.key)||c.successor!==null&&typeof c.successor!=='string')||new Set(choices.map(c=>c.key)).size!==items.length)fail('handover_choices_required',400)
 const proof=proofFence(actor),now=Date.now(),statements:D1PreparedStatement[]=[]
 const guard=(sql:string,args:unknown[]=[])=>env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) SELECT 1,CASE WHEN (${sql}) THEN 1 ELSE 0 END ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...args)
 statements.push(guard(`${actor.fence} AND ${proof.sql} AND (SELECT revision FROM porthole_handover_epoch WHERE singleton=1)=? AND EXISTS(SELECT 1 FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.id=? AND o.version=? AND m.revision=? AND o.status=?)`,[...actor.args,...proof.args,binding?.epoch??observedEpoch,id,target.row.version,target.member.revision,target.row.status]))
 for(const item of items) {
  const choice=choices.find(c=>c.key===item.key) as Choice,successor=choice.successor
  if(successor!==null) {
   if(successor===id)fail('handover_successor_forbidden')
   const member=await memberFor(env.DB,successor),row=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=?)").bind(successor,successor).first<{version:number}>()
   if(!member||!row||!eligible(item,member.role,member.scope))fail('handover_successor_forbidden')
   statements.push(guard(`EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE o.id=? AND o.status='active' AND o.version=? AND m.revision=? AND o.role=? AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=o.id))`,[successor,row.version,member.revision,baseRole(member.role)]))
  }else if(item.mode==='custody')fail('ingest_custodian_required',409)
  if(item.kind==='service')statements.push(env.DB.prepare(`INSERT INTO porthole_service_versions SELECT id,service,environment,team,revision+1,?,repository,runbook,criticality,?,?,state FROM porthole_service_versions WHERE id=? AND revision=?`).bind(successor,actor.member.operatorId,now,item.id,item.revision))
  if(item.kind==='notebook')statements.push(env.DB.prepare(`UPDATE porthole_notebooks SET owner_ref=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(successor,now,item.id,item.revision))
  if(item.kind==='event-filter')statements.push(env.DB.prepare(`UPDATE porthole_event_filters SET owner_ref=?,revision=revision+1 WHERE id=? AND revision=?`).bind(successor,item.id,item.revision))
  if(item.kind==='follow-up')statements.push(env.DB.prepare("INSERT INTO porthole_follow_up_events SELECT ?,id,generation,'handover',?,'Reviewed removal batch; assignment changed without changing recovery evidence.',? FROM porthole_follow_up WHERE id=?").bind(crypto.randomUUID(),actor.member.operatorId,now,item.id),env.DB.prepare(`UPDATE porthole_follow_up SET owner_id=?,state=CASE WHEN ? IS NULL AND state!='resolved' THEN 'blocked' ELSE state END,revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(successor,successor,now,item.id,item.revision))
  if(item.kind==='credential'&&item.mode==='custody')statements.push(env.DB.prepare(`UPDATE porthole_credentials SET custodian_id=?,revision=revision+1 WHERE id=? AND revision=?`).bind(successor,item.id,item.revision))
  if(item.kind==='approval')statements.push(env.DB.prepare(`UPDATE porthole_objects SET state='inactive',updated_at=? WHERE state='approved' AND EXISTS(SELECT 1 FROM porthole_object_approvals a WHERE a.id=? AND a.object_id=porthole_objects.id AND a.revision=porthole_objects.revision)`).bind(now,item.id),env.DB.prepare('DELETE FROM porthole_object_approvals WHERE id=? AND actor_ref=?').bind(item.id,id))
  if(successor===null&&['move','hold'].includes(item.mode)&&item.kind!=='follow-up')statements.push(env.DB.prepare(`INSERT INTO porthole_follow_up(id,source,kind,scope,owner_id,state,reason,next_action,due_at,created_at,updated_at) VALUES(?,?,'handover',?,NULL,'blocked','Member removed; ownership requires review.',?,?,?,?)`).bind(crypto.randomUUID(),'handover:'+crypto.randomUUID()+':'+item.key,JSON.stringify(item.scope),'Review '+item.kind+' '+item.id+' at revision '+item.revision+'; existing collection and evaluation remain unchanged.',now+86400000,now,now))
 }
 statements.push(env.DB.prepare("UPDATE porthole_signal_exports SET state='cancelled' WHERE owner_ref=? AND state!='cancelled'").bind(id))
 statements.push(env.DB.prepare('DELETE FROM porthole_notebook_shares WHERE owner_ref=?').bind(id))
 for(const [table,owner]of [['porthole_notebook_publications','owner_ref'],['porthole_dashboard_publications','owner_id']])statements.push(env.DB.prepare(`UPDATE ${table} SET state='revoked',revoked_at=?,updated_at=?,revision=revision+1 WHERE ${owner}=? AND state IN ('draft','published')`).bind(now,now,id))
 const receipt=crypto.randomUUID()
 statements.push(env.DB.prepare(`INSERT INTO porthole_handover_history VALUES(?,?,?,?,?,?,'committed')`).bind(receipt,id,actor.member.operatorId,binding?.digest??await digest(canonical(items)),JSON.stringify(items.map(item=>({key:item.key,...(item.entityRef?{entityRef:item.entityRef}:{}),revision:item.revision,mode:item.mode,successor:choices.find(c=>c.key===item.key).successor}))),now))
 statements.push(env.DB.prepare(`UPDATE oa_operators SET status='inactive' WHERE id=? AND version=? AND ${actor.fence} AND ${proof.sql} RETURNING id`).bind(id,target.row.version,...actor.args,...proof.args),env.DB.prepare('INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,changes()) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness'))
 try {await env.DB.batch(statements)}catch(error){if(String(error).includes('last_owner'))fail('last_owner',409);if(String(error).includes('CHECK constraint failed'))fail('handover_inventory_or_authority_changed',409);throw error}
 return {id,status:'inactive',receipt}
}
