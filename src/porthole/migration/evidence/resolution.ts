import type {Bindings} from '../../../auth.server'
import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {canonicalJson} from '../../../modules/import-kit/src/provenance/identity.ts'
import {operationDocument as document,escape,privateHeaders} from '../../document'
import {fail} from '../../security/authority'

type Value=Record<string,unknown>
type Row={kind:string;id:string;body:string;revision:string}
type Item={id:string;field:string;text:string}
const object=(value:unknown):value is Value=>!!value&&typeof value==='object'&&!Array.isArray(value)
const decisions={'keep-source':'Retain source dependency','specialist-handoff':'Require specialist handoff'} as const
export function reviewItems(value:Value):Item[]{
 const review=object(value.review)?value.review:{},items:Item[]=[]
 if(Array.isArray(review.issues))review.issues.forEach((issue,index)=>{if(object(issue))items.push({id:`issue-${index}`,field:String(issue.field),text:String(issue.reason)})})
 if(Array.isArray(review.expressions))review.expressions.forEach((query,index)=>{
  if(!object(query))return
  items.push({id:`expression-${index}`,field:String(query.field),text:`${query.dialect}: ${query.text}`})
  if(Array.isArray(query.constructs))query.constructs.forEach((node,n)=>{if(object(node))items.push({id:`expression-${index}-construct-${n}`,field:`${query.field}@${node.offset}`,text:`${node.kind}: ${node.text}`})})
 })
 return items
}
async function read(env:Bindings,predicate:D1Sql,kind:string,id:string){
 const result=await env.DB.batch<Row>([
  env.DB.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('OWNER_REQUIRED') END`).bind(...predicate.params??[]),
  env.DB.prepare('SELECT * FROM porthole_migration_records WHERE kind=? AND id=?').bind(kind,id),
  env.DB.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('OWNER_REQUIRED') END`).bind(...predicate.params??[]),
 ])
 const row=result[1].results[0];if(!row)fail('source_record_missing',404)
 return row
}
const hidden=(name:string,value:string)=>`<input type="hidden" name="${name}" value="${escape(value)}">`
function screen(row:Row,saved=false){
 const value=JSON.parse(row.body) as Value,items=reviewItems(value),resolutions=object(value.humanResolutions)?value.humanResolutions:{}
 const completed=items.filter(item=>object(resolutions[item.id])).length
 return document('Source review',`<p><a href="/app/import">Return to Move in</a></p>${saved?'<p role="status">Decision saved. Source dependency remains; no cutover is authorized.</p>':''}<h2>${escape(row.id)}</h2><p>${completed} of ${items.length} items reviewed. Imports remain inactive. Each decision records how to retain the dependency; it does not qualify query meaning, transfer credentials, send a handoff or activate collection. Keep the source available.</p>${value.specialist?`<p>Specialist required: ${escape(String(value.specialist))}. The original security dashboard stays with the specialist.</p>`:''}${items.length?`<form method="post" action="/app/import/resolutions">${hidden('kind',row.kind)}${hidden('id',row.id)}${hidden('revision',row.revision)}<label for="source-item">Source item</label><select id="source-item" name="item" required>${items.map(item=>`<option value="${item.id}">${escape(item.id+' · '+item.field)}</option>`).join('')}</select><label for="source-decision">Decision</label><select id="source-decision" name="decision" required><option value="">Choose a decision</option>${Object.entries(decisions).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><label><input type="checkbox" name="confirm" value="reviewed" required> I reviewed the exact source item and will keep its dependency available</label><button>Save source decision</button></form><h2>Source items</h2><ol>${items.map(item=>{const resolution=resolutions[item.id];return `<li><strong>${escape(item.id+' · '+item.field)}</strong><pre>${escape(item.text)}</pre><p>${object(resolution)?escape(decisions[resolution.decision as keyof typeof decisions]??'Review required'):'Review required'}</p></li>`}).join('')}</ol>`:'<p>No inventoried source items. Schema qualification remains required.</p>'}`,200,{forms:true})
}
export async function resolutionPage(request:Request,env:Bindings,predicate:D1Sql){
 const url=new URL(request.url),row=await read(env,predicate,url.searchParams.get('kind')??'',url.searchParams.get('id')??'')
 return screen(row)
}
export async function saveResolution(input:Value,env:Bindings,predicate:D1Sql,html=false){
 if(Object.keys(input).some(key=>!['kind','id','revision','item','decision','confirm'].includes(key))||!['kind','id','revision','item','decision'].every(key=>typeof input[key]==='string')||input.confirm!=='reviewed'||!Object.hasOwn(decisions,String(input.decision)))fail('invalid_source_decision',400)
 const row=await read(env,predicate,String(input.kind),String(input.id))
 if(row.revision!==input.revision)fail('source_review_stale',409)
 const value=JSON.parse(row.body) as Value,items=reviewItems(value)
 if(!items.some(item=>item.id===input.item))fail('source_item_missing',400)
 value.humanResolutions={...(object(value.humanResolutions)?value.humanResolutions:{}),[String(input.item)]:{decision:input.decision,recordedAt:Date.now()}}
 const body=canonicalJson(value),revision=crypto.randomUUID()
 const result=await env.DB.prepare(`UPDATE porthole_migration_records SET body=?,revision=? WHERE kind=? AND id=? AND body=? AND revision=? AND (${predicate.sql}) RETURNING revision`)
 .bind(body,revision,row.kind,row.id,row.body,row.revision,...predicate.params??[]).first<{revision:string}>()
 if(!result||result.revision!==revision)fail('source_review_stale',409)
 const current={...row,body,revision}
 return html?screen(current,true):Response.json({qualification:'source-evidence-only',cutover:'blocked',record:{targetKind:row.kind,targetId:row.id,revision,value}}, {headers:privateHeaders})
}
