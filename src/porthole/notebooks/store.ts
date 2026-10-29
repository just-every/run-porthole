import type {Bindings} from '../../auth.server'
import {fail,scopeWithin,type Authority,type Scope} from '../security/authority'
import {notebookBody,type Notebook,type NotebookRow} from './model'

// Grants are live authority, excluded from product archives. A changed granting
// owner's membership or identity generation invalidates them on the next read.
export async function canRead(env:Bindings,actor:Authority,row:NotebookRow):Promise<boolean> {
 if(actor.member.role==='finance reader'||!scopeWithin(JSON.parse(row.scope),actor.member.scope))return false
 if(actor.member.role==='owner')return true
 if(row.state==='quarantined')return false
 return !!await env.DB.prepare(`SELECT 1 FROM porthole_notebook_shares g JOIN porthole_members m ON m.operator_id=g.owner_ref JOIN oa_operators o ON o.id=m.operator_id
 WHERE g.notebook_id=? AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=g.owner_revision AND o.version=g.operator_version
 AND (g.kind='member' AND g.target=? OR g.kind='team' AND EXISTS(SELECT 1 FROM json_each(?) t WHERE t.value=g.target)) AND ${actor.fence} LIMIT 1`)
 .bind(row.id,actor.member.operatorId,JSON.stringify(actor.member.scope.teams),...actor.args).first()
}
export async function current(env:Bindings,actor:Authority,id:string):Promise<NotebookRow> {
 const row=await env.DB.prepare(`SELECT * FROM porthole_notebooks WHERE id=? AND ${actor.fence}`).bind(id,...actor.args).first<NotebookRow>()
 if(!row||!await canRead(env,actor,row))fail('notebook_not_found',404)
 return row
}
export async function versions(env:Bindings,actor:Authority,row:NotebookRow):Promise<NotebookRow[]> {
 return (await env.DB.prepare(`SELECT * FROM porthole_notebook_versions WHERE id=? AND ${actor.fence} ORDER BY revision DESC`).bind(row.id,...actor.args).all<NotebookRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
}
export async function save(env:Bindings,actor:Authority,row:NotebookRow,body:Notebook,scope:Scope,name=row.name,create=false) {
 if(actor.member.role!=='owner'||!scopeWithin(scope,actor.member.scope))fail('notebook_owner_required')
 if(!create&&row.state==='quarantined')fail('notebook_restore_inactive',409)
 const now=Date.now(),revision=create?1:row.revision+1,serialized=JSON.stringify(notebookBody(body))
 const statement=create?env.DB.prepare(`INSERT INTO porthole_notebooks SELECT ?,?,?,?,?,?,1,'active',?,? WHERE ${actor.fence}`)
 .bind(row.id,name,actor.member.operatorId,actor.member.operatorId,JSON.stringify(scope),serialized,now,now,...actor.args)
 :env.DB.prepare(`UPDATE porthole_notebooks SET name=?,author_ref=?,scope=?,body=?,revision=?,updated_at=? WHERE id=? AND revision=? AND state='active' AND ${actor.fence}`)
 .bind(name,actor.member.operatorId,JSON.stringify(scope),serialized,revision,now,row.id,row.revision,...actor.args)
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${create?'NOT EXISTS(SELECT 1 FROM porthole_notebooks WHERE id=?)':"EXISTS(SELECT 1 FROM porthole_notebooks WHERE id=? AND revision=? AND state='active')"} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,row.id,...(create?[]:[row.revision])),
  statement,
  env.DB.prepare(`INSERT INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at)
   SELECT ?,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,?,?,?,'notebooks.revise',?,?,?,? WHERE EXISTS(SELECT 1 FROM porthole_notebooks WHERE id=? AND revision=?) AND ${actor.fence}`)
   .bind(crypto.randomUUID().replaceAll('-',''),crypto.randomUUID(),actor.member.operatorId,actor.member.revision,row.id,revision,now,now,row.id,revision,...actor.args),
 ])
 if(!result[1].meta.changes)fail('revision_or_authority_changed',409)
 return {id:row.id,revision}
}
