import type {Bindings} from '../../../auth.server'
import {fail,scopeWithin,type Authority} from '../../security/authority'
import {dashboardBody,type Dashboard} from '../model'
import {canonical} from '../../ingest/model'
import {isGroup,packBindings,panelIds,validateDashboardScope,validateGroupScope,type LayoutItem,type Group} from '../layout'
import {powerpackBody,type PowerpackRow} from './model'
export function installPack(body:Dashboard,groupId:string,pack:PowerpackRow):Dashboard {
 const template=powerpackBody(JSON.parse(pack.body)),group=packBindings(body.layout).find(group=>group.id===groupId)??fail('powerpack_binding_not_found',400)
 const old=new Set(panelIds(group.children)),prefix=group.id+':'
 const copy=(items:LayoutItem[]):LayoutItem[]=>items.map(item=>isGroup(item)?{...item,id:prefix+item.id,children:copy(item.children)}:{...item,panel:prefix+item.panel})
 const replace=(items:LayoutItem[]):LayoutItem[]=>items.map(item=>isGroup(item)?item.id===group.id?{...item,powerpack:{id:pack.id,revision:pack.revision},children:copy(template.layout!)}:{...item,children:replace(item.children)}:item)
 return dashboardBody({...body,panels:[...body.panels.filter(p=>!old.has(p.id)),...template.panels.map(p=>({...p,id:prefix+p.id}))],layout:replace(body.layout!)})
}
function reviewedChildren(body:Dashboard,group:Group):string {
 const ids=new Set(panelIds(group.children))
 return canonical({children:group.children,panels:body.panels.filter(panel=>ids.has(panel.id)).sort((left,right)=>left.id.localeCompare(right.id))})
}
export async function resolvePacks(env:Bindings,actor:Authority,body:Dashboard,scope:Parameters<typeof validateDashboardScope>[1]):Promise<Dashboard> {
 for(const group of packBindings(body.layout)) {
  const pack=await env.DB.prepare(`SELECT * FROM porthole_powerpacks WHERE id=? AND ${actor.fence}`).bind(group.powerpack!.id,...actor.args).first<PowerpackRow>()
  if(!pack||!scopeWithin(JSON.parse(pack.scope),actor.member.scope))fail('powerpack_not_found',404)
  if(pack.state!=='active'||pack.revision!==group.powerpack!.revision)fail('powerpack_revision_changed',409)
  const resolved=installPack(body,group.id,pack),installed=packBindings(resolved.layout).find(g=>g.id===group.id)!
  // Existing children are the reviewed pack definition. Refuse changes rather
  // than accepting a dashboard save that silently discards the requested edit.
  // Empty children request a new binding and are populated from the pack.
  if(group.children.length&&reviewedChildren(body,group)!==reviewedChildren(resolved,installed))fail('edit_powerpack_children_in_settings',400)
  body=resolved
  // A binding may narrow visibility, never expand the pack's reviewed scope.
  validateGroupScope(body,installed,JSON.parse(pack.scope))
 }
 validateDashboardScope(body,scope)
 return body
}
export async function validatePackReadScopes(env:Bindings,body:Dashboard,overrides:{team?:string;environment?:string}) {
 for(const group of packBindings(body.layout)) {
  const version=await env.DB.prepare('SELECT scope FROM porthole_powerpack_versions WHERE id=? AND revision=?').bind(group.powerpack!.id,group.powerpack!.revision).first<{scope:string}>()
  if(!version)fail('powerpack_version_unavailable',503)
  validateGroupScope(body,group,JSON.parse(version.scope),overrides)
 }
}
export function packFence(body:Dashboard):{sql:string;args:unknown[]} {
 const groups=packBindings(body.layout)
 return {sql:groups.map(()=>"EXISTS(SELECT 1 FROM porthole_powerpacks WHERE id=? AND revision=? AND state='active')").join(' AND ')||'1',args:groups.flatMap(group=>[group.powerpack!.id,group.powerpack!.revision])}
}
