import type {Bindings} from '../../auth.server'
import {digest} from '../audit/store'
import {fail,proofFence,type Authority} from '../security/authority'
import {publicText} from '../publication/model'
import {current} from './store'
import {notebookBody,object} from './model'
import {resolveCell} from './query'
import {publicNotebook,publicUnit,type NotebookPublication,type PublicNotebook} from './publication-model'

const table='porthole_notebook_publications'
// A publication is a separate, explicitly approved audience. Its existence is
// never authority to read the private notebook or telemetry. Source changes,
// owner revocation, erasure and inactive restores close every public read.
export const liveNotebookPublication=`EXISTS(SELECT 1 FROM porthole_notebooks n JOIN porthole_members m ON m.operator_id=${table}.owner_ref JOIN oa_operators o ON o.id=m.operator_id
 WHERE n.id=${table}.notebook_id AND n.revision=${table}.source_revision AND n.state='active'
 AND m.role='owner' AND o.role='owner' AND o.status='active' AND m.revision=${table}.owner_revision AND o.version=${table}.operator_version
 AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors e WHERE e.actor_ref=o.id))
 AND NOT EXISTS(SELECT 1 FROM json_each(${table}.source_review,'$.recordIds') ref WHERE NOT EXISTS(
 SELECT 1 FROM porthole_telemetry_records r JOIN porthole_ingest_batches b ON b.id=r.batch_id WHERE r.id=ref.value AND b.state='complete'
 AND NOT EXISTS(SELECT 1 FROM porthole_erased_batches e WHERE e.id=b.id OR e.content_digest=b.digest)))`
