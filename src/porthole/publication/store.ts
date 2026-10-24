import type {Bindings} from '../../auth.server'
import {digest} from '../audit/store'
import {dashboardBody,type DashboardRow} from '../dashboards/model'
import {dashboardResults} from '../dashboards/read'
import {fail,proofFence,scopeWithin,type Authority} from '../security/authority'
import {allowedOrigins,publicText,validProjection,type Projection,type PublicationRow} from './model'

export async function sourceDashboard(env:Bindings,actor:Authority,id:string):Promise<DashboardRow> {
 const row=await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE id=? AND state='active' AND ${actor.fence}`).bind(id,...actor.args).first<DashboardRow>()
 if(!row)fail('dashboard_not_found',404)
 if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
 return row
}
export const liveSource=`EXISTS(SELECT 1 FROM porthole_dashboards d JOIN oa_operators o ON o.id=porthole_dashboard_publications.owner_id JOIN porthole_members m ON m.operator_id=o.id WHERE d.id=porthole_dashboard_publications.dashboard_id AND d.revision=porthole_dashboard_publications.source_revision AND d.state='active' AND o.status='active' AND o.role='owner' AND m.role='owner' AND o.version=porthole_dashboard_publications.operator_version AND m.revision=porthole_dashboard_publications.owner_revision)`
export function reviewedPayload(row:Pick<PublicationRow,'id'|'dashboard_id'|'source_revision'|'owner_id'|'owner_revision'|'operator_version'|'projection'|'source_review'|'allowed_origins'|'expires_at'>) {
 return JSON.stringify({id:row.id,dashboard:row.dashboard_id,revision:row.source_revision,owner:row.owner_id,memberRevision:row.owner_revision,operatorVersion:row.operator_version,projection:JSON.parse(row.projection),source:JSON.parse(row.source_review),origins:JSON.parse(row.allowed_origins),expiresAt:row.expires_at,audience:'public-snapshot'})
}
export async function draft(request:Request,env:Bindings,actor:Authority,data:Record<string,unknown>):Promise<PublicationRow> {
 const source=await sourceDashboard(env,actor,String(data.dashboardId)),body=dashboardBody(JSON.parse(source.body))
 if(Number(data.sourceRevision)!==source.revision)fail('revision_or_authority_changed',409)
 if(!publicText(data.publicTitle))fail('invalid_public_title',400)
 const labels=typeof data.labels==='string'?JSON.parse(data.labels):data.labels
 if(!labels||typeof labels!=='object'||Array.isArray(labels))fail('explicit_public_labels_required',400)
 const entries=Object.entries(labels)
 if(!entries.length||entries.length>30||entries.some(([id,label])=>!body.panels.some(p=>p.id===id)||!publicText(label)))fail('invalid_public_labels',400)
 if(entries.some(([id])=>body.panels.find(p=>p.id===id)?.widget==='notes'))fail('public_snapshot_requires_numeric_panel',400)
 const origins=allowedOrigins(data.allowedOrigins),now=Date.now(),expires=typeof data.expiresAt==='number'?data.expiresAt:Date.parse(String(data.expiresAt))
 if(!Number.isSafeInteger(expires)||expires<=now||expires>now+366*86400000)fail('invalid_public_expiry',400)
 const url=new URL(request.url)
 for(const key of ['team','environment','from','through'])if(data[key]!==undefined)url.searchParams.set(key==='environment'?'environment':key,String(data[key]))
 const results=await dashboardResults(new Request(url,{headers:request.headers}),env,source)
 const selected=results.filter(r=>Object.hasOwn(labels,r.panel.id)),firstQuery=new URL(selected[0].query,request.url)
 const projection:Projection={version:1,title:data.publicTitle,range:{from:firstQuery.searchParams.get('from')!,through:firstQuery.searchParams.get('through')!},panels:selected.map(r=>({id:crypto.randomUUID(),label:(labels as Record<string,string>)[r.panel.id],value:r.value,state:r.state,unit:r.unit??r.panel.unit}))}
 if(!validProjection(projection))fail('invalid_public_projection',400)
 const review={filters:{team:firstQuery.searchParams.get('team'),environment:firstQuery.searchParams.get('environment'),from:projection.range.from,through:projection.range.through,scope:JSON.parse(source.scope)},panels:selected.map((r,i)=>({sourcePanel:r.panel.id,publicPanel:projection.panels[i].id,query:r.query,queryRef:(r as unknown as {reference?:string}).reference??null}))}
 const row:PublicationRow={id:crypto.randomUUID(),dashboard_id:source.id,source_revision:source.revision,owner_id:actor.member.operatorId,owner_revision:actor.member.revision,operator_version:actor.session.operator.version,projection:JSON.stringify(projection),source_review:JSON.stringify(review),allowed_origins:JSON.stringify(origins),expires_at:expires,digest:'',state:'draft',revision:1,created_at:now,updated_at:now,approved_at:null,revoked_at:null}
 row.digest=await digest(reviewedPayload(row))
 const proof=proofFence(actor)
 const result=await env.DB.prepare(`INSERT INTO porthole_dashboard_publications SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_members WHERE operator_id=? AND role='owner') AND EXISTS(SELECT 1 FROM porthole_dashboards WHERE id=? AND revision=? AND state='active') AND EXISTS(SELECT 1 FROM porthole_audit_context WHERE singleton=1)`)
  .bind(row.id,row.dashboard_id,row.source_revision,row.owner_id,row.owner_revision,row.operator_version,row.projection,row.source_review,row.allowed_origins,row.expires_at,row.digest,row.state,row.revision,row.created_at,row.updated_at,row.approved_at,row.revoked_at,...actor.args,...proof.args,row.owner_id,row.dashboard_id,row.source_revision).run()
 if(result.meta.changes!==1)fail('revision_or_authority_changed',409)
 return row
}
export async function ownerPublication(env:Bindings,actor:Authority,id:string):Promise<PublicationRow> {
 const row=await env.DB.prepare(`SELECT * FROM porthole_dashboard_publications WHERE id=? AND ${actor.fence}`).bind(id,...actor.args).first<PublicationRow>()
 if(!row)fail('publication_not_found',404)
 const source=await env.DB.prepare('SELECT scope FROM porthole_dashboards WHERE id=?').bind(row.dashboard_id).first<{scope:string}>()
 if(!source||!scopeWithin(JSON.parse(source.scope),actor.member.scope))fail('scope_forbidden')
 return row
}
export async function approve(env:Bindings,actor:Authority,data:Record<string,unknown>):Promise<PublicationRow> {
 const row=await ownerPublication(env,actor,String(data.id)),proof=proofFence(actor),now=Date.now()
 if(row.state!=='draft'||row.owner_id!==actor.member.operatorId||row.owner_revision!==actor.member.revision||row.operator_version!==actor.session.operator.version||data.digest!==row.digest||await digest(reviewedPayload(row))!==row.digest||Number(data.sourceRevision)!==row.source_revision||Number(data.expiresAt)!==row.expires_at||JSON.stringify(allowedOrigins(data.allowedOrigins))!==row.allowed_origins||data.audience!=='public-snapshot'||data.confirm!=='reviewed-public-snapshot'||row.expires_at<=now)fail('publication_review_changed',409)
 await sourceDashboard(env,actor,row.dashboard_id)
 const result=await env.DB.prepare(`UPDATE porthole_dashboard_publications SET state='published',revision=revision+1,approved_at=?,updated_at=? WHERE id=? AND state='draft' AND digest=? AND expires_at>? AND ${liveSource} AND ${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_audit_context WHERE singleton=1)`)
  .bind(now,now,row.id,row.digest,now,...actor.args,...proof.args).run()
 if(result.meta.changes!==1)fail('revision_or_authority_changed',409)
 return {...row,state:'published',revision:row.revision+1,approved_at:now,updated_at:now}
}
export async function revoke(env:Bindings,actor:Authority,id:string):Promise<PublicationRow> {
 const row=await ownerPublication(env,actor,id),now=Date.now()
 if(row.state==='revoked')return row
 const result=await env.DB.prepare(`UPDATE porthole_dashboard_publications SET state='revoked',revision=revision+1,revoked_at=?,updated_at=? WHERE id=? AND revision=? AND ${actor.fence} AND EXISTS(SELECT 1 FROM porthole_members WHERE operator_id=? AND role='owner') AND EXISTS(SELECT 1 FROM porthole_audit_context WHERE singleton=1)`).bind(now,now,id,row.revision,...actor.args,actor.member.operatorId).run()
 if(result.meta.changes!==1)fail('revision_or_authority_changed',409)
 return {...row,state:'revoked',revision:row.revision+1,revoked_at:now,updated_at:now}
}
