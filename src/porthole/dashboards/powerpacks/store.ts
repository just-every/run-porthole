import type {Bindings} from '../../../auth.server'
import {fail,parseScope,scopeWithin,type Authority,type Scope} from '../../security/authority'
import {guard} from '../../portability/store'
import {canonical} from '../../ingest/model'
import {digest} from '../../audit/store'
import {dashboardBody,label,type DashboardRow} from '../model'
import {packBindings,panelIds,validateDashboardScope} from '../layout'
import {installPack} from './bind'
import {powerpackBody,type PowerpackRow} from './model'
export interface Packet {pack:PowerpackRow;previous:number;consumers:{id:string;name:string;revision:number;body:string}[]}
export interface Review {id:string;owner_id:string;owner_revision:number;operator_version:number;packet:string;digest:string;expires_at:number;state:string}
export async function currentPack(env:Bindings,actor:Authority,id:string):Promise<PowerpackRow> {
 const row=await env.DB.prepare(`SELECT * FROM porthole_powerpacks WHERE id=? AND ${actor.fence}`).bind(id,...actor.args).first<PowerpackRow>()
 if(!row||!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('powerpack_not_found',404)
 return row
}
const consumerPredicate="EXISTS(SELECT 1 FROM json_tree(d.body,'$.layout') j WHERE j.type='object' AND json_extract(j.value,'$.powerpack.id')=?)"
async function consumers(env:Bindings,actor:Authority,id:string,pack:PowerpackRow) {
 const rows=(await env.DB.prepare(`SELECT d.* FROM porthole_dashboards d WHERE ${consumerPredicate} AND ${actor.fence} ORDER BY d.id`).bind(id,...actor.args).all<DashboardRow>()).results
 if(rows.length>50)fail('powerpack_consumer_limit',409)
 return rows.map(row=>{
  if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('powerpack_consumer_scope_forbidden')
  let body=dashboardBody(JSON.parse(row.body))
  for(const group of packBindings(body.layout).filter(group=>group.powerpack!.id===id)) {
   body=installPack(body,group.id,pack)
   const updated=packBindings(body.layout).find(g=>g.id===group.id)!,ids=panelIds(updated.children)
   validateDashboardScope(body,JSON.parse(pack.scope),ids)
  }
  validateDashboardScope(body,JSON.parse(row.scope))
  return {id:row.id,name:row.name,revision:row.revision,body:JSON.stringify(body)}
 })
}
export async function previewPack(env:Bindings,actor:Authority,data:Record<string,unknown>):Promise<Review> {
 if(Object.keys(data).some(key=>!['id','revision','name','scope','body'].includes(key)))fail('invalid_powerpack',400)
 const previous=data.id?await currentPack(env,actor,String(data.id)):null
 if(previous&&Number(data.revision)!==previous.revision||!previous&&data.revision!==undefined&&Number(data.revision)!==0)fail('powerpack_revision_changed',409)
 const scope=parseScope(typeof data.scope==='string'?JSON.parse(data.scope):data.scope),body=powerpackBody(typeof data.body==='string'?JSON.parse(data.body):data.body)
 if(!scope.services.length||!scope.environments.length||!scope.teams.length||!scopeWithin(scope,actor.member.scope))fail('scope_forbidden')
 validateDashboardScope(body,scope)
 const now=Date.now(),pack:PowerpackRow={id:previous?.id??crypto.randomUUID(),name:label(data.name),scope:JSON.stringify(scope),body:JSON.stringify(body),revision:(previous?.revision??0)+1,state:'active',created_at:previous?.created_at??now,updated_at:now}
 const packet:Packet={pack,previous:previous?.revision??0,consumers:await consumers(env,actor,pack.id,pack)}
 const row:Review={id:crypto.randomUUID(),owner_id:actor.member.operatorId,owner_revision:actor.member.revision,operator_version:actor.session.operator.version,packet:canonical(packet),digest:await digest(canonical(packet)),expires_at:now+300000,state:'preview'}
 await env.DB.batch([guard(env.DB,actor,'EXISTS(SELECT 1 FROM porthole_audit_context WHERE singleton=1)'),env.DB.prepare('INSERT INTO porthole_powerpack_reviews VALUES(?,?,?,?,?,?,?,?)').bind(row.id,row.owner_id,row.owner_revision,row.operator_version,row.packet,row.digest,row.expires_at,row.state)])
 return row
}
export async function reviewFor(env:Bindings,actor:Authority,id:string):Promise<Review> {
 const row=await env.DB.prepare(`SELECT * FROM porthole_powerpack_reviews WHERE id=? AND owner_id=? AND owner_revision=? AND operator_version=? AND ${actor.fence}`).bind(id,actor.member.operatorId,actor.member.revision,actor.session.operator.version,...actor.args).first<Review>()
 if(!row)fail('powerpack_review_not_found',404)
 return row
}
export async function approvePack(env:Bindings,actor:Authority,data:Record<string,unknown>):Promise<PowerpackRow> {
 if(Object.keys(data).sort().join(',')!=='confirm,digest,id'||data.confirm!=='apply-private-powerpack')fail('exact_powerpack_review_required',400)
 const review=await reviewFor(env,actor,String(data.id)),packet=JSON.parse(review.packet) as Packet,pack=packet.pack
 if(review.state!=='preview'||review.expires_at<=Date.now()||data.digest!==review.digest)fail('powerpack_review_stale',409)
 if(packet.previous){const current=await currentPack(env,actor,pack.id);if(current.revision!==packet.previous)fail('powerpack_revision_changed',409)}
 if(canonical(await consumers(env,actor,pack.id,pack))!==canonical(packet.consumers))fail('powerpack_consumer_revision_changed',409)
 const scope=JSON.parse(pack.scope) as Scope
 if(!scopeWithin(scope,actor.member.scope))fail('scope_forbidden')
 const conditions=['EXISTS(SELECT 1 FROM porthole_audit_context WHERE singleton=1)',`EXISTS(SELECT 1 FROM porthole_powerpack_reviews WHERE id=? AND state='preview' AND expires_at>? AND digest=?)`,packet.previous?'EXISTS(SELECT 1 FROM porthole_powerpacks WHERE id=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM porthole_powerpacks WHERE id=?)',`(SELECT COUNT(*) FROM porthole_dashboards d WHERE ${consumerPredicate})=?`,...packet.consumers.map(()=>`EXISTS(SELECT 1 FROM porthole_dashboards WHERE id=? AND revision=?)`)]
 const args:unknown[]=[review.id,Date.now(),review.digest,pack.id,...(packet.previous?[packet.previous]:[]),pack.id,packet.consumers.length,...packet.consumers.flatMap(row=>[row.id,row.revision])]
 // D1 executes this batch as one transaction. The guard repeats the complete
 // reviewed consumer set and every revision before any definition changes.
 const writes=[guard(env.DB,actor,conditions.join(' AND '),args)]
 writes.push(packet.previous?env.DB.prepare('UPDATE porthole_powerpacks SET name=?,scope=?,body=?,revision=?,state=?,updated_at=? WHERE id=? AND revision=?').bind(pack.name,pack.scope,pack.body,pack.revision,pack.state,pack.updated_at,pack.id,packet.previous):env.DB.prepare('INSERT INTO porthole_powerpacks VALUES(?,?,?,?,?,?,?,?)').bind(pack.id,pack.name,pack.scope,pack.body,pack.revision,pack.state,pack.created_at,pack.updated_at))
 for(const row of packet.consumers)writes.push(env.DB.prepare('UPDATE porthole_dashboards SET body=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(row.body,pack.updated_at,row.id,row.revision))
 writes.push(env.DB.prepare("UPDATE porthole_powerpack_reviews SET state='applied' WHERE id=?").bind(review.id),guard(env.DB,actor))
 try{await env.DB.batch(writes)}catch(error){if(String(error).includes('CHECK constraint failed'))fail('revision_or_authority_changed',409);throw error}
 return pack
}