export const reviewPayload=(row:NotebookPublication)=>JSON.stringify({id:row.id,notebook:row.notebook_id,sourceRevision:row.source_revision,owner:row.owner_ref,ownerRevision:row.owner_revision,operatorVersion:row.operator_version,projection:JSON.parse(row.projection),source:JSON.parse(row.source_review),expiresAt:row.expires_at,audience:'anyone-with-address'})
export async function publicationFor(env:Bindings,actor:Authority,notebookId:string,id:string):Promise<NotebookPublication> {
 await current(env,actor,notebookId)
 const row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND notebook_id=? AND ${actor.fence}`).bind(id,notebookId,...actor.args).first<NotebookPublication>()
 if(!row)fail('notebook_publication_not_found',404)
 return row
}
export async function previewNotebook(request:Request,env:Bindings,actor:Authority,notebookId:string,data:Record<string,unknown>):Promise<NotebookPublication> {
 const source=await current(env,actor,notebookId),body=notebookBody(JSON.parse(source.body))
 if(source.state!=='active'||Number(data.revision)!==source.revision)fail('revision_or_authority_changed',409)
 if(!publicText(data.title)||!publicText(data.summary,2000))fail('explicit_public_text_required',400)
 const keys=body.cells.filter(c=>c.kind!=='text').flatMap(c=>['include.','label.','unit.'].map(prefix=>prefix+c.id))
 if(Object.keys(data).some(key=>!['revision','title','summary','cells','expiresAt',...keys].includes(key)))fail('invalid_public_fields',400)
 const raw=data.cells===undefined?body.cells.filter(c=>data['include.'+c.id]==='yes').map(c=>({cellId:c.id,label:data['label.'+c.id],unit:data['unit.'+c.id]})):typeof data.cells==='string'?JSON.parse(data.cells):data.cells
 if(!Array.isArray(raw)||!raw.length||raw.length>30)fail('public_cells_required',400)
 const selected=raw.map(value=>object(value))
 if(selected.some(c=>Object.keys(c).sort().join(',')!=='cellId,label,unit'||!publicText(c.label)||!publicUnit(c.unit)||!body.cells.some(cell=>cell.id===c.cellId&&cell.kind!=='text'))||new Set(selected.map(c=>c.cellId)).size!==selected.length)fail('invalid_public_cells',400)
 const now=Date.now(),expires=typeof data.expiresAt==='number'?data.expiresAt:Date.parse(String(data.expiresAt))
 if(!Number.isSafeInteger(expires)||expires<=now||expires>now+366*86400000)fail('invalid_public_expiry',400)
 const projection:PublicNotebook={version:1,title:data.title,summary:data.summary,cells:[]},recordIds=new Set<string>(),cellIds:string[]=[]
 for(const cell of body.cells) {
  const chosen=selected.find(c=>c.cellId===cell.id)
  if(!chosen||cell.kind==='text')continue
  const result=await resolveCell(request,env,cell)
  if(result.state!=='complete'||chosen.unit!==result.unit||result.aggregate?.value===null)fail('public_cell_evidence_unavailable',409)
  // No source text, query, record payload, author, mention, series label or
  // private object reference enters this allowlisted projection.
  projection.cells.push({id:crypto.randomUUID(),kind:cell.kind,label:String(chosen.label),unit:String(chosen.unit),from:cell.query.from.padStart(20,'0'),through:cell.query.through.padStart(20,'0'),count:result.count!,value:result.aggregate?.value??null,points:cell.kind==='chart'?result.points.map(p=>({timeNs:p.timeNs.padStart(20,'0'),value:p.value})):[]})
  cellIds.push(cell.id);for(const id of cell.snapshot.recordIds)recordIds.add(id)
 }
 publicNotebook(projection)
 const row:NotebookPublication={id:crypto.randomUUID(),notebook_id:source.id,source_revision:source.revision,owner_ref:actor.member.operatorId,owner_revision:actor.member.revision,operator_version:actor.session.operator.version,projection:JSON.stringify(projection),source_review:JSON.stringify({cells:cellIds,recordIds:[...recordIds]}),expires_at:expires,digest:'',state:'draft',revision:1,created_at:now,updated_at:now,approved_at:null,revoked_at:null}
 row.digest=await digest(reviewPayload(row))
 const proof=proofFence(actor)
 const result=await env.DB.prepare(`INSERT INTO ${table} SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_notebooks WHERE id=? AND revision=? AND state='active')`)
 .bind(row.id,row.notebook_id,row.source_revision,row.owner_ref,row.owner_revision,row.operator_version,row.projection,row.source_review,row.expires_at,row.digest,row.state,row.revision,row.created_at,row.updated_at,row.approved_at,row.revoked_at,...actor.args,...proof.args,source.id,source.revision).run()
 if(!result.meta.changes)fail('revision_or_authority_changed',409)
 return row
}
export async function approveNotebook(env:Bindings,actor:Authority,row:NotebookPublication,data:Record<string,unknown>):Promise<NotebookPublication> {
 const now=Date.now(),proof=proofFence(actor)
 if(row.state!=='draft'||row.owner_ref!==actor.member.operatorId||row.owner_revision!==actor.member.revision||row.operator_version!==actor.session.operator.version||data.digest!==row.digest||await digest(reviewPayload(row))!==row.digest||Number(data.revision)!==row.source_revision||Number(data.expiresAt)!==row.expires_at||data.audience!=='anyone-with-address'||data.confirm!=='reviewed-sanitized-notebook'||row.expires_at<=now)fail('notebook_publication_review_changed',409)
 const result=await env.DB.prepare(`UPDATE ${table} SET state='published',revision=revision+1,approved_at=?,updated_at=? WHERE id=? AND state='draft' AND digest=? AND expires_at>? AND ${liveNotebookPublication} AND ${actor.fence} AND ${proof.sql}`)
 .bind(now,now,row.id,row.digest,now,...actor.args,...proof.args).run()
 if(!result.meta.changes)fail('revision_or_authority_changed',409)
 return {...row,state:'published',revision:row.revision+1,approved_at:now,updated_at:now}
}
export async function revokeNotebook(env:Bindings,actor:Authority,row:NotebookPublication):Promise<NotebookPublication> {
 if(['revoked','quarantined'].includes(row.state))return row
 const now=Date.now(),result=await env.DB.prepare(`UPDATE ${table} SET state='revoked',revision=revision+1,revoked_at=?,updated_at=? WHERE id=? AND revision=? AND ${actor.fence}`).bind(now,now,row.id,row.revision,...actor.args).run()
 if(!result.meta.changes)fail('revision_or_authority_changed',409)
 return {...row,state:'revoked',revision:row.revision+1,revoked_at:now,updated_at:now}
}
