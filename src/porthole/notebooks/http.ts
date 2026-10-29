import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,scopeWithin,memberFor,type Scope} from '../security/authority'
import {input} from '../security/input'
import {privateHeaders} from '../document'
import {uuid} from '../portability/format-id'
import {capture,resolveCell} from './query'
import {canRead,current,save,versions} from './store'
import {cellScope,label,notebookBody,type Cell,type NotebookRow} from './model'
import {notebookPage,notebookList,settingsPage,unavailablePage} from './page'
import {notebookPublicationResponse} from './publication-http'

const api='/api/porthole/v1/notebooks',app='/app/notebooks',settings='/app/settings/notebooks'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function notebookResponse(request:Request,env:Bindings):Promise<Response|null> {
 const publication=await notebookPublicationResponse(request,env)
 if(publication)return publication
 const url=new URL(request.url),page=url.pathname.startsWith(app)||url.pathname.startsWith(settings)
 const match=url.pathname.match(/^\/(?:api\/porthole\/v1\/notebooks|app\/notebooks|app\/settings\/notebooks)(?:\/([a-f0-9-]{36})(?:\/(cells|reorder|rerun|comment|share|unshare))?)?$/)
 if(!match&&!([api,app,settings,api+'/evaluations'].includes(url.pathname)))return null
 try {
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  if([...url.searchParams].some(([key])=>!['version','monitor'].includes(key)||url.searchParams.getAll(key).length!==1))fail('invalid_notebook_query',400)
  const actor=await authority(request,env,{post:request.method==='POST'}),owner=actor.member.role==='owner',id=match?.[1],action=match?.[2]
  if(actor.member.role==='finance reader')fail('notebooks_forbidden')
  const redirect=(id:string,toSettings=false)=>new Response(null,{status:303,headers:{...privateHeaders,location:(toSettings?settings:app)+'/'+id}})
  if(url.pathname===api+'/evaluations') {
   if(!owner)fail('notebook_owner_required')
   if(request.method!=='GET'||url.search)fail('method_not_allowed',405)
   const evaluations=(await env.DB.prepare(`SELECT e.id,e.object_id AS monitorId,e.revision,e.evaluated_at AS evaluatedAt,e.window_start_ns AS fromNs,e.window_end_ns AS throughNs,e.observed_count AS observedCount,o.name,o.scope FROM porthole_monitor_evaluations e JOIN porthole_objects o ON o.id=e.object_id AND o.revision=e.revision WHERE e.status='Firing' AND o.state='active' AND ${actor.fence} ORDER BY e.evaluated_at DESC,e.id LIMIT 100`).bind(...actor.args).all<{id:string;scope:string}>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope)).map(row=>({...row,scope:JSON.parse(row.scope)}))
   return json({evaluations})
  }
  if(request.method==='GET'&&!id) {
   if(url.pathname===settings)fail('notebook_not_found',404)
   const rows=(await env.DB.prepare(`SELECT * FROM porthole_notebooks WHERE ${actor.fence} ORDER BY updated_at DESC,id`).bind(...actor.args).all<NotebookRow>()).results
   const visible:NotebookRow[]=[];for(const row of rows)if(await canRead(env,actor,row))visible.push(row)
   if(!page)return json({notebooks:visible.map(row=>({id:row.id,name:row.name,revision:row.revision,state:row.state}))})
   const firing=owner?(await env.DB.prepare(`SELECT e.id,e.object_id,e.revision,e.evaluated_at,e.observed_count,o.name,o.scope FROM porthole_monitor_evaluations e JOIN porthole_objects o ON o.id=e.object_id AND o.revision=e.revision WHERE e.status='Firing' AND o.state='active' AND ${actor.fence} ORDER BY e.evaluated_at DESC LIMIT 100`).bind(...actor.args).all<{id:string;object_id:string;revision:number;evaluated_at:number;observed_count:number;name:string;scope:string}>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope)&&(!url.searchParams.has('monitor')||row.object_id===url.searchParams.get('monitor'))):[]
   return notebookList(visible,owner,firing)
  }
  if(request.method==='POST'&&!owner)fail('notebook_owner_required')
  if(request.method==='POST'&&url.search)fail('invalid_notebook_query',400)
  if(request.method==='POST'&&!id) {
   const data=await input(request)
   if(!uuid(data.evaluationId))fail('firing_evaluation_required',400)
   const evaluation=await env.DB.prepare(`SELECT e.*,o.scope FROM porthole_monitor_evaluations e JOIN porthole_objects o ON o.id=e.object_id AND o.revision=e.revision WHERE e.id=? AND e.status='Firing' AND o.state='active' AND ${actor.fence}`).bind(data.evaluationId,...actor.args).first<{id:string;object_id:string;revision:number;scope:string}>()
   if(!evaluation||!scopeWithin(JSON.parse(evaluation.scope),actor.member.scope))fail('firing_evaluation_unavailable',404)
   const newId=crypto.randomUUID(),row={id:newId} as NotebookRow
   const result=await save(env,actor,row,{origin:{monitorId:evaluation.object_id,revision:evaluation.revision,evaluationId:evaluation.id},cells:[],comments:[]},JSON.parse(evaluation.scope),label(data.name),true)
   return page?redirect(result.id):json(result,201)
  }
  if(!id)fail('notebook_not_found',404)
  const row=await current(env,actor,id)
  if(request.method==='GET') {
   if(action)fail('method_not_allowed',405)
   if(url.pathname.startsWith(settings)) {
    if(!owner)fail('notebook_owner_required')
    const members=(await env.DB.prepare(`SELECT o.id,o.display_name FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND ${actor.fence} ORDER BY o.display_name`).bind(...actor.args).all<{id:string;display_name:string}>()).results
    const grants=(await env.DB.prepare(`SELECT kind,target FROM porthole_notebook_shares WHERE notebook_id=? AND ${actor.fence}`).bind(id,...actor.args).all<{kind:string;target:string}>()).results
    return settingsPage(row,members,grants)
   }
   const history=await versions(env,actor,row),selected=url.searchParams.has('version')?history.find(v=>v.revision===Number(url.searchParams.get('version'))):row
   if(!selected)fail('notebook_revision_not_found',404)
   const body=notebookBody(JSON.parse(selected.body)),results=await Promise.all(body.cells.map(cell=>cell.kind==='text'?null:resolveCell(request,env,cell,row.state==='quarantined')))
   // Repeat the native membership fence after resolving the cells, including
   // shares, so a revoked actor cannot receive a formerly authorized result.
   await current(env,await authority(request,env),id)
   const names:Record<string,string>={}
   for(const ref of new Set([selected.owner_ref,selected.author_ref,...body.comments.flatMap(c=>[c.authorRef,...c.mentions.map(m=>m.memberRef)])])) {
    const name=await env.DB.prepare(`SELECT o.display_name,EXISTS(SELECT 1 FROM porthole_erased_actors e WHERE e.actor_ref=o.id) AS erased FROM oa_operators o WHERE o.id=? AND ${actor.fence}`).bind(ref,...actor.args).first<{display_name:string;erased:number}>()
    names[ref]=name?.erased?'Erased member':name?.display_name??'Unavailable member'
   }
   if(!page)return json({id:row.id,name:selected.name,revision:selected.revision,state:row.state,authorRef:selected.author_ref,createdAt:selected.created_at,updatedAt:selected.updated_at,body,results,versions:history.map(v=>({revision:v.revision,authorRef:v.author_ref,updatedAt:v.updated_at}))})
   const mentionMembers=owner?(await env.DB.prepare(`SELECT o.id,o.display_name,m.scope FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND m.role!='finance reader' AND ${actor.fence} ORDER BY o.display_name`).bind(...actor.args).all<{id:string;display_name:string;scope:string}>()).results.filter(m=>scopeWithin(JSON.parse(row.scope),JSON.parse(m.scope))):[]
   return notebookPage({...selected,state:row.state},body,results,history,names,owner&&!url.searchParams.has('version'),mentionMembers)
  }
  const data=await input(request)
  if(Number(data.revision)!==row.revision)fail('revision_or_authority_changed',409)
  if(row.state==='quarantined')fail('notebook_restore_inactive',409)
  if(action==='share'||action==='unshare') {
   const kind=data.kind,target=data.target
   if(kind!=='member'&&kind!=='team')fail('invalid_notebook_share',400)
   if(typeof target!=='string'||!target.length||target.length>120)fail('invalid_notebook_share',400)
   if(action==='share') {
    if(kind==='member') {
     const member=await memberFor(env.DB,target),active=await env.DB.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active'").bind(target).first()
     if(!member||!active||member.role==='finance reader'||!scopeWithin(JSON.parse(row.scope),member.scope))fail('share_target_scope_forbidden')
    }else if(!JSON.parse(row.scope).teams.includes(target)||target==='*')fail('share_target_scope_forbidden')
   }
   const guard=env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND EXISTS(SELECT 1 FROM porthole_notebooks WHERE id=? AND revision=? AND state='active') THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,id,row.revision)
   await env.DB.batch([guard,action==='share'?env.DB.prepare(`INSERT INTO porthole_notebook_shares VALUES(?,?,?,?,?,?,?) ON CONFLICT(notebook_id,kind,target) DO UPDATE SET owner_ref=excluded.owner_ref,owner_revision=excluded.owner_revision,operator_version=excluded.operator_version,created_at=excluded.created_at`).bind(id,kind,target,actor.member.operatorId,actor.member.revision,actor.session.operator.version,Date.now()):env.DB.prepare('DELETE FROM porthole_notebook_shares WHERE notebook_id=? AND kind=? AND target=?').bind(id,kind,target),
    env.DB.prepare(`INSERT INTO porthole_audit_facts(id,ordinal,operation_ref,actor_ref,actor_revision,action,entity_ref,revision,occurred_at,recorded_at) SELECT ?,COALESCE((SELECT MAX(ordinal) FROM porthole_audit_facts),0)+1,?,?,?,?,?,?,?,?`).bind(crypto.randomUUID().replaceAll('-',''),crypto.randomUUID(),actor.member.operatorId,actor.member.revision,'notebooks.'+action,id,row.revision,Date.now(),Date.now())])
   return page?redirect(id,true):json({id,kind,target,state:action==='share'?'private':'revoked'})
  }
  const body=notebookBody(JSON.parse(row.body)),scope=JSON.parse(row.scope) as Scope
  if(action==='cells') {
   if(body.cells.length>=30)fail('notebook_cell_limit',422)
   const cellId=label(data.cellId,80)
   if(body.cells.some(cell=>cell.id===cellId))fail('notebook_cell_exists',409)
   let cell:Cell
   if(data.kind==='text')cell={id:cellId,kind:'text',text:label(data.text,5000)}
   else {
    if(data.kind!=='query'&&data.kind!=='chart'&&data.kind!=='change')fail('invalid_notebook_cell',400)
    const query=data.query===undefined?Object.fromEntries(['signal','service','environment','team','from','through','metric','dialect','expression'].filter(key=>data[key]!==undefined&&data[key]!=='').map(key=>[key,data[key]])):typeof data.query==='string'?JSON.parse(data.query):data.query
    cell={id:cellId,kind:data.kind,title:label(data.title),...await capture(request,env,query,data.kind)}
    const wanted=cellScope(cell)
    if(!scopeWithin(wanted,actor.member.scope))fail('scope_forbidden')
    for(const key of ['services','environments','teams'] as const)scope[key]=[...new Set([...scope[key],...wanted[key]])]
   }
   body.cells.push(cell)
  } else if(action==='reorder') {
   let order:unknown=data.order
   if(typeof order==='string')order=JSON.parse(order)
   if(data.direction!==undefined) {
    order=body.cells.map(c=>c.id);const ids=order as string[],at=ids.indexOf(String(data.cellId)),next=at+(data.direction==='up'?-1:data.direction==='down'?1:fail('invalid_notebook_order',400))
    if(at<0||next<0||next>=ids.length)fail('invalid_notebook_order',400)
    ;[ids[at],ids[next]]=[ids[next],ids[at]]
   }
   if(!Array.isArray(order)||order.length!==body.cells.length||new Set(order).size!==order.length||order.some(id=>!body.cells.some(c=>c.id===id)))fail('invalid_notebook_order',400)
   body.cells=order.map(id=>body.cells.find(c=>c.id===id)!)
  } else if(action==='rerun') {
   const cell=body.cells.find(c=>c.id===data.cellId)
   if(!cell||cell.kind==='text')fail('notebook_query_cell_required',400)
   const query={...cell.query,...(data.from!==undefined?{from:String(data.from)}:{}),...(data.through!==undefined?{through:String(data.through)}:{})}
   Object.assign(cell,await capture(request,env,query,cell.kind))
  } else if(action==='comment') {
   let mentions=data.mentions??(data.memberRef?[data.memberRef]:[])
   if(typeof mentions==='string')mentions=JSON.parse(mentions)
   if(!Array.isArray(mentions)||mentions.length>20||new Set(mentions).size!==mentions.length)fail('invalid_notebook_mention',400)
   for(const ref of mentions) {
    if(!uuid(ref))fail('invalid_notebook_mention',400)
    const member=await memberFor(env.DB,ref),active=await env.DB.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=?)").bind(ref,ref).first()
    if(!member||!active||!scopeWithin(scope,member.scope))fail('mention_target_scope_forbidden')
   }
   body.comments.push({id:crypto.randomUUID(),text:label(data.text,2000),authorRef:actor.member.operatorId,createdAt:Date.now(),mentions:mentions.map(memberRef=>({memberRef,status:'undelivered'}))})
  } else fail('method_not_allowed',405)
  const result=await save(env,actor,row,body,scope)
  return page?redirect(id):json(result)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_notebook':'notebooks_unavailable'
  return page?unavailablePage(code,status):json({error:code},status)
 }
}
