import type {Bindings} from '../../auth.server'
import type {ObjectRow} from '../objects/http'
import {authority,fail,scopeWithin} from '../security/authority'
import type {Evaluation} from './model'
import type {MonitorPageDetail} from './page'
export async function readMonitors(request:Request,env:Bindings,id?:string) {
 const actor=await authority(request,env)
 if(actor.member.role==='finance reader')fail('operations_forbidden')
 const objects=(await env.DB.prepare(`SELECT * FROM porthole_objects WHERE kind='monitor' AND state!='archived' AND ${actor.fence} ORDER BY name,id`).bind(...actor.args).all<ObjectRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
 if(id&&!objects.some(row=>row.id===id))fail('scope_forbidden')
 const details:Record<string,MonitorPageDetail>={},revisions=[]
 for(const object of objects.filter(row=>!id||row.id===id)) {
  const versions=(await env.DB.prepare(`SELECT object_id,revision,name,scope,body,created_at FROM porthole_monitor_versions WHERE object_id=? AND ${actor.fence} ORDER BY revision`).bind(object.id,...actor.args).all<{object_id:string;revision:number;name:string;scope:string;body:string;created_at:number}>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
  const permitted=new Set(versions.map(row=>row.revision))
  const runs=(await env.DB.prepare(`SELECT result FROM porthole_monitor_runs WHERE object_id=? AND ${actor.fence} ORDER BY evaluated_at DESC,rowid DESC LIMIT 30`).bind(object.id,...actor.args).all<{result:string}>()).results.map(row=>JSON.parse(row.result) as Evaluation).filter(row=>permitted.has(row.revision))
  const current=object.state==='active'?runs.find(row=>row.revision===object.revision):undefined
  details[object.id]={revision:object.revision,state:current?.status??'Unknown',count:current?.observedCount??null,complete:!!current?.groups.length&&current.groups.every(group=>group.completeness==='measured'),reason:current?.reason??'No active evaluation is available for this revision.',evaluatedAt:current?.evaluatedAt,windows:current?.groups.length===1?current.groups[0].windows.map(window=>({...window,complete:window.completeness==='measured'})):undefined,groups:current?.groups.map(group=>({...group,state:group.status,complete:group.completeness==='measured'})),history:runs.map(run=>({revision:run.revision,state:run.status,at:run.evaluatedAt,reason:run.reason}))}
  revisions.push(...versions.map(row=>({...row,id:row.object_id,scope:JSON.parse(row.scope),body:JSON.parse(row.body)})))
 }
 return {actor,objects,details,revisions}
}
